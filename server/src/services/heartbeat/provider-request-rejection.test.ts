import { describe, expect, it, vi } from "vitest";
import type { IssueUnblockDescriptor } from "@tickernelz/wardmote-shared";
import {
  blockIssueAfterProviderRequestRejection,
  type ProviderRequestRejectionDependencies,
} from "./provider-request-rejection.js";

const COMPANY = "company-1";
const REJECTION = "400 The request contains image input, but this combo has no confirmed vision-capable target (type=invalid_request_error)";

function rejectedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    companyId: COMPANY,
    agentId: "reporter",
    errorCode: "omp_provider_request_rejected",
    error: REJECTION,
    resultJson: { errorFamily: "provider_request_rejected" },
    ...overrides,
  } as Parameters<typeof blockIssueAfterProviderRequestRejection>[1];
}

function harness(input: { issue?: Record<string, unknown>; reportsTo?: string | null } = {}) {
  const issue = {
    id: "issue-1",
    companyId: COMPANY,
    status: "in_progress",
    assigneeAgentId: "reporter",
    executionRunId: "run-1",
    ...input.issue,
  };
  const agents = new Map([
    ["reporter", { id: "reporter", companyId: COMPANY, reportsTo: input.reportsTo === undefined ? "director" : input.reportsTo }],
    ["director", { id: "director", companyId: COMPANY, reportsTo: null }],
  ]);
  const blocked: Array<{ issueId: string; descriptor: IssueUnblockDescriptor }> = [];
  const deps = {
    getIssue: vi.fn(async () => issue),
    getAgent: vi.fn(async (agentId: string) => agents.get(agentId) ?? null),
    blockIssue: vi.fn(async (issueId: string, descriptor: IssueUnblockDescriptor) => {
      blocked.push({ issueId, descriptor });
      return { ...issue, status: "blocked", unblockDescriptor: descriptor, blockedTransitionAt: new Date(), blockedOwnerNotifiedAt: null };
    }),
    wakeup: vi.fn(async () => null),
    markOwnerNotified: vi.fn(async () => null),
  } satisfies ProviderRequestRejectionDependencies;
  return { deps, blocked };
}

describe("blockIssueAfterProviderRequestRejection", () => {
  it("blocks the issue with the provider error and wakes the assignee's manager as unblock owner", async () => {
    const { deps, blocked } = harness();
    const result = await blockIssueAfterProviderRequestRejection(deps, rejectedRun(), "issue-1");
    expect(result?.status).toBe("blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.descriptor.owner).toEqual({ agentId: "director" });
    expect(blocked[0]!.descriptor.action).toContain("no confirmed vision-capable target");
    expect(blocked[0]!.descriptor.action).toContain("fresh session");
    expect(deps.wakeup).toHaveBeenCalledTimes(1);
    expect(deps.wakeup).toHaveBeenCalledWith(
      "director",
      expect.objectContaining({ reason: "issue_unblock_requested", payload: expect.objectContaining({ issueId: "issue-1" }) }),
    );
    expect(deps.markOwnerNotified).toHaveBeenCalledTimes(1);
  });

  it("blocks a hidden-style issue that the stranded sweep never sees, routing to the board without a manager", async () => {
    const { deps, blocked } = harness({ reportsTo: null, issue: { executionRunId: null } });
    await blockIssueAfterProviderRequestRejection(deps, rejectedRun(), "issue-1");
    expect(blocked[0]!.descriptor.owner).toBe("board");
    expect(deps.wakeup).not.toHaveBeenCalled();
  });

  it.each([
    ["another failure family", rejectedRun({ errorCode: "omp_exit_1", resultJson: {} }), {}],
    ["an issue held by a newer run", rejectedRun(), { executionRunId: "run-2" }],
    ["an issue reassigned to someone else", rejectedRun(), { assigneeAgentId: "other" }],
    ["an issue no longer active", rejectedRun(), { status: "done" }],
  ])("leaves %s untouched", async (_label, run, issue) => {
    const { deps } = harness({ issue });
    expect(await blockIssueAfterProviderRequestRejection(deps, run, "issue-1")).toBeNull();
    expect(deps.blockIssue).not.toHaveBeenCalled();
  });
});
