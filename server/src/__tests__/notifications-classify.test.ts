import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@tickernelz/paperclip-pro-shared";
import { classifyLiveEvent, type NotificationContext } from "../services/notifications/classify.js";

const COMPANY_ID = "company-1";
const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

function context(overrides: Partial<NotificationContext> = {}): NotificationContext {
  return {
    issuePrefix: "PAP",
    agentName: "Wira",
    issue: { identifier: "PAP-12", title: "Ship notifications" },
    issueInboxUserIds: ["owner", "commenter"],
    mentionedUserIds: [],
    boardUserIds: ["owner", "commenter", "board-2"],
    ...overrides,
  };
}

function activity(payload: Record<string, unknown>): LiveEvent {
  return {
    id: 1,
    companyId: COMPANY_ID,
    type: "activity.logged",
    createdAt: "2026-10-07T00:00:00.000Z",
    payload: { actorType: "agent", actorId: AGENT_ID, agentId: AGENT_ID, entityType: "issue", entityId: ISSUE_ID, details: {}, ...payload },
  };
}

function runStatus(status: string, type: LiveEvent["type"] = "heartbeat.run.status"): LiveEvent {
  return {
    id: 2,
    companyId: COMPANY_ID,
    type,
    createdAt: "2026-10-07T00:00:00.000Z",
    payload: { runId: "run-1", agentId: AGENT_ID, issueId: ISSUE_ID, status, error: "adapter crashed" },
  };
}

