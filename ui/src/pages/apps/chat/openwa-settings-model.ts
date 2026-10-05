import {
  openwaChatSettingsSchema,
  type ChatInflightMode,
  openwaEndpointPolicySchema,
  type ChatAuditEntryKind,
  type OpenwaChatSettings,
  type OpenwaChatSettingsInput,
  type OpenwaEndpointPolicy,
  type OpenwaEndpointPolicyInput,
  type OpenwaTriggerOverrides,
} from "@tickernelz/paperclip-pro-shared";
import { ApiError } from "@/api/client";

export type FieldErrors = Record<string, string>;

export const OPENWA_TRIGGER_RULES = [
  { key: "directMessage", label: "Direct messages", detail: "Any message in an active direct chat." },
  { key: "agentMentioned", label: "Agent mentioned", detail: "Someone mentions the agent's number." },
  { key: "replyToAgent", label: "Replies to the agent", detail: "Someone quotes a message the agent sent." },
  { key: "selfChat", label: "Self-chat", detail: "Phone-typed messages in your own chat (owner number mode)." },
  { key: "ownerMentionedAbsent", label: "Owner mentioned while away", detail: "Starts the absence timer when an owner is mentioned." },
  { key: "allMessages", label: "All messages", detail: "Every message in an active chat." },
] as const satisfies ReadonlyArray<{ key: keyof OpenwaTriggerOverrides; label: string; detail: string }>;

export type OpenwaBooleanTrigger = (typeof OPENWA_TRIGGER_RULES)[number]["key"];

export const AUDIT_KIND_LABELS: Record<ChatAuditEntryKind, string> = {
  trigger_admitted: "Trigger admitted",
  trigger_filtered: "Trigger filtered",
  message_sent: "Message sent",
  publication_suppressed: "Reply withheld",
  tool_called: "Tool called",
  approval_requested: "Approval requested",
  approval_reminded: "Approval reminded",
  approval_resolved: "Approval resolved",
  approval_cancelled: "Approval cancelled",
  config_changed: "Settings changed",
  group_added: "Added to group",
  group_left: "Left group",
  session_health: "Session health",
  linked_read: "Linked number read",
  run_failed: "Run failed",
};

export function mergeOpenwaPolicy(policy: OpenwaEndpointPolicy, patch: OpenwaEndpointPolicyInput): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...policy };
  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    merged[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value;
  }
  if (patch.numberMode !== undefined && patch.numberMode !== policy.numberMode && patch.triggers === undefined) delete merged.triggers;
  return merged;
}

interface IssueLike {
  path: ReadonlyArray<PropertyKey>;
  message: string;
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
}

function issueMessage(issue: IssueLike): string {
  const unit = issue.origin === "string" ? " characters" : issue.origin === "array" ? " entries" : "";
  if (issue.code === "invalid_type" && issue.origin !== "string") return "Enter a whole number";
  if (issue.code === "too_big" && issue.maximum !== undefined) return "Use at most " + String(issue.maximum) + unit;
  if (issue.code === "too_small" && issue.minimum !== undefined) return "Use at least " + String(issue.minimum) + unit;
  if (issue.code === "invalid_format") return "Use one word without spaces";
  return issue.message;
}

function issueErrors(issues: ReadonlyArray<IssueLike>, stripPrefix?: string): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = issue.path.map(String);
    if (stripPrefix && path[0] === stripPrefix) path.shift();
    const key = path.join(".") || "form";
    errors[key] ??= issueMessage(issue);
  }
  return errors;
}

export function openwaPolicyPatchErrors(policy: OpenwaEndpointPolicy, patch: OpenwaEndpointPolicyInput): FieldErrors | null {
  const parsed = openwaEndpointPolicySchema.safeParse(mergeOpenwaPolicy(policy, patch));
  return parsed.success ? null : issueErrors(parsed.error.issues);
}

export function openwaChatSettingsErrors(settings: OpenwaChatSettingsInput): FieldErrors | null {
  const parsed = openwaChatSettingsSchema.safeParse(settings);
  return parsed.success ? null : issueErrors(parsed.error.issues);
}

export function apiFieldErrors(error: unknown, stripPrefix?: string): FieldErrors {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const details = (error.body as { details?: unknown }).details;
    const issues = Array.isArray(details)
      ? details
      : details && typeof details === "object" && Array.isArray((details as { issues?: unknown }).issues)
        ? (details as { issues: unknown[] }).issues
        : null;
    if (issues) {
      const valid = issues.flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const { path, message, code, origin, minimum, maximum } = issue as Record<string, unknown>;
        if (typeof message !== "string") return [];
        return [
          {
            path: Array.isArray(path) ? (path as PropertyKey[]) : [],
            message,
            ...(typeof code === "string" ? { code } : {}),
            ...(typeof origin === "string" ? { origin } : {}),
            ...(typeof minimum === "number" ? { minimum } : {}),
            ...(typeof maximum === "number" ? { maximum } : {}),
          },
        ];
      });
      if (valid.length) return issueErrors(valid, stripPrefix);
    }
  }
  return { form: error instanceof Error && error.message ? error.message : "Couldn't save. Try again." };
}

