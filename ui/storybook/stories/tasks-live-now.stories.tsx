import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Issue } from "@tickernelz/paperclip-pro-shared";
import type { LiveRunForIssue } from "@/api/heartbeats";
import { TasksLiveNowSection, liveNowCollapsedStorageKey } from "@/components/TasksLiveNowSection";
import { storybookIssues } from "../fixtures/paperclipData";

const EXPANDED_COMPANY_ID = "company-live-now-expanded";
const COLLAPSED_COMPANY_ID = "company-live-now-collapsed";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const seconds = (count: number) => count * 1000;
const minutes = (count: number) => count * 60_000;

function liveIssue(id: string, identifier: string, title: string, parentId: string | null): Issue {
  return { ...storybookIssues[0]!, id, identifier, title, parentId, status: "in_progress" };
}

const issues: Issue[] = [
  liveIssue("issue-root", "ZHA-379", "OpenWA rollout", null),
  liveIssue("issue-approvals", "ZHA-412", "Wire WhatsApp approval cards into the inbox", "issue-root"),
  liveIssue("issue-share", "ZHA-418", "Audit share-link expiry for public tasks", "issue-root"),
  liveIssue("issue-mcp", "ZHA-420", "Regenerate MCP tool schemas after the route rename", "issue-root"),
  liveIssue("issue-hmsi", "ZHA-377", "Backfill HMSI delivery receipts", null),
  liveIssue("issue-release", "ZHA-425", "Draft release notes for 2026.1009", "issue-root"),
];

function silence(level: "suspicious" | "critical", ageMs: number): NonNullable<LiveRunForIssue["outputSilence"]> {
  return {
    lastOutputAt: ago(ageMs),
    lastOutputSeq: 42,
    lastOutputStream: "stdout",
    silenceStartedAt: ago(ageMs),
    silenceAgeMs: ageMs,
    level,
    suspicionThresholdMs: minutes(5),
    criticalThresholdMs: minutes(15),
    snoozedUntil: null,
    evaluationIssueId: null,
    evaluationIssueIdentifier: null,
    evaluationIssueAssigneeAgentId: null,
  };
}

function liveRun(overrides: Partial<LiveRunForIssue> & Pick<LiveRunForIssue, "id" | "issueId" | "agentId" | "agentName">): LiveRunForIssue {
  return {
    status: "running",
    invocationSource: "assignment",
    triggerDetail: null,
    startedAt: ago(minutes(10)),
    finishedAt: null,
    createdAt: ago(minutes(10)),
    adapterType: "omp_local",
    runtimeMode: "native",
    ...overrides,
  };
}

const liveRuns: LiveRunForIssue[] = [
  liveRun({
    id: "run-release",
    issueId: "issue-release",
    agentId: "agent-writer",
    agentName: "Writer",
    startedAt: ago(seconds(12)),
    createdAt: ago(seconds(14)),
  }),
  liveRun({
    id: "run-approvals",
    issueId: "issue-approvals",
    agentId: "agent-builder",
    agentName: "Builder",
    startedAt: ago(minutes(14)),
    currentToolName: "bash",
    currentStatusMessage: "Running bash",
    currentStatusUpdatedAt: ago(seconds(6)),
    lastAssistantSnippet: "Tests pass locally. Rebasing on main before pushing the approval-card fix.",
    lastEventAt: ago(seconds(6)),
    nextAction: "Push the approval-card fix and watch CI",
  }),
  liveRun({
    id: "run-share",
    issueId: "issue-share",
    agentId: "agent-reviewer",
    agentName: "Reviewer",
    startedAt: ago(minutes(6)),
    currentStatusMessage: "Thinking",
    lastAssistantSnippet:
      "The expiry check runs after the token lookup, so revoked links still leak the task title. Checking the router order next.",
    lastEventAt: ago(seconds(20)),
  }),
  liveRun({
    id: "run-mcp",
    issueId: "issue-mcp",
    agentId: "agent-scribe",
    agentName: "Scribe",
    startedAt: ago(minutes(22)),
    currentToolName: "wait",
    currentStatusMessage: "Running wait",
    lastAssistantSnippet: "Waiting for the schema generator to finish before diffing api-tools.json.",
    lastEventAt: ago(minutes(6)),
    outputSilence: silence("suspicious", minutes(6)),
  }),
  liveRun({
    id: "run-hmsi",
    issueId: "issue-hmsi",
    agentId: "agent-operator",
    agentName: "Operator",
    startedAt: ago(minutes(41)),
    currentToolName: "fabric_exec",
    currentStatusMessage: "Finished fabric_exec",
    lastAssistantSnippet: "Replaying receipts 1,200 to 1,800 against erptest.",
    lastEventAt: ago(minutes(19)),
    outputSilence: silence("critical", minutes(19)),
  }),
];

function LiveNowStage({ companyId }: { companyId: string }) {
  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
      <TasksLiveNowSection companyId={companyId} liveRuns={liveRuns} issues={issues} />
    </div>
  );
}

const meta = {
  title: "Product/Tasks/Live now",
  component: LiveNowStage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LiveNowStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  args: { companyId: EXPANDED_COMPANY_ID },
  beforeEach: () => {
    window.localStorage.removeItem(liveNowCollapsedStorageKey(EXPANDED_COMPANY_ID));
  },
};

export const Collapsed: Story = {
  args: { companyId: COLLAPSED_COMPANY_ID },
  beforeEach: () => {
    window.localStorage.setItem(liveNowCollapsedStorageKey(COLLAPSED_COMPANY_ID), "true");
    return () => window.localStorage.removeItem(liveNowCollapsedStorageKey(COLLAPSED_COMPANY_ID));
  },
};