describe("classifyLiveEvent", () => {
  it.each([
    {
      name: "approval created by an agent",
      event: activity({ action: "approval.created", entityType: "approval", entityId: "approval-1", details: { type: "hire_agent" } }),
      expected: { kind: "approval", key: "approval:approval-1", url: "/PAP/approvals/approval-1", recipients: ["owner", "commenter", "board-2"] },
    },
    {
      name: "question card without addressee",
      event: activity({ action: "issue.thread_interaction_created", details: { interactionId: "int-1", interactionKind: "ask_user_questions" } }),
      expected: { kind: "question", key: "question:int-1", url: "/PAP/issues/PAP-12", recipients: ["owner", "commenter", "board-2"] },
    },
    {
      name: "question card addressed to a user",
      event: activity({ action: "issue.thread_interaction_created", details: { interactionId: "int-2", interactionKind: "request_confirmation", addresseeUserId: "board-2" } }),
      expected: { kind: "question", key: "question:int-2", url: "/PAP/issues/PAP-12", recipients: ["board-2"] },
    },
    {
      name: "agent comment",
      event: activity({ action: "issue.comment_added", details: { commentId: "c-1", bodySnippet: "Done with the first pass" } }),
      expected: { kind: "comment", key: "comment:c-1", url: "/PAP/issues/PAP-12", recipients: ["owner", "commenter"] },
    },
    {
      name: "assignment to a user",
      event: activity({ action: "issue.updated", details: { assigneeUserId: "board-2", _previous: { assigneeUserId: null } } }),
      expected: { kind: "assignment", key: `assignment:${ISSUE_ID}:board-2`, url: "/PAP/issues/PAP-12", recipients: ["board-2", "owner", "commenter"] },
    },
    {
      name: "issue moved to review",
      event: activity({ action: "issue.updated", details: { status: "in_review", _previous: { status: "in_progress" } } }),
      expected: { kind: "review", key: `review:${ISSUE_ID}:in_review`, url: "/PAP/issues/PAP-12", recipients: ["owner", "commenter"] },
    },
    {
      name: "issue done",
      event: activity({ action: "issue.updated", details: { status: "done", _previous: { status: "in_review" } } }),
      expected: { kind: "review", key: `review:${ISSUE_ID}:done`, url: "/PAP/issues/PAP-12", recipients: ["owner", "commenter"] },
    },
    {
      name: "failed run",
      event: runStatus("failed"),
      expected: { kind: "run_failed", key: "run_failed:run-1", url: `/PAP/agents/${AGENT_ID}/runs/run-1`, recipients: ["owner", "commenter", "board-2"] },
    },
    {
      name: "timed out run",
      event: runStatus("timed_out"),
      expected: { kind: "run_failed", key: "run_failed:run-1", url: `/PAP/agents/${AGENT_ID}/runs/run-1`, recipients: ["owner", "commenter", "board-2"] },
    },
    {
      name: "join request by the requester",
      event: activity({ actorType: "user", actorId: "visitor", agentId: null, action: "join.requested", entityType: "join_request", entityId: "jr-1", details: { requestType: "human" } }),
      expected: { kind: "join_request", key: "join_request:jr-1", url: "/PAP/inbox/requests", recipients: ["owner", "commenter", "board-2"] },
    },
  ])("classifies $name", ({ event, expected }) => {
    const result = classifyLiveEvent(event, context());
    expect(result).not.toBeNull();
    expect(result!.notification).toMatchObject({
      kind: expected.kind,
      key: expected.key,
      url: expected.url,
      companyId: COMPANY_ID,
      createdAt: "2026-10-07T00:00:00.000Z",
    });
    expect(result!.recipientUserIds).toEqual(expected.recipients);
    expect(result!.notification.title.length).toBeGreaterThan(0);
  });

  it.each([
    { name: "user comment", event: activity({ actorType: "user", actorId: "owner", agentId: null, action: "issue.comment_added", details: { commentId: "c-2" } }) },
    { name: "user approval", event: activity({ actorType: "user", actorId: "owner", agentId: null, action: "approval.created", entityType: "approval", entityId: "a-2" }) },
    { name: "user assignment", event: activity({ actorType: "user", actorId: "owner", agentId: null, action: "issue.updated", details: { assigneeUserId: "board-2", _previous: { assigneeUserId: null } } }) },
    { name: "succeeded run", event: runStatus("succeeded") },
    { name: "run log chunk", event: runStatus("failed", "heartbeat.run.log") },
    { name: "run event", event: runStatus("failed", "heartbeat.run.event") },
    { name: "agent-addressed question", event: activity({ action: "issue.thread_interaction_created", details: { interactionId: "int-3", interactionKind: "ask_user_questions", addresseeAgentId: AGENT_ID } }) },
    { name: "connection intent card", event: activity({ action: "issue.thread_interaction_created", details: { interactionId: "int-4", interactionKind: "connection_intent" } }) },
    { name: "unchanged status", event: activity({ action: "issue.updated", details: { status: "in_review", _previous: { status: "in_review" } } }) },
    { name: "status update without a transition", event: activity({ action: "issue.updated", details: { status: "done" } }) },
    { name: "replayed join request", event: activity({ actorType: "user", actorId: "visitor", action: "join.request_replayed", entityType: "join_request", entityId: "jr-2" }) },
  ])("ignores $name", ({ event }) => {
    expect(classifyLiveEvent(event, context())).toBeNull();
  });

  it("never notifies the acting user", () => {
    const result = classifyLiveEvent(
      activity({ actorType: "user", actorId: "owner", agentId: null, action: "join.requested", entityType: "join_request", entityId: "jr-3" }),
      context(),
    );
    expect(result!.recipientUserIds).toEqual(["commenter", "board-2"]);
  });

  it("limits recipients to active members and includes mentioned members", () => {
    const result = classifyLiveEvent(
      activity({ action: "issue.comment_added", details: { commentId: "c-3" } }),
      context({ issueInboxUserIds: ["owner", "former-member"], mentionedUserIds: ["board-2", "stranger"] }),
    );
    expect(result!.recipientUserIds).toEqual(["owner", "board-2"]);
  });

  it("returns null when the issue has no user audience", () => {
    const result = classifyLiveEvent(
      activity({ action: "issue.comment_added", details: { commentId: "c-4" } }),
      context({ issueInboxUserIds: [] }),
    );
    expect(result).toBeNull();
  });

  it("caps the body at 300 characters", () => {
    const result = classifyLiveEvent(
      activity({ action: "issue.comment_added", details: { commentId: "c-5", bodySnippet: "x".repeat(1000) } }),
      context(),
    );
    expect(result!.notification.body.length).toBeLessThanOrEqual(300);
  });
});
