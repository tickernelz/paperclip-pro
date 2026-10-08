import type { IssueAutonomyWindow } from "@tickernelz/paperclip-pro-shared";
import { HttpError } from "../../errors.js";
import { autonomyWindowService, type AutonomyWindowActor } from "../autonomy-windows.js";
import { assertOpenwaConfigOwnerRun } from "./config-tool.js";
import { openwaCurrentOwnerUserId } from "./owners.js";
import { OpenwaToolError, type ToolContext } from "./tools.js";
import {
  claimOpenwaWrite,
  createOpenwaWrite,
  finishOpenwaWrite,
  openwaToolArgsHash,
  openwaWriteHashMatches,
  openwaWriteReplay,
  settleOpenwaWrite,
} from "./tool-writes.js";

type Args = Record<string, unknown>;
const TOOL = "openwa_autonomy_window";

function summary(window: IssueAutonomyWindow) {
  return {
    windowId: window.id,
    issue: window.rootIssueIdentifier ?? window.rootIssueId,
    title: window.rootIssueTitle,
    status: window.status,
    expiresAt: window.expiresAt.toISOString(),
    maxAccepts: window.maxAccepts,
    acceptCount: window.acceptCount,
  };
}

function toolError(error: unknown): unknown {
  if (!(error instanceof HttpError) || error instanceof OpenwaToolError) return error;
  if (error.status === 404) return new OpenwaToolError(404, "not_found", error.message);
  if (error.status === 409) return new OpenwaToolError(409, "config_conflict", error.message);
  if (error.status === 400 || error.status === 422) return new OpenwaToolError(400, "invalid_arguments", error.message);
  return error;
}

async function ownerActor(ctx: ToolContext): Promise<AutonomyWindowActor> {
  assertOpenwaConfigOwnerRun(ctx);
  const principalId = ctx.openwa?.triggerPrincipalId ?? null;
  const owner = principalId ? await openwaCurrentOwnerUserId(ctx.db, ctx.endpoint, principalId) : null;
  if (!owner?.userId)
    throw new OpenwaToolError(403, "owner_only", "Only a linked endpoint owner's own messages can manage autonomy windows");
  return { userId: owner.userId, grantedVia: "whatsapp", agentId: ctx.binding.agentId, runId: ctx.run.id };
}

async function perform(ctx: ToolContext, args: Args, actor: AutonomyWindowActor) {
  const svc = autonomyWindowService(ctx.db);
  const companyId = ctx.endpoint.companyId;
  const issues = Array.isArray(args.issues) ? args.issues.map(String) : [];
  if (args.operation === "open") {
    const windows = await svc.open(
      companyId,
      {
        issueIds: issues,
        ...(typeof args.hours === "number" ? { hours: args.hours } : {}),
        ...(typeof args.maxAccepts === "number" ? { maxAccepts: args.maxAccepts } : {}),
      },
      actor,
    );
    return { opened: windows.map(summary) };
  }
  const live = await svc.listLive(companyId);
  const rootIds = issues.length ? new Set((await svc.resolveIssues(companyId, issues)).map((issue) => issue.id)) : null;
  const targets = rootIds ? live.filter((window) => rootIds.has(window.rootIssueId)) : live;
  const closed: IssueAutonomyWindow[] = [];
  for (const window of targets) closed.push(await svc.close(window.id, actor, companyId));
  return { closed: closed.map(summary) };
}

export async function openwaAutonomyWindowTool(ctx: ToolContext, args: Args): Promise<Record<string, unknown>> {
  const actor = await ownerActor(ctx);
  if (args.operation === "list") {
    const windows = await autonomyWindowService(ctx.db).listLive(ctx.endpoint.companyId);
    return { windows: windows.map(summary) };
  }
  const scope = {
    companyId: ctx.endpoint.companyId,
    endpointId: ctx.endpoint.id,
    conversationId: ctx.conversation.id,
    issueId: ctx.binding.issueId,
    runId: ctx.binding.runId,
    tool: TOOL,
    idempotencyKey: String(args.idempotencyKey),
  };
  const hash = openwaToolArgsHash(TOOL, args);
  const action = await createOpenwaWrite(ctx.db, scope, hash, { chatKey: ctx.origin.chatKey });
  ctx.audit.actionId = action.id;
  if (!openwaWriteHashMatches(action, hash))
    throw new OpenwaToolError(409, "idempotency_conflict", "This idempotencyKey already belongs to a different OpenWA operation", { actionId: action.id });
  const replay = openwaWriteReplay(action);
  if (replay) return replay;
  const claimed = await claimOpenwaWrite(ctx.db, action);
  if (!claimed) throw new OpenwaToolError(409, "retry_after", "This operation is already running; retry with the same idempotencyKey", { actionId: action.id });
  try {
    const receipt = await perform(ctx, args, actor);
    await finishOpenwaWrite(ctx.db, claimed, receipt);
    return { actionId: action.id, ...receipt };
  } catch (error) {
    await settleOpenwaWrite(ctx.db, claimed.id, "failed");
    throw toolError(error);
  }
}
