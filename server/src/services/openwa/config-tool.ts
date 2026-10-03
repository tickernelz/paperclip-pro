import { and, eq } from "drizzle-orm";
import { chatEndpoints } from "@tickernelz/paperclip-pro-db";
import {
  OPENWA_CONFIG_UI_ONLY_FIELDS,
  maskOpenwaPhoneNumber,
  openwaChatSettingsSchema,
  openwaEndpointPolicySchema,
  type OpenwaChatSettings,
} from "@tickernelz/paperclip-pro-shared";
import { HttpError } from "../../errors.js";
import type { OpenwaAgentConfigOrigin } from "./owners.js";
import { OpenwaToolError, chatRef, fitPage, openwaToolOwners, resolveTarget, type ToolContext } from "./tools.js";

type Args = Record<string, unknown>;
type SenderList = "allow" | "deny";

const RESULT_TEXT_LIMIT = 4000;
const CHAT_SETTING_KEYS = ["activation", "triggers", "absenceSeconds", "replyPolicy", "note"] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function e164(number: string): string {
  return "+" + number.replace(/^\+/, "");
}

export function refuseOpenwaUiOnlyConfig(value: unknown): void {
  const keys = Object.keys(record(value)).filter((key) => (OPENWA_CONFIG_UI_ONLY_FIELDS as readonly string[]).includes(key));
  if (keys.length)
    throw new OpenwaToolError(403, "ui_only_setting", "Credentials, number mode, owners and the gateway admin level are changed by a person in Paperclip", {
      fields: keys,
    });
}

function assertOwnerRun(ctx: ToolContext): void {
  if (ctx.openwa?.triggerClass !== "owner" || ctx.openwa.endpointId !== ctx.endpoint.id)
    throw new OpenwaToolError(403, "owner_only", "Only owner-triggered runs may change this endpoint's configuration");
}

function mergeChatSettings(current: OpenwaChatSettings | null, patch: Record<string, unknown>): OpenwaChatSettings {
  const merged: Record<string, unknown> = { ...(current ?? { activation: "auto" }) };
  for (const key of CHAT_SETTING_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || (key === "note" && typeof value === "string" && !value.trim())) delete merged[key];
    else merged[key] = value;
  }
  const parsed = openwaChatSettingsSchema.safeParse(merged);
  if (!parsed.success)
    throw new OpenwaToolError(400, "invalid_arguments", parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "));
  return parsed.data;
}

function toolError(error: unknown): unknown {
  if (!(error instanceof HttpError) || error instanceof OpenwaToolError) return error;
  if (error.status === 409) return new OpenwaToolError(409, "config_conflict", error.message);
  if (error.status === 400 || error.status === 422) return new OpenwaToolError(400, "invalid_arguments", error.message, record(error.details));
  return error;
}

async function view(ctx: ToolContext, chatKey: string, changed: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const owners = openwaToolOwners(ctx.db);
  const [[endpoint], rules, chats] = await Promise.all([
    ctx.db
      .select({ policy: chatEndpoints.policy, policyRevision: chatEndpoints.policyRevision })
      .from(chatEndpoints)
      .where(and(eq(chatEndpoints.companyId, ctx.endpoint.companyId), eq(chatEndpoints.id, ctx.endpoint.id))),
    owners.listSenderRules(ctx.endpoint.id),
    owners.listChats(ctx.endpoint.id),
  ]);
  const policy = openwaEndpointPolicySchema.parse(endpoint?.policy ?? {});
  const chat = chats.find((entry) => entry.chatKey === chatKey) ?? null;
  const custom = [...policy.customInstructions];
  const { reminderMinutes, maxReminders, grantTtlHours: _grantTtlHours, ...toggles } = policy.approvals;
  const envelope = {
    ...(changed ? { changed } : {}),
    policyRevision: endpoint?.policyRevision ?? ctx.endpoint.policyRevision,
    senderPolicyMode: policy.senderPolicyMode,
    chat: { chatRef: chatRef(ctx, chat?.chatId ?? chatKey), configured: chat !== null, enabled: chat?.enabled ?? null, settings: chat?.settings ?? null },
    approvals: toggles,
    reminders: { reminderMinutes, maxReminders },
    customInstructions: custom.length > RESULT_TEXT_LIMIT ? custom.slice(0, RESULT_TEXT_LIMIT).join("") + "…" : policy.customInstructions,
    ...(custom.length > RESULT_TEXT_LIMIT ? { customInstructionsTruncated: true } : {}),
  };
  const senders = rules.map((rule) => ({ list: rule.list, number: maskOpenwaPhoneNumber(rule.e164), label: rule.label }));
  const fitted = fitPage(envelope, senders);
  return { ...envelope, senders: fitted.page, ...(fitted.truncated ? { sendersTruncated: true } : {}) };
}

export async function openwaEndpointConfigTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  assertOwnerRun(ctx);
  const owners = openwaToolOwners(ctx.db);
  const senders = record(args.senders);
  const chatSettings = args.chatSettings === undefined ? null : record(args.chatSettings);
  if (args.chat !== undefined && !chatSettings) throw new OpenwaToolError(400, "invalid_arguments", "chat selects the chat for chatSettings");
  const target = resolveTarget(ctx, args.chat);
  const origin: OpenwaAgentConfigOrigin = {
    agentId: ctx.binding.agentId,
    runId: ctx.run.id,
    chatKey: ctx.origin.chatKey,
    conversationId: ctx.conversation.id,
  };
  const policyPatch: Record<string, unknown> = {
    ...(args.approvals !== undefined ? { approvals: args.approvals } : {}),
    ...(args.customInstructions !== undefined ? { customInstructions: args.customInstructions } : {}),
  };
  const rules = (key: "add" | "remove") =>
    (Array.isArray(senders[key]) ? (senders[key] as Array<{ list: SenderList; number: string; label?: string }>) : []).map((entry) => ({
      list: entry.list,
      e164: e164(entry.number),
      ...(entry.label ? { label: entry.label } : {}),
    }));
  const add = rules("add");
  const remove = rules("remove");
  const changed: Record<string, unknown> = {};
  try {
    if (Object.keys(policyPatch).length) {
      await owners.updatePolicy(ctx.endpoint.id, policyPatch, null, origin);
      changed.endpoint = Object.keys(policyPatch);
    }
    if (chatSettings) {
      await owners.putChat(ctx.endpoint.id, { chatId: target.chatId, settings: (current) => mergeChatSettings(current, chatSettings) }, null, origin);
      changed.chat = chatRef(ctx, target.chatId);
    }
    if (add.length || remove.length) changed.senders = await owners.applySenderRuleChanges(ctx.endpoint.id, { add, remove }, origin);
  } catch (error) {
    throw toolError(error);
  }
  return view(ctx, target.chatKey, Object.keys(changed).length ? changed : null);
}
