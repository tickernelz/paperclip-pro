import type { LiveEvent, NotificationKind, PaperclipNotification } from "@tickernelz/paperclip-pro-shared";

export const NOTIFICATION_BODY_MAX_CHARS = 300;

const QUESTION_INTERACTION_KINDS = new Set([
  "ask_user_questions",
  "suggest_tasks",
  "request_confirmation",
  "request_checkbox_confirmation",
  "request_item_verdicts",
]);

const REVIEW_STATUSES = new Set(["in_review", "done"]);
const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);
const NOTIFYING_ACTOR_TYPES = new Set(["agent", "system"]);

export interface NotificationTrigger {
  kind: NotificationKind;
  key: string;
  companyId: string;
  createdAt: string;
  actorUserId: string | null;
  agentId: string | null;
  issueId: string | null;
  entityId: string | null;
  commentId: string | null;
  targetUserIds: string[];
  detail: string | null;
  status: string | null;
}

export interface NotificationIssueContext {
  identifier: string | null;
  title: string;
}

export interface NotificationContext {
  issuePrefix: string;
  agentName: string | null;
  issue: NotificationIssueContext | null;
  issueInboxUserIds: string[];
  mentionedUserIds: string[];
  boardUserIds: string[];
}

export interface ClassifiedNotification {
  notification: PaperclipNotification;
  recipientUserIds: string[];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function truncate(value: string, max: number) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

function baseTrigger(event: LiveEvent, kind: NotificationKind, key: string): NotificationTrigger {
  return {
    kind,
    key,
    companyId: event.companyId,
    createdAt: event.createdAt,
    actorUserId: null,
    agentId: null,
    issueId: null,
    entityId: null,
    commentId: null,
    targetUserIds: [],
    detail: null,
    status: null,
  };
}

function parseRunStatus(event: LiveEvent): NotificationTrigger | null {
  const payload = record(event.payload);
  const status = str(payload.status);
  const runId = str(payload.runId);
  if (!runId || !status || !FAILED_RUN_STATUSES.has(status)) return null;
  return {
    ...baseTrigger(event, "run_failed", `run_failed:${runId}`),
    agentId: str(payload.agentId),
    issueId: str(payload.issueId),
    entityId: runId,
    detail: str(payload.error),
    status,
  };
}

function parseActivity(event: LiveEvent): NotificationTrigger | null {
  const payload = record(event.payload);
  const action = str(payload.action);
  const actorType = str(payload.actorType);
  const actorId = str(payload.actorId);
  const entityId = str(payload.entityId);
  const details = record(payload.details);
  if (!action || !actorType || !entityId) return null;
  const actorUserId = actorType === "user" ? actorId : null;
  const agentId = str(payload.agentId) ?? (actorType === "agent" ? actorId : null);
  const common = { actorUserId, agentId, entityId };

  if (action === "join.requested") {
    return {
      ...baseTrigger(event, "join_request", `join_request:${entityId}`),
      ...common,
      detail: str(details.requestType),
    };
  }

  if (!NOTIFYING_ACTOR_TYPES.has(actorType)) return null;

  if (action === "approval.created") {
    return {
      ...baseTrigger(event, "approval", `approval:${entityId}`),
      ...common,
      detail: str(details.type),
    };
  }

  if (action === "issue.thread_interaction_created") {
    const interactionKind = str(details.interactionKind);
    const interactionId = str(details.interactionId);
    if (!interactionKind || !interactionId || !QUESTION_INTERACTION_KINDS.has(interactionKind)) return null;
    const addresseeUserId = str(details.addresseeUserId);
    if (!addresseeUserId && str(details.addresseeAgentId)) return null;
    return {
      ...baseTrigger(event, "question", `question:${interactionId}`),
      ...common,
      issueId: entityId,
      targetUserIds: addresseeUserId ? [addresseeUserId] : [],
      detail: interactionKind,
    };
  }

  if (action === "issue.comment_added") {
    const commentId = str(details.commentId);
    if (!commentId) return null;
    return {
      ...baseTrigger(event, "comment", `comment:${commentId}`),
      ...common,
      issueId: entityId,
      commentId,
      detail: str(details.bodySnippet),
    };
  }

  if (action === "issue.updated") {
    const previous = record(details._previous);
    const assigneeUserId = str(details.assigneeUserId);
    if (
      assigneeUserId &&
      hasOwn(details, "assigneeUserId") &&
      (!hasOwn(previous, "assigneeUserId") || previous.assigneeUserId !== assigneeUserId)
    ) {
      return {
        ...baseTrigger(event, "assignment", `assignment:${entityId}:${assigneeUserId}`),
        ...common,
        issueId: entityId,
        targetUserIds: [assigneeUserId],
      };
    }
    const status = str(details.status);
    if (status && REVIEW_STATUSES.has(status) && previous.status !== status && hasOwn(previous, "status")) {
      return {
        ...baseTrigger(event, "review", `review:${entityId}:${status}`),
        ...common,
        issueId: entityId,
        status,
      };
    }
  }

  return null;
}

export function parseNotificationTrigger(event: LiveEvent): NotificationTrigger | null {
  if (event.type === "activity.logged") return parseActivity(event);
  if (event.type === "heartbeat.run.status") return parseRunStatus(event);
  return null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function resolveRecipients(trigger: NotificationTrigger, context: NotificationContext) {
  let recipients: string[];
  switch (trigger.kind) {
    case "approval":
    case "run_failed":
    case "join_request":
      recipients = context.boardUserIds;
      break;
    case "question":
      recipients = trigger.targetUserIds.length > 0 ? trigger.targetUserIds : context.boardUserIds;
      break;
    case "assignment":
    case "review":
    case "comment":
      recipients = [...trigger.targetUserIds, ...context.issueInboxUserIds, ...context.mentionedUserIds];
      break;
  }
  const members = new Set(context.boardUserIds);
  return unique(recipients).filter((userId) => userId !== trigger.actorUserId && members.has(userId));
}

function issueLabel(issue: NotificationIssueContext | null) {
  if (!issue) return "a task";
  return issue.identifier ? `${issue.identifier} ${issue.title}` : issue.title;
}

function issueUrl(prefix: string, trigger: NotificationTrigger, issue: NotificationIssueContext | null) {
  const ref = issue?.identifier ?? trigger.issueId;
  return ref ? `/${prefix}/issues/${ref}` : `/${prefix}/inbox`;
}

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

function describe(trigger: NotificationTrigger, context: NotificationContext) {
  const prefix = context.issuePrefix;
  const actor = context.agentName ?? "An agent";
  const issue = context.issue;
  const label = issueLabel(issue);
  switch (trigger.kind) {
    case "approval":
      return {
        title: `${actor} requested approval`,
        body: trigger.detail ? `Approval needed: ${humanize(trigger.detail)}` : "Approval needed",
        url: `/${prefix}/approvals/${trigger.entityId}`,
      };
    case "question":
      return {
        title: `${actor} needs your input`,
        body: label,
        url: issueUrl(prefix, trigger, issue),
      };
    case "comment":
      return {
        title: `${actor} commented on ${issue?.identifier ?? "a task"}`,
        body: trigger.detail ?? label,
        url: issueUrl(prefix, trigger, issue),
      };
    case "assignment":
      return {
        title: `${actor} assigned ${issue?.identifier ?? "a task"}`,
        body: label,
        url: issueUrl(prefix, trigger, issue),
      };
    case "review":
      return {
        title: trigger.status === "done" ? `${issue?.identifier ?? "Task"} is done` : `${issue?.identifier ?? "Task"} is ready for review`,
        body: label,
        url: issueUrl(prefix, trigger, issue),
      };
    case "run_failed":
      return {
        title: trigger.status === "timed_out" ? `${actor} run timed out` : `${actor} run failed`,
        body: trigger.detail ?? (issue ? label : "The run ended with an error"),
        url: trigger.agentId ? `/${prefix}/agents/${trigger.agentId}/runs/${trigger.entityId}` : `/${prefix}/inbox`,
      };
    case "join_request":
      return {
        title: "New join request",
        body: trigger.detail ? `A ${trigger.detail} is asking to join` : "Someone is asking to join",
        url: `/${prefix}/inbox/requests`,
      };
  }
}

export function classifyTrigger(trigger: NotificationTrigger, context: NotificationContext): ClassifiedNotification | null {
  const recipientUserIds = resolveRecipients(trigger, context);
  if (recipientUserIds.length === 0) return null;
  const { title, body, url } = describe(trigger, context);
  return {
    notification: {
      key: trigger.key,
      kind: trigger.kind,
      companyId: trigger.companyId,
      title: truncate(title, 120),
      body: truncate(body, NOTIFICATION_BODY_MAX_CHARS),
      url,
      issueId: trigger.issueId,
      createdAt: trigger.createdAt,
    },
    recipientUserIds,
  };
}

export function classifyLiveEvent(event: LiveEvent, context: NotificationContext): ClassifiedNotification | null {
  const trigger = parseNotificationTrigger(event);
  return trigger ? classifyTrigger(trigger, context) : null;
}
