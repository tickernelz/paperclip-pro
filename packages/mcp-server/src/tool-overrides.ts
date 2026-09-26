export type ToolsetName = "core" | "extended";

export interface ToolAnnotationOverride {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolOverride {
  name?: string;
  description?: string;
  toolset?: ToolsetName;
  annotations?: ToolAnnotationOverride;
  requiredHint?: string;
  bodyFields?: string[];
}

export const CURATED_OPERATIONS: Record<string, string> = {
  "GET /api/agents/me": "paperclipMe",
  "GET /api/agents/me/inbox-lite": "paperclipInboxLite",
  "GET /api/agents/{id}": "paperclipGetAgent",
  "GET /api/companies/{companyId}/agents": "paperclipListAgents",
  "GET /api/companies/{companyId}/skills": "paperclipListSkills",
  "GET /api/companies/{companyId}/issues": "paperclipListIssues",
  "POST /api/companies/{companyId}/issues": "paperclipCreateIssue",
  "GET /api/issues/{id}": "paperclipGetIssue",
  "PATCH /api/issues/{id}": "paperclipUpdateIssue",
  "GET /api/issues/{id}/heartbeat-context": "paperclipGetHeartbeatContext",
  "GET /api/issues/{id}/comments": "paperclipListComments",
  "POST /api/issues/{id}/comments": "paperclipAddComment",
  "GET /api/issues/{id}/comments/{commentId}": "paperclipGetComment",
  "POST /api/issues/{id}/checkout": "paperclipCheckoutIssue",
  "POST /api/issues/{id}/release": "paperclipReleaseIssue",
  "GET /api/issues/{id}/approvals": "paperclipListIssueApprovals",
  "POST /api/issues/{id}/approvals": "paperclipLinkIssueApproval",
  "DELETE /api/issues/{id}/approvals/{approvalId}": "paperclipUnlinkIssueApproval",
  "GET /api/issues/{id}/documents": "paperclipListDocuments",
  "GET /api/issues/{id}/documents/{key}": "paperclipGetDocument",
  "PUT /api/issues/{id}/documents/{key}": "paperclipUpsertIssueDocument",
  "GET /api/issues/{id}/documents/{key}/revisions": "paperclipListDocumentRevisions",
  "POST /api/issues/{id}/documents/{key}/revisions/{revisionId}/restore":
    "paperclipRestoreIssueDocumentRevision",
  "POST /api/issues/{id}/interactions": "paperclipSuggestTasks",
  "GET /api/companies/{companyId}/projects": "paperclipListProjects",
  "GET /api/projects/{id}": "paperclipGetProject",
  "GET /api/companies/{companyId}/goals": "paperclipListGoals",
  "GET /api/goals/{id}": "paperclipGetGoal",
  "GET /api/companies/{companyId}/approvals": "paperclipListApprovals",
  "POST /api/companies/{companyId}/approvals": "paperclipCreateApproval",
  "GET /api/approvals/{id}": "paperclipGetApproval",
  "GET /api/approvals/{id}/issues": "paperclipGetApprovalIssues",
  "GET /api/approvals/{id}/comments": "paperclipListApprovalComments",
  "POST /api/approvals/{id}/comments": "paperclipAddApprovalComment",
  "POST /api/approvals/{id}/approve": "paperclipApprovalDecision",
  "POST /api/approvals/{id}/reject": "paperclipApprovalDecision",
  "POST /api/approvals/{id}/request-revision": "paperclipApprovalDecision",
  "POST /api/approvals/{id}/resubmit": "paperclipApprovalDecision",
  "POST /api/execution-workspaces/{id}/runtime-services/{action}":
    "paperclipControlIssueWorkspaceServices",
};

export const EXCLUDED_OPERATIONS: Record<string, string> = {
  "POST /api/companies/{companyId}/exports": "credential_surface",
  "POST /api/companies/{companyId}/exports/preview": "credential_surface",
  "POST /api/companies/{companyId}/imports/preview": "company_transfer",
  "POST /api/companies/{companyId}/imports/apply": "company_transfer",
  "POST /api/issues/{id}/admin/force-release": "runner_lifecycle_authority",
  "POST /api/issues/{id}/low-trust/promotions": "trust_boundary",
  "POST /api/companies/{companyId}/onboarding-seed": "instance_setup",
  "POST /api/companies/import/transfers/{transferId}/apply": "company_transfer",
  "POST /api/tool-gateway/sessions": "credential_surface",
  "POST /api/tool-gateway/sessions/{sessionId}/revoke": "credential_surface",
  "POST /api/tool-gateway/runtime-slots/{slotId}/restart": "runtime_authority",
  "POST /api/tool-gateway/runtime-slots/{slotId}/stop": "runtime_authority",
};

export const PROBE_BOARD_DENIED_OPERATIONS: Record<string, string> = {
  "GET /api/companies/{companyId}/agent-configurations": "agent principal is not an active member",
  "GET /api/companies/{companyId}/audit/agent-actions": "Board access required",
  "GET /api/companies/{companyId}/claude-oauth-token-status": "A user must own a setup-token login session",
  "GET /api/companies/{companyId}/environments": "Board access required",
  "GET /api/companies/{companyId}/environments/capabilities": "Board access required",
  "GET /api/companies/{companyId}/export/fidelity": "Only CEO agents can manage company export fidelity",
  "GET /api/companies/{companyId}/inbox-dismissals": "Board authentication required",
  "GET /api/companies/{companyId}/sidebar-preferences/me": "Board access required",
  "GET /api/companies/{companyId}/users/me/inbox-agent-policy": "Board user context required",
  "GET /api/environments/{id}": "Board access required",
  "GET /api/environments/{id}/delete-blast-radius": "Instance environment management is restricted to board operators",
  "GET /api/environments/{id}/leases": "Board access required",
  "GET /api/environments/{id}/secret-refs": "Instance environment management is restricted to board operators",
  "GET /api/issues/{id}/feedback-traces": "Only board users can view feedback traces",
  "GET /api/issues/{id}/feedback-votes": "Only board users can view feedback votes",
  "GET /api/sidebar-preferences/me": "Board access required",
  "GET /api/tool-gateway/audit": "Board access required",
  "GET /api/tool-gateway/runtime-slots": "Board access required",
  "GET /api/tool-gateway/tools": "Tool gateway session token is required",
};

export const TOOL_OVERRIDES: Record<string, ToolOverride> = {
  "GET /api/agents/me/inbox/mine": {
    name: "paperclipInbox",
    description:
      "List the full Mine inbox for one board user, selected by userId. Use paperclipInboxLite first for the authenticated agent's own compact list; reach for this only when you need the complete issue objects.",
    toolset: "core",
  },
  "GET /api/companies/{companyId}/dashboard": {
    name: "paperclipDashboard",
    description:
      "Read the company dashboard summary. Use for a company-wide status overview before planning or reporting.",
    toolset: "core",
  },
  "GET /api/issues/{id}/interactions": {
    name: "paperclipListIssueInteractions",
    description:
      "List issue-thread interactions with their status. Use to check whether a question, confirmation, or plan approval you raised is still pending.",
    toolset: "core",
  },
  "POST /api/issues/{id}/interactions/{interactionId}/withdraw": {
    name: "paperclipWithdrawIssueInteraction",
    description:
      "Withdraw a pending issue-thread interaction you raised and no longer need answered.",
    toolset: "core",
    annotations: { destructiveHint: true },
  },
  "GET /api/issues/{id}/watchdog": {
    name: "paperclipGetIssueWatchdog",
    description: "Read the watchdog/monitor configuration for an issue.",
    toolset: "core",
  },
  "PUT /api/issues/{id}/watchdog": {
    name: "paperclipSetIssueWatchdog",
    description:
      "Schedule or clear the issue monitor. Use only when you really want the assignee woken later; never claim a watcher without writing one.",
    toolset: "core",
  },
  "GET /api/issues/{id}/attachments": {
    name: "paperclipListIssueAttachments",
    description: "List files attached to an issue.",
    toolset: "core",
  },
  "DELETE /api/attachments/{attachmentId}": {
    name: "paperclipDeleteAttachment",
    description: "Delete an issue attachment. Irreversible.",
    toolset: "core",
    annotations: { destructiveHint: true },
  },
  "GET /api/companies/{companyId}/routines": {
    name: "paperclipListRoutines",
    description:
      "List company routines. Agents may only manage routines assigned to themselves.",
    toolset: "extended",
  },
  "DELETE /api/issues/{id}": {
    name: "paperclipDeleteIssue",
    description:
      "Delete an issue permanently. Prefer cancelling via paperclipUpdateIssue; deletion loses the thread.",
    toolset: "extended",
    annotations: { destructiveHint: true },
  },
  "POST /api/companies/{companyId}/projects": {
    name: "paperclipCreateProject",
    description: "Create a project in the company.",
    toolset: "core",
    bodyFields: [
      "color",
      "description",
      "goalId",
      "goalIds",
      "idempotencyKey",
      "leadAgentId",
      "repositoryIds",
      "repositoryUrls",
      "status",
      "targetDate",
    ],
  },
  "POST /api/companies/{companyId}/goals": {
    name: "paperclipCreateGoal",
    description: "Create a company goal that issues can be linked to.",
    toolset: "core",
  },
  "POST /api/issues/{id}/children": {
    name: "paperclipCreateChildIssue",
    description:
      "Create a child issue under an existing issue. Use for delegated or parallel follow-up work; the child inherits the parent execution workspace.",
    toolset: "core",
  },
  "GET /api/issues": {
    name: "paperclipListAllIssues",
    description:
      "List issues across every company the caller can access. Prefer paperclipListIssues when you already know the company.",
    toolset: "extended",
  },
  "GET /api/issues/{id}/work-products": {
    name: "paperclipListIssueWorkProducts",
    description:
      "List the work products recorded on an issue: pull requests, preview URLs, runtime services, commits, branches, artifacts.",
    toolset: "core",
  },
  "POST /api/issues/{id}/work-products": {
    name: "paperclipCreateIssueWorkProduct",
    description:
      "Record an operator-facing work product on an issue. Use for every opened PR, published preview, managed service, notable commit, handoff branch, or uploaded artifact.",
    toolset: "core",
  },
  "PATCH /api/work-products/{id}": {
    name: "paperclipUpdateWorkProduct",
    description: "Update a recorded work product, for example when a pull request merges.",
    toolset: "core",
  },
  "GET /api/execution-workspaces/{id}": {
    name: "paperclipGetExecutionWorkspace",
    description:
      "Read one execution workspace with its runtime services. Prefer paperclipGetIssueWorkspaceRuntime when you start from an issue.",
    toolset: "core",
  },
  "PATCH /api/projects/{id}": {
    name: "paperclipUpdateProject",
    description: "Update a project's name, description, or settings.",
    toolset: "core",
    bodyFields: [
      "archivedAt",
      "color",
      "description",
      "goalId",
      "goalIds",
      "leadAgentId",
      "name",
      "status",
      "targetDate",
    ],
  },
  "PATCH /api/goals/{id}": {
    name: "paperclipUpdateGoal",
    description: "Update a goal's title, description, status, or target date.",
    toolset: "core",
  },
  "GET /api/companies/{companyId}/labels": {
    name: "paperclipListLabels",
    description:
      "List company issue labels. Use to resolve a label id before filtering issues by labelId.",
    toolset: "core",
  },
  "GET /api/sidebar-preferences/me": {
    name: "paperclipGetSidebarPreferences",
    description: "Read the caller's sidebar ordering preferences.",
    toolset: "extended",
  },
  "PUT /api/sidebar-preferences/me": {
    name: "paperclipSetSidebarPreferences",
    description: "Replace the caller's sidebar ordering preferences.",
    toolset: "extended",
  },
};
