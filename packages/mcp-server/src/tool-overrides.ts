export type ToolsetName = "core" | "extended" | "openwa";

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
  queryDefaults?: Record<string, string | number | boolean>;
}

export const CURATED_OPERATIONS: Record<string, string> = {
  "GET /api/agents/me": "wardmoteMe",
  "GET /api/agents/me/inbox-lite": "wardmoteInboxLite",
  "GET /api/agents/{id}": "wardmoteGetAgent",
  "GET /api/companies/{companyId}/agents": "wardmoteListAgents",
  "GET /api/companies/{companyId}/skills": "wardmoteListSkills",
  "GET /api/companies/{companyId}/issues": "wardmoteListIssues",
  "POST /api/companies/{companyId}/issues": "wardmoteCreateIssue",
  "GET /api/issues/{id}": "wardmoteGetIssue",
  "PATCH /api/issues/{id}": "wardmoteUpdateIssue",
  "GET /api/issues/{id}/heartbeat-context": "wardmoteGetHeartbeatContext",
  "GET /api/issues/{id}/comments": "wardmoteListComments",
  "POST /api/issues/{id}/comments": "wardmoteAddComment",
  "GET /api/issues/{id}/comments/{commentId}": "wardmoteGetComment",
  "POST /api/issues/{id}/checkout": "wardmoteCheckoutIssue",
  "POST /api/issues/{id}/release": "wardmoteReleaseIssue",
  "GET /api/issues/{id}/approvals": "wardmoteListIssueApprovals",
  "POST /api/issues/{id}/approvals": "wardmoteLinkIssueApproval",
  "DELETE /api/issues/{id}/approvals/{approvalId}": "wardmoteUnlinkIssueApproval",
  "GET /api/issues/{id}/documents": "wardmoteListDocuments",
  "GET /api/issues/{id}/documents/{key}": "wardmoteGetDocument",
  "PUT /api/issues/{id}/documents/{key}": "wardmoteUpsertIssueDocument",
  "GET /api/issues/{id}/documents/{key}/revisions": "wardmoteListDocumentRevisions",
  "POST /api/issues/{id}/documents/{key}/revisions/{revisionId}/restore":
    "wardmoteRestoreIssueDocumentRevision",
  "POST /api/issues/{id}/interactions": "wardmoteSuggestTasks",
  "GET /api/companies/{companyId}/projects": "wardmoteListProjects",
  "GET /api/projects/{id}": "wardmoteGetProject",
  "GET /api/companies/{companyId}/goals": "wardmoteListGoals",
  "GET /api/goals/{id}": "wardmoteGetGoal",
  "GET /api/companies/{companyId}/approvals": "wardmoteListApprovals",
  "POST /api/companies/{companyId}/approvals": "wardmoteCreateApproval",
  "GET /api/approvals/{id}": "wardmoteGetApproval",
  "GET /api/approvals/{id}/issues": "wardmoteGetApprovalIssues",
  "GET /api/approvals/{id}/comments": "wardmoteListApprovalComments",
  "POST /api/approvals/{id}/comments": "wardmoteAddApprovalComment",
  "POST /api/approvals/{id}/approve": "wardmoteApprovalDecision",
  "POST /api/approvals/{id}/reject": "wardmoteApprovalDecision",
  "POST /api/approvals/{id}/request-revision": "wardmoteApprovalDecision",
  "POST /api/approvals/{id}/resubmit": "wardmoteApprovalDecision",
  "POST /api/execution-workspaces/{id}/runtime-services/{action}":
    "wardmoteControlIssueWorkspaceServices",
};