/** Parses a whole-number field; blank and malformed input become NaN so the schema reports them. */
export function wholeNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value.trim());
}

export function optionalWholeNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value.trim());
}

export function keywordList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export type TriggerChoice = "inherit" | "on" | "off";

export interface ChatDraft {
  label: string;
  activation: OpenwaChatSettings["activation"];
  replyPolicy: "inherit" | NonNullable<OpenwaChatSettings["replyPolicy"]>;
  absenceSeconds: string;
  note: string;
  triggers: Record<OpenwaBooleanTrigger | "commandPrefix", TriggerChoice>;
  prefix: string;
  keywordsOverride: boolean;
  keywords: string;
}

function choice(value: boolean | undefined): TriggerChoice {
  return value === undefined ? "inherit" : value ? "on" : "off";
}

export function chatDraft(label: string, settings: OpenwaChatSettings): ChatDraft {
  const triggers = settings.triggers ?? {};
  return {
    label,
    activation: settings.activation,
    replyPolicy: settings.replyPolicy ?? "inherit",
    absenceSeconds: settings.absenceSeconds === undefined ? "" : String(settings.absenceSeconds),
    note: settings.note ?? "",
    triggers: {
      directMessage: choice(triggers.directMessage),
      agentMentioned: choice(triggers.agentMentioned),
      replyToAgent: choice(triggers.replyToAgent),
      selfChat: choice(triggers.selfChat),
      ownerMentionedAbsent: choice(triggers.ownerMentionedAbsent),
      allMessages: choice(triggers.allMessages),
      commandPrefix: choice(triggers.commandPrefix?.enabled),
    },
    prefix: triggers.commandPrefix?.prefix ?? "",
    keywordsOverride: triggers.keywords !== undefined,
    keywords: (triggers.keywords ?? []).join(", "),
  };
}

/** Builds the per-chat settings body; inherited values are omitted so endpoint defaults apply. */
export function chatSettingsInput(draft: ChatDraft): OpenwaChatSettingsInput {
  const triggers: OpenwaTriggerOverrides = {};
  for (const rule of OPENWA_TRIGGER_RULES) {
    const value = draft.triggers[rule.key];
    if (value !== "inherit") triggers[rule.key] = value === "on";
  }
  const prefixChoice = draft.triggers.commandPrefix;
  if (prefixChoice !== "inherit" || draft.prefix.trim())
    triggers.commandPrefix = {
      ...(prefixChoice === "inherit" ? {} : { enabled: prefixChoice === "on" }),
      ...(draft.prefix.trim() ? { prefix: draft.prefix.trim() } : {}),
    };
  if (draft.keywordsOverride) triggers.keywords = keywordList(draft.keywords);
  const absence = optionalWholeNumber(draft.absenceSeconds);
  return {
    activation: draft.activation,
    ...(Object.keys(triggers).length ? { triggers } : {}),
    ...(absence === undefined ? {} : { absenceSeconds: absence }),
    ...(draft.replyPolicy === "inherit" ? {} : { replyPolicy: draft.replyPolicy }),
    ...(draft.note.trim() ? { note: draft.note } : {}),
  };
}

export function openwaCapabilityWarnings(input: {
  adapterType: string | null;
  adapterConfig: Record<string, unknown> | null;
  supportsLiveSteering: boolean;
  readOnlyToolProfile: "enforced" | "instruction_only";
  inflightMode: ChatInflightMode | undefined;
  numberMode: OpenwaEndpointPolicy["numberMode"];
}): string[] {
  const warnings: string[] = [];
  const adapter = input.adapterType ?? "unknown";
  const rpcOff = input.adapterType === "omp_local" && input.adapterConfig?.rpcSteering === false;
  if (input.inflightMode === "queue")
    warnings.push("In-flight mode is queue: new messages wait for the next run, and progress nudges are unavailable.");
  else if (!input.supportsLiveSteering || rpcOff)
    warnings.push(
      "The agent's adapter (" + adapter + ") cannot steer a running turn" + (rpcOff ? " because its live session (RPC) transport is off" : "") + ". New messages wait for the next run, and progress nudges are unavailable.",
    );
  if (input.readOnlyToolProfile === "instruction_only")
    warnings.push(
      "Read-only runs are instruction-only for the " + adapter + " adapter: it cannot block write tools, so runs started by non-owners rely on the agent following its instructions.",
    );
  if (input.numberMode === "owner_number")
    warnings.push("Owner number mode: the conversation tasks contain the owner's own WhatsApp chats and follow normal task visibility.");
  return warnings;
}

export function datetimeLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) return value.join(", ");
  return null;
}

export function auditFields(record: Record<string, unknown> | null): Array<[string, string]> {
  if (!record) return [];
  return Object.entries(record).flatMap(([key, value]): Array<[string, string]> => {
    if (value === null || value === undefined) return [];
    const text = scalar(value);
    if (text !== null) return text ? [[key, text]] : [];
    return [[key, JSON.stringify(value)]];
  });
}
