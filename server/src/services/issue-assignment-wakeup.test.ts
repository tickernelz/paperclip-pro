import { describe, expect, it, vi } from "vitest";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "./issue-assignment-wakeup.js";

type WakeupOptions = Parameters<IssueAssignmentWakeupDeps["wakeup"]>[1];

function harness() {
  const wakeup = vi.fn(
    async (_agentId: string, _opts: WakeupOptions) => ({ id: "run-1" }),
  );
  return { wakeup, heartbeat: { wakeup } };
}

describe("queueIssueAssignmentWakeup task key", () => {
  it("prefers the issue identifier over its uuid", async () => {
    const h = harness();
    await queueIssueAssignmentWakeup({
      heartbeat: h.heartbeat,
      issue: {
        id: "f6733413-db16-4550-8eb6-eac700a39ea6",
        identifier: "ZHA-1507",
        assigneeAgentId: "agent-1",
        status: "in_progress",
      },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
    });
    const [, opts] = h.wakeup.mock.calls[0]!;
    expect(opts.contextSnapshot).toMatchObject({ taskKey: "ZHA-1507" });
    expect(opts.payload).toMatchObject({ taskKey: "ZHA-1507" });
  });

  it("keeps an explicit caller task key", async () => {
    const h = harness();
    await queueIssueAssignmentWakeup({
      heartbeat: h.heartbeat,
      issue: {
        id: "issue-uuid",
        identifier: "ZHA-1",
        assigneeAgentId: "agent-1",
        status: "in_progress",
      },
      reason: "status_card_compile_assigned",
      mutation: "status_card.compile_requested",
      contextSource: "status_card_compile",
      taskKey: "status-card:card-1",
    });
    const [, opts] = h.wakeup.mock.calls[0]!;
    expect(opts.contextSnapshot).toMatchObject({ taskKey: "status-card:card-1" });
  });

  it("falls back to the uuid when no identifier is supplied", async () => {
    const h = harness();
    await queueIssueAssignmentWakeup({
      heartbeat: h.heartbeat,
      issue: { id: "issue-uuid", assigneeAgentId: "agent-1", status: "in_progress" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
    });
    const [, opts] = h.wakeup.mock.calls[0]!;
    expect(opts.contextSnapshot).toMatchObject({ taskKey: "issue-uuid" });
  });

  it("does not wake a backlog issue", async () => {
    const h = harness();
    await queueIssueAssignmentWakeup({
      heartbeat: h.heartbeat,
      issue: { id: "issue-uuid", identifier: "ZHA-1", assigneeAgentId: "agent-1", status: "backlog" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
    });
    expect(h.wakeup).not.toHaveBeenCalled();
  });
});