export const EXCLUDED_OPERATIONS: Record<string, string> = {
  "GET /api/issues": "route_stub",
  "GET /api/plugins/{pluginId}/bridge/stream/{channel}": "sse_stream",
  "POST /api/companies/{companyId}/exports": "credential_surface",
  "POST /api/companies/{companyId}/exports/preview": "credential_surface",
  "POST /api/companies/{companyId}/imports/preview": "company_transfer",
  "POST /api/companies/{companyId}/imports/apply": "company_transfer",
  "POST /api/issues/{id}/admin/force-release": "runner_lifecycle_authority",
  "POST /api/issues/{id}/low-trust/promotions": "trust_boundary",
  "POST /api/companies/import/transfers/{transferId}/apply": "company_transfer",
  "POST /api/tool-gateway/sessions": "credential_surface",
  "POST /api/tool-gateway/sessions/{sessionId}/revoke": "credential_surface",
  "POST /api/tool-gateway/runtime-slots/{slotId}/restart": "runtime_authority",
  "POST /api/tool-gateway/runtime-slots/{slotId}/stop": "runtime_authority",
  "GET /api/companies/{companyId}/terminal/sessions": "trust_boundary",
  "POST /api/companies/{companyId}/terminal/sessions": "trust_boundary",
  "DELETE /api/companies/{companyId}/terminal/sessions/{sessionId}": "trust_boundary",
  "POST /api/companies/{companyId}/terminal/sessions/{sessionId}/token": "trust_boundary",
  "POST /api/companies/{companyId}/terminal/sessions/{sessionId}/upload": "trust_boundary",
  "POST /api/companies/{companyId}/terminal/sessions/{sessionId}/paste-image": "trust_boundary",
  "GET /api/companies/{companyId}/terminal/ssh-hosts": "trust_boundary",
  "POST /api/companies/{companyId}/terminal/ssh-hosts": "trust_boundary",
  "DELETE /api/companies/{companyId}/terminal/ssh-hosts/{hostId}": "trust_boundary",
  "GET /api/companies/{companyId}/terminal/sessions/{sessionId}/download": "trust_boundary",
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
  "GET /api/companies/{companyId}/heartbeat-runs": { queryDefaults: { limit: 50, summary: true } },
  "GET /api/companies/{companyId}/activity": { queryDefaults: { limit: 50 } },
  "GET /api/companies/{companyId}/live-runs": { queryDefaults: { limit: 50 } },
  "GET /api/routines/{id}/runs": { queryDefaults: { limit: 50 } },
  "GET /api/agents/me/inbox/mine": {
    name: "wardmoteInbox",
    description:
      "List the full Mine inbox for one board user, selected by userId. Use wardmoteInboxLite first for the authenticated agent's own compact list; reach for this only when you need the complete issue objects.",
    toolset: "core",
  },
  "GET /api/companies/{companyId}/dashboard": {
    name: "wardmoteDashboard",
    description:
      "Read the company dashboard summary. Use for a company-wide status overview before planning or reporting.",
    toolset: "core",
  },
  "GET /api/issues/{id}/interactions": {
    name: "wardmoteListIssueInteractions",
    description:
      "List issue-thread interactions with their status. Use to check whether a question, confirmation, or plan approval you raised is still pending.",
    toolset: "core",
  },
  "GET /api/companies/{companyId}/pending-decisions": {
    name: "wardmoteListPendingDecisions",
    description:
      "List Decisions-desk items waiting on a human. Default scope=relay is PARTIAL (relayable cards and approvals; empty never means an empty desk). scope=desk is the whole Decisions page, every sourceKind, for a run the owner started.",
    toolset: "core",
  },
  "POST /api/issues/{id}/interactions/{interactionId}/answer-for-owner": {
    name: "wardmoteAnswerDecisionForOwner",
    description:
      "Submit the owner's explicit answer to one card from the run their own message (ownerMessageRef) started. advanced: answers, verdicts, note.",
    toolset: "core",
    bodyFields: ["ownerMessageRef", "decision", "optionIds", "reason"],
  },
  "POST /api/issues/{id}/continue-for-owner": {
    name: "wardmoteContinueIssueForOwner",
    description:
      "Continue a 'Recovery needed' issue on the owner's explicit request, from the run their own message (ownerMessageRef) started.",
    toolset: "core",
  },
  "POST /api/issues/{id}/interactions/{interactionId}/withdraw": {
    name: "wardmoteWithdrawIssueInteraction",
    description:
      "Withdraw a pending issue-thread interaction you raised and no longer need answered.",
    toolset: "core",
    annotations: { destructiveHint: true },
  },
  "GET /api/issues/{id}/watchdog": {
    name: "wardmoteGetIssueWatchdog",
    description:
      "Read the task watchdog for an issue: the agent that reviews the issue subtree after it stops. This is not the issue monitor; read monitorNextCheckAt from the issue.",
    toolset: "core",
  },
  "PUT /api/issues/{id}/watchdog": {
    name: "wardmoteSetIssueWatchdog",
    description:
      "Assign or replace the task watchdog agent that reviews the issue subtree after it stops. It does not schedule the issue monitor: schedule a timed re-check with wardmoteUpdateIssue advanced.executionPolicy.monitor.nextCheckAt.",
    toolset: "core",
  },
  "GET /api/issues/{id}/attachments": {
    name: "wardmoteListIssueAttachments",
    description: "List files attached to an issue.",
    toolset: "core",
  },
  "DELETE /api/attachments/{attachmentId}": {
    name: "wardmoteDeleteAttachment",
    description: "Delete an issue attachment. Irreversible.",
    toolset: "core",
    annotations: { destructiveHint: true },
  },
  "GET /api/companies/{companyId}/routines": {
    name: "wardmoteListRoutines",
    description:
      "List company routines. Agents may only manage routines assigned to themselves.",
    toolset: "extended",
  },
  "DELETE /api/issues/{id}": {
    name: "wardmoteDeleteIssue",
    description:
      "Delete an issue permanently. Prefer cancelling via wardmoteUpdateIssue; deletion loses the thread.",
    toolset: "extended",
    annotations: { destructiveHint: true },
  },
  "POST /api/companies/{companyId}/projects": {
    name: "wardmoteCreateProject",
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
    name: "wardmoteCreateGoal",
    description: "Create a company goal that issues can be linked to.",
    toolset: "core",
  },
  "POST /api/issues/{id}/children": {
    name: "wardmoteCreateChildIssue",
    description:
      "Create a child issue under an existing issue. This is the default for work arising from the issue you hold (follow-up, deploy, fix, review, delegated or parallel work): pass that issue as issueId. The child inherits the parent execution workspace. To ask another agent to review work on the issue you are assigned, set reviewOfParent: true: the child then blocks your issue, you keep it, and the request is allowed even when that agent created an open ancestor (otherwise 409 delegation_cycle).",
    toolset: "core",
  },
  "GET /api/issues/{id}/work-products": {
    name: "wardmoteListIssueWorkProducts",
    description:
      "List the work products recorded on an issue: pull requests, preview URLs, runtime services, commits, branches, artifacts.",
    toolset: "core",
  },
  "POST /api/issues/{id}/work-products": {
    name: "wardmoteCreateIssueWorkProduct",
    description:
      "Record an operator-facing work product on an issue. Use for every opened PR, published preview, managed service, notable commit, handoff branch, or uploaded artifact.",
    toolset: "core",
  },
  "GET /api/issues/{id}/share-link": {
    name: "wardmoteGetIssueShareLink",
    description: "Get the active public read-only share link of an issue, or null when it is not shared.",
    toolset: "core",
  },
  "POST /api/issues/{id}/share-link": {
    name: "wardmoteCreateIssueShareLink",
    description:
      "Create (or return the existing) public read-only link to an issue for an external requester. Any agent that can read the issue may call this, even while another agent's run holds its checkout. Anyone with the URL sees the issue, agent comments, documents, attachments and one-hop related issues without logging in, until the link is revoked.",
    toolset: "core",
  },
  "DELETE /api/issues/{id}/share-link": {
    name: "wardmoteRevokeIssueShareLink",
    description:
      "Revoke the public share link of an issue; the URL and every download under it stop working. Any agent that can read the issue may revoke it, even while another agent's run holds its checkout.",
    toolset: "core",
  },
  "PATCH /api/work-products/{id}": {
    name: "wardmoteUpdateWorkProduct",
    description: "Update a recorded work product, for example when a pull request merges.",
    toolset: "core",
  },
  "GET /api/execution-workspaces/{id}": {
    name: "wardmoteGetExecutionWorkspace",
    description:
      "Read one execution workspace with its runtime services. Prefer wardmoteGetIssueWorkspaceRuntime when you start from an issue.",
    toolset: "core",
  },
  "PATCH /api/projects/{id}": {
    name: "wardmoteUpdateProject",
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
    name: "wardmoteUpdateGoal",
    description: "Update a goal's title, description, status, or target date.",
    toolset: "core",
  },
  "GET /api/companies/{companyId}/labels": {
    name: "wardmoteListLabels",
    description:
      "List company issue labels. Use to resolve a label id before filtering issues by labelId.",
    toolset: "core",
  },
  "GET /api/sidebar-preferences/me": {
    name: "wardmoteGetSidebarPreferences",
    description: "Read the caller's sidebar ordering preferences.",
    toolset: "extended",
  },
  "PUT /api/sidebar-preferences/me": {
    name: "wardmoteSetSidebarPreferences",
    description: "Replace the caller's sidebar ordering preferences.",
    toolset: "extended",
  },
};
