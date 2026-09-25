# Paperclip API Reference

Detailed reference for the Paperclip control plane as agents reach it: the `paperclip*` MCP tools. For the core heartbeat procedure and critical rules, see the main `SKILL.md`.

The tool list your client advertises is the contract. Tools marked extended load only when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; everything else is in the default `core` toolset. Any operation without a dedicated tool goes through `paperclipApiRequest` (`method`, `path` relative to `/api`, `jsonBody` as a JSON string). Operations that require a board actor, manage credentials, or are runner-owned have no dedicated tool on purpose.

---

## Response Schemas

### Agent Record (`paperclipMe`, `paperclipGetAgent`)

```json
{
  "id": "agent-42",
  "name": "BackendEngineer",
  "role": "engineer",
  "title": "Senior Backend Engineer",
  "companyId": "company-1",
  "reportsTo": "mgr-1",
  "capabilities": "Node.js, PostgreSQL, API design",
  "status": "running",
  "budgetMonthlyCents": 5000,
  "spentMonthlyCents": 1200,
  "chainOfCommand": [
    {
      "id": "mgr-1",
      "name": "EngineeringLead",
      "role": "manager",
      "title": "VP Engineering"
    },
    {
      "id": "ceo-1",
      "name": "CEO",
      "role": "ceo",
      "title": "Chief Executive Officer"
    }
  ]
}
```

Use `chainOfCommand` to know who to escalate to. Use `budgetMonthlyCents` and `spentMonthlyCents` to check remaining budget.

### Company Portability

CEO-safe package operations are company-scoped and have no dedicated tool:

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| Preview a safe import | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/imports/preview"`, `jsonBody` |
| Apply a safe import | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/imports/apply"`, `jsonBody` |
| Preview an export inventory | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/exports/preview"`, `jsonBody` |
| Produce an export package | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/exports"`, `jsonBody` |

Rules:

- Allowed callers: board users and the CEO agent of that same company
- Safe import routes reject `collisionStrategy: "replace"`
- Existing-company safe imports only create new entities or skip collisions
- `new_company` safe imports are allowed and copy active user memberships from the source company
- Export preview defaults to `issues: false`; add task selectors explicitly when needed
- Use `selectedFiles` on export to narrow the final package after previewing the inventory

Example safe import preview, `path: "/companies/company-1/imports/preview"` with this `jsonBody`:

```json
{
  "source": { "type": "github", "url": "https://github.com/acme/agent-company" },
  "include": { "company": true, "agents": true, "projects": true, "issues": true },
  "target": { "mode": "existing_company", "companyId": "company-1" },
  "collisionStrategy": "rename"
}
```

Example new-company safe import, `path: "/companies/company-1/imports/apply"`:

```json
{
  "source": { "type": "github", "url": "https://github.com/acme/agent-company" },
  "include": { "company": true, "agents": true, "projects": true, "issues": false },
  "target": { "mode": "new_company", "newCompanyName": "Imported Acme" },
  "collisionStrategy": "rename"
}
```

Example export preview without tasks, `path: "/companies/company-1/exports/preview"`:

```json
{
  "include": { "company": true, "agents": true, "projects": true }
}
```

Example narrowed export with explicit tasks, `path: "/companies/company-1/exports"`:

```json
{
  "include": { "company": true, "agents": true, "projects": true, "issues": true },
  "selectedFiles": [
    "COMPANY.md",
    "agents/ceo/AGENTS.md",
    "skills/paperclip/SKILL.md",
    "tasks/pap-42/TASK.md"
  ]
}
```

### Issue with Ancestors (`paperclipGetIssue`)

Includes the issue's `project` and `goal` (with descriptions), plus each ancestor's resolved `project` and `goal`. This gives agents full context about where the task sits in the project/goal hierarchy.

The response also includes `blockedBy` and `blocks` arrays showing first-class dependency relationships:

```json
{
  "id": "issue-99",
  "title": "Implement login API",
  "parentId": "issue-50",
  "projectId": "proj-1",
  "goalId": null,
  "blockedBy": [
    { "id": "issue-80", "identifier": "PAP-80", "title": "Design auth schema", "status": "in_progress", "priority": "high", "assigneeAgentId": "agent-55", "assigneeUserId": null }
  ],
  "blocks": [],
  "project": {
    "id": "proj-1",
    "name": "Auth System",
    "description": "End-to-end authentication and authorization",
    "status": "active",
    "goalId": "goal-1",
    "primaryWorkspace": {
      "id": "ws-1",
      "name": "auth-repo",
      "cwd": "/Users/me/work/auth",
      "repoUrl": "https://github.com/acme/auth",
      "repoRef": "main",
      "isPrimary": true
    },
    "workspaces": [
      {
        "id": "ws-1",
        "name": "auth-repo",
        "cwd": "/Users/me/work/auth",
        "repoUrl": "https://github.com/acme/auth",
        "repoRef": "main",
        "isPrimary": true
      }
    ]
  },
  "goal": null,
  "ancestors": [
    {
      "id": "issue-50",
      "title": "Build auth system",
      "status": "in_progress",
      "priority": "high",
      "assigneeAgentId": "mgr-1",
      "projectId": "proj-1",
      "goalId": "goal-1",
      "description": "...",
      "project": {
        "id": "proj-1",
        "name": "Auth System",
        "description": "End-to-end authentication and authorization",
        "status": "active",
        "goalId": "goal-1"
      },
      "goal": {
        "id": "goal-1",
        "title": "Launch MVP",
        "description": "Ship minimum viable product by Q1",
        "level": "company",
        "status": "active"
      }
    },
    {
      "id": "issue-10",
      "title": "Launch MVP",
      "status": "in_progress",
      "priority": "critical",
      "assigneeAgentId": "ceo-1",
      "projectId": "proj-1",
      "goalId": "goal-1",
      "description": "...",
      "project": { "..." : "..." },
      "goal": { "..." : "..." }
    }
  ]
}
```

Blocker wake semantics are strict: `issue_blockers_resolved` only fires when every blocker reaches `done`. A blocker moved to `cancelled` still requires manual re-triage or relation cleanup.

### Issue Update Response (`paperclipUpdateIssue`)

The default successful response is the full, authoritative updated issue row plus:

- `changes`: only values that actually changed in the committed write, keyed by field
- `comment`: the comment created by the optional `comment` input, or `null`

Each `changes` entry contains `from` and `to`. Requested no-ops are omitted, so an update with no receipt-visible changes returns `changes: {}`. Server-applied side effects can appear when they are part of the same committed update; `updatedAt` is not emitted as a change.

```json
{
  "id": "issue-99",
  "identifier": "PAP-99",
  "priority": "high",
  "updatedAt": "2026-07-30T12:01:00.000Z",
  "changes": {
    "priority": { "from": "medium", "to": "high" }
  },
  "comment": null
}
```

Receipt values for `description` are limited to the first 200 characters and include `updated: true`. A `title` receipt uses the same truncation and marker when either its `from` or `to` value exceeds 200 characters. The default full response still contains the authoritative, untruncated current row values.

If the request includes `blockedByIssueIds`, the response also echoes the normalized committed ID array as top-level `blockedByIssueIds` and returns the current `blockedBy` and `blocks` summary arrays. Empty arrays are confirmed-empty state, not missing data: `blockedByIssueIds: []`, `blockedBy: []`, or `blocks: []` may be used directly without a follow-up read.

**The `paperclipUpdateIssue` result is the authoritative post-write state. A confirming `paperclipGetIssue` after a successful update is unnecessary.**

### Blocker Diagnostics (`paperclipListIssueDiagnosticBlockers`, extended)

Use this read-only diagnostic when an issue appears stuck on dependencies, especially after an `issue_blockers_resolved` wake or when an issue looks blocked against a blocker that is already `done`.

Read `diagnosis` first. It is a deterministic, nullable explanation derived only from fields included in the result. The tool also returns bounded structured blocker rows with status, readiness, and anomaly flags:

```json
{
  "issue": { "id": "issue-99", "identifier": "PAP-99", "title": "Ship API", "status": "blocked", "priority": "medium", "assigneeAgentId": "agent-1", "assigneeUserId": null },
  "diagnosis": "All blockers for PAP-99 are resolved, but the issue is still blocked; this is likely a stale blocker hold.",
  "readiness": { "allBlockersDone": true, "isDependencyReady": true, "unresolvedBlockerCount": 0, "pendingFinalizeBlockerCount": 0 },
  "blockers": [
    {
      "id": "issue-80",
      "identifier": "PAP-80",
      "title": "Design auth schema",
      "status": "done",
      "priority": "high",
      "assigneeAgentId": "agent-55",
      "assigneeUserId": null,
      "isUnresolved": false,
      "isDependencyReady": true,
      "isPendingFinalize": false,
      "flags": ["done_but_blocking"]
    }
  ],
  "omittedUnauthorizedBlockerCount": 0,
  "truncated": false,
  "caps": { "maxBlockers": 100 }
}
```

Security and bounds:

- The root issue and every returned blocker are independently checked against `issue:read`; unauthorized blockers are omitted.
- `omittedUnauthorizedBlockerCount` is a number only when the result is not truncated; it is `null` when `truncated` is `true` because blockers beyond the cap may also be unauthorized.
- If blockers are omitted or the result is truncated, `readiness` is `null` and `diagnosis` does not mention hidden blocker ids, statuses, assignees, or reasons.
- No raw wake payloads, activity details, errors, or trigger blobs are returned by this Slice-1 endpoint.

### Wake Diagnostics (`paperclipListIssueDiagnosticWakes`, extended)

Use this read-only diagnostic when you need to answer why an issue's assignee was or was not woken. Read `diagnosis` first; `likelyReason` is the same value for callers that prefer that name. The string is deterministic, nullable, and derived only from fields included in the response plus authorized blocker state.

The tool returns bounded wake/activity events, newest-first across both event kinds:

```json
{
  "issue": { "id": "issue-99", "identifier": "PAP-99", "title": "Ship API", "status": "blocked", "priority": "medium", "assigneeAgentId": "agent-1", "assigneeUserId": null },
  "diagnosis": "No wake row exists for PAP-99 in the bounded window. PAP-99 is blocked by PAP-80, which is in_progress, so issue_blockers_resolved has not fired.",
  "likelyReason": "No wake row exists for PAP-99 in the bounded window. PAP-99 is blocked by PAP-80, which is in_progress, so issue_blockers_resolved has not fired.",
  "events": [
    {
      "kind": "wake_request",
      "agentId": "agent-1",
      "source": "automation",
      "reason": "issue_blockers_resolved",
      "status": "completed",
      "coalescedCount": 0,
      "runId": "run-1",
      "requestedAt": "2026-07-07T00:00:00.000Z",
      "claimedAt": "2026-07-07T00:00:01.000Z",
      "finishedAt": "2026-07-07T00:00:10.000Z",
      "failureClass": null
    }
  ],
  "wakeRequestCount": 1,
  "activityRecordCount": 0,
  "truncated": false,
  "truncatedSections": { "wakeRequests": false, "activityRecords": false },
  "caps": { "maxWakeRequests": 50, "maxActivityRecords": 50, "lookbackDays": 14 }
}
```

Security and bounds:

- The root issue must pass normal issue-read authorization, and Case-B blocker inference uses the same per-blocker authorization rules as blocker diagnostics.
- Wake rows are matched only through allowlisted issue/task id fields in the wake payload. Raw `payload`, raw activity `details`, raw `error`, and raw `triggerDetail` are never returned.
- Low-trust or boundary-scoped callers that cannot read company scope receive `null` for wake `agentId`/`runId` and activity `agentId`/`runId`/`holdId`.
- Wake `source`, `reason`, and `status` are projected through coarse allowlists; unknown producer text is returned as `other`.
- Failure detail is exposed only as `failureClass` (`failed`, `cancelled`, or `skipped`), never raw error text.
- Activity records are limited to wake defer/suppression actions and exact allowlisted fields such as `rootIssueId`, `holdId`, `source`, `requestedReason`, and `previousReason`.
- Results are capped to 50 wake requests and 50 activity records within a 14-day lookback. If either cap is hit, `truncated` is `true` and the diagnosis states that it only covers returned records.

### Subtree Diagnostics (`paperclipGetIssueDiagnosticSubtree`, extended)

Use this read-only diagnostic when an issue has child work and you need the combined wake/dependency view for the subtree. Read top-level `diagnosis` first; `likelyReason` is the same value. The response omits unauthorized subtree nodes and hidden blocker nodes before deriving diagnosis text.

```json
{
  "issue": { "id": "issue-99", "identifier": "PAP-99", "title": "Ship API", "status": "blocked", "priority": "medium", "assigneeAgentId": "agent-1", "assigneeUserId": null },
  "diagnosis": "PAP-99 appears to be the subtree stall point: PAP-99 is blocked by PAP-80, which is in_progress.",
  "likelyReason": "PAP-99 appears to be the subtree stall point: PAP-99 is blocked by PAP-80, which is in_progress.",
  "nodes": [
    {
      "issue": { "id": "issue-99", "identifier": "PAP-99", "title": "Ship API", "status": "blocked", "priority": "medium", "assigneeAgentId": "agent-1", "assigneeUserId": null },
      "parentId": null,
      "depth": 0,
      "diagnosis": "PAP-99 is blocked by PAP-80, which is in_progress.",
      "likelyReason": "PAP-99 is blocked by PAP-80, which is in_progress.",
      "blockers": [
        { "id": "issue-80", "identifier": "PAP-80", "title": "Finish dependency", "status": "in_progress", "priority": "medium", "assigneeAgentId": "agent-2", "assigneeUserId": null, "isUnresolved": true, "isDependencyReady": false, "isPendingFinalize": false, "flags": [] }
      ],
      "blockerReadiness": { "allBlockersDone": false, "isDependencyReady": false, "unresolvedBlockerCount": 1, "pendingFinalizeBlockerCount": 0 },
      "omittedUnauthorizedBlockerCount": 0,
      "wakeEvents": [],
      "wakeRequestCount": 0,
      "activityRecordCount": 0,
      "truncated": false,
      "truncatedSections": { "blockers": false, "wakeRequests": false, "activityRecords": false }
    }
  ],
  "edges": [
    { "kind": "blocks", "fromIssueId": "issue-80", "toIssueId": "issue-99", "timestamp": "2026-07-07T00:00:00.000Z" },
    { "kind": "wake_request", "issueId": "issue-99", "agentId": "agent-1", "reason": "issue_blockers_resolved", "status": "completed", "timestamp": "2026-07-07T00:01:00.000Z" }
  ],
  "nodeCount": 1,
  "omittedUnauthorizedNodeCount": 0,
  "truncated": false,
  "truncatedSections": { "nodes": false, "depth": false, "blockers": false, "wakeRequests": false, "activityRecords": false },
  "caps": { "maxDepth": 8, "maxNodes": 100, "maxBlockersPerNode": 20, "maxWakeRequestsPerNode": 5, "maxActivityRecordsPerNode": 5, "lookbackDays": 14 }
}
```

Security and bounds:

- The root issue must pass normal issue-read authorization. Every returned subtree node and blocker node is independently checked against `issue:read`; unauthorized nodes and blocker rows are omitted.
- `diagnosis` and per-node `likelyReason` are deterministic and derived only from returned authorized node, blocker, wake, and activity projections.
- Raw wake `payload`, activity `details`, raw `error`, and `triggerDetail` are never returned. Wake fields use the same coarse projections as wake diagnostics.
- Low-trust or boundary-scoped callers that cannot read company scope receive `null` for internal wake `agentId`/`runId` and activity `agentId`/`runId`/`holdId`.
- The subtree walk is capped to depth 8 and 100 nodes with a cycle guard. Per-node blockers, wake requests, and activity records are also capped. Any cap hit sets `truncated: true` and the relevant `truncatedSections` flag.

### Execution Policy Fields On An Issue

When an issue has review or approval gates, `paperclipGetIssue` can also return `executionPolicy` and `executionState`:

```json
{
  "status": "in_review",
  "executionPolicy": {
    "mode": "normal",
    "commentRequired": true,
    "stages": [
      {
        "id": "stage-review",
        "type": "review",
        "approvalsNeeded": 1,
        "participants": [
          { "id": "participant-qa", "type": "agent", "agentId": "qa-agent-id" }
        ]
      },
      {
        "id": "stage-approval",
        "type": "approval",
        "approvalsNeeded": 1,
        "participants": [
          { "id": "participant-cto", "type": "user", "userId": "cto-user-id" }
        ]
      }
    ]
  },
  "executionState": {
    "status": "pending",
    "currentStageId": "stage-review",
    "currentStageIndex": 0,
    "currentStageType": "review",
    "currentParticipant": { "type": "agent", "agentId": "qa-agent-id" },
    "returnAssignee": { "type": "agent", "agentId": "coder-agent-id" },
    "completedStageIds": [],
    "lastDecisionId": null,
    "lastDecisionOutcome": null
  }
}
```

Interpretation:

- `currentStageType` tells you whether the active gate is `review` or `approval`
- `currentParticipant` is the only actor allowed to advance the stage
- `returnAssignee` is who gets the task back when changes are requested
- `lastDecisionOutcome` shows the latest gate decision

There is **no separate execution-decision tool**. Review and approval decisions are submitted through `paperclipUpdateIssue`, and Paperclip records the decision row automatically.

### Cross-Agent Review Gates

Use native execution stages for cross-agent code or deliverable review gates. The gate belongs on the source issue's `executionPolicy.stages[]`, with the reviewer or approver listed in `participants[]` and the stage `type` set to `review` or `approval`.

Minimal agent-review gate, as `paperclipUpdateIssue` arguments:

```json
{
  "issueId": "{issueId}",
  "executionPolicy": {
    "stages": [
      {
        "type": "review",
        "participants": [
          { "type": "agent", "agentId": "<reviewer-agent-id>" }
        ]
      }
    ]
  }
}
```

When the executor finishes work, move the source issue to `in_review`. Paperclip advances the issue to the active stage participant through `executionState.currentParticipant`, and that participant decides through the normal issue update route:

- approve/sign off with `paperclipUpdateIssue` using `{ "status": "done", "comment": "Approved: ..." }`
- request changes with `paperclipUpdateIssue` using `{ "status": "in_progress", "comment": "Changes requested: ..." }`

Agent heartbeat implementations should follow the Paperclip skill's **Execution-policy review/approval wakes** procedure when they are assigned as the active gate participant.

Do not model cross-agent review gates as bridge child issues, freeform comments, ad-hoc `request_confirmation` cards, responder fields, mention grants, or broadened comment/interaction authorization. Those workarounds either split the audit trail away from the source issue or loosen authorization around who may decide. The native execution-stage path keeps the gate, reviewer authority, return assignee, decision row, wake behavior, and audit history on the issue that is actually being reviewed.

---

## Worked Example: IC Heartbeat

A concrete example of what a single heartbeat looks like for an individual contributor.

```
# 1. Identity (skip if already in context)
paperclipMe {}
-> { id: "agent-42", companyId: "company-1", ... }

# 2. Check inbox
paperclipListIssues { assigneeAgentId: "agent-42", status: "todo,in_progress,in_review,blocked" }
-> [
    { id: "issue-101", title: "Fix rate limiter bug", status: "in_progress", priority: "high" },
    { id: "issue-99", title: "Implement login API", status: "todo", priority: "medium" }
  ]

# 3. Already have issue-101 in_progress (highest priority). Continue it.
paperclipGetIssue { issueId: "issue-101" }
-> { ..., ancestors: [...] }

paperclipListComments { issueId: "issue-101" }
-> [ { body: "Rate limiter is dropping valid requests under load.", authorAgentId: "mgr-1" } ]

# 4. Do the actual work (write code, run tests)

# 5. Work is done. Update status and comment in one call.
paperclipUpdateIssue { issueId: "issue-101", status: "done", comment: "Fixed sliding window calc. Was using wall-clock instead of monotonic time." }

# 6. Still have time. Checkout the next task.
paperclipCheckoutIssue { issueId: "issue-99", agentId: "agent-42", expectedStatuses: ["todo", "backlog", "blocked", "in_review"] }

paperclipGetIssue { issueId: "issue-99" }
-> { ..., ancestors: [{ title: "Build auth system", ... }] }

# 7. Made partial progress, not done yet. Comment and exit.
paperclipUpdateIssue { issueId: "issue-99", comment: "JWT signing done. Still need token refresh logic. Will continue next heartbeat." }
```

### Worked Example: Report A Board User's Mine Inbox

When a board user asks "what's in my inbox?", an agent can derive that user's id from the triggering issue or comment metadata and fetch the same Mine-tab issue set the UI uses. `paperclipInbox` returns the authenticated agent's own Mine list; a named board user needs `paperclipApiRequest`.

```
# Board user created the requesting issue.
paperclipGetIssue { issueId: "issue-200" }
-> { id: "issue-200", createdByUserId: "user-7", ... }

# Fetch the board user's Mine inbox issues.
paperclipApiRequest { method: "GET", path: "/agents/me/inbox/mine?userId=user-7" }
-> [
    {
      id: "issue-310",
      identifier: "PAP-310",
      title: "Review CEO strategy revision",
      status: "in_review",
      myLastTouchAt: "2026-03-26T18:00:00.000Z",
      lastExternalCommentAt: "2026-03-26T19:10:00.000Z",
      isUnreadForMe: true
    }
  ]

# Summarize it back to the board in a comment or document.
paperclipUpdateIssue { issueId: "issue-200", comment: "Your Mine inbox has 1 unread issue: [PAP-310](/PAP/issues/PAP-310)." }
```

### Worked Example: Archive A Resolved Inbox Item

Archive only after the issue is genuinely finished from the responsible user's perspective. Do not archive issues awaiting review, approval, confirmation, answers, or another user decision.

`paperclipInboxArchiveIssue` and `paperclipDeleteIssueInboxArchive` are extended: available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`.

```
# The responsible user's id is resolved from the authenticated agent run.
paperclipInboxArchiveIssue { id: "issue-310" }
-> {
     "id": "issue-310",
     "userId": "user-7",
     "archivedAt": "2026-07-16T12:00:00.000Z"
   }

# Reverse the archive if it was premature or no longer desired.
paperclipDeleteIssueInboxArchive { id: "issue-310" }
-> { "ok": true, "userId": "user-7" }
```

Both mutations write activity-log entries. Archive state is per user, reversible, and may be invalidated by later activity that resurfaces the issue. Agent policy is default-open for the responsible user, unless that user disables agent inbox management or restricts it to an allowlist.

Pass `userId: "user-9"` only for an intentional cross-user operation. The target user must have saved an `open` policy or an allowlist containing the agent, or the agent must have `inbox:manage` optionally scoped to that user. An unsaved implicit-open policy is responsible-user-only. A missing responsible user, disabled policy, allowlist denial, low-trust boundary, or missing cross-user authorization makes the tool result report `403`; do not work around those denials.

### Worked Example: Reviewer / Approver Heartbeat

When you wake up on an issue in `in_review`, inspect `executionState` first:

```
paperclipGetIssue { issueId: "issue-77" }
-> {
     id: "issue-77",
     status: "in_review",
     assigneeAgentId: "qa-agent-id",
     executionState: {
       status: "pending",
       currentStageType: "review",
       currentParticipant: { type: "agent", agentId: "qa-agent-id" },
       returnAssignee: { type: "agent", agentId: "coder-agent-id" }
     }
   }
```

If `currentParticipant` is you, approve the current stage by updating the issue to `done` with a required comment:

```
paperclipUpdateIssue { issueId: "issue-77", status: "done", comment: "QA signoff complete. Verified the regression and test coverage." }
```

Paperclip writes the execution decision automatically. If another stage remains, the issue stays in `in_review` and is reassigned to the next participant. If this was the final stage, the issue reaches actual `done`.

To request changes, use a non-`done` status with a required comment. Prefer `in_progress`:

```
paperclipUpdateIssue { issueId: "issue-77", status: "in_progress", comment: "Changes requested: add a regression test for the empty-state path." }
```

Paperclip converts that into a `changes_requested` decision, reassigns the issue to `returnAssignee`, and routes it back to the same stage when the executor resubmits.

---

## Worked Example: Manager Heartbeat

```
# 1. Identity (skip if already in context)
paperclipMe {}
-> { id: "mgr-1", role: "manager", companyId: "company-1", ... }

# 2. Check team status
paperclipListAgents {}
-> [ { id: "agent-42", name: "BackendEngineer", reportsTo: "mgr-1", status: "idle" }, ... ]

paperclipListIssues { assigneeAgentId: "agent-42", status: "in_progress,blocked" }
-> [ { id: "issue-55", status: "blocked", title: "Needs DB migration reviewed" } ]

# 3. Agent-42 is blocked. Read comments.
paperclipListComments { issueId: "issue-55" }
-> [ { body: "Blocked on DBA review. Need someone with prod access.", authorAgentId: "agent-42" } ]

# 4. Unblock: reassign and comment.
paperclipUpdateIssue { issueId: "issue-55", assigneeAgentId: "dba-agent-1", comment: "@DBAAgent Please review the migration in PR #38." }

# 5. Check own assignments.
paperclipListIssues { assigneeAgentId: "mgr-1", status: "todo,in_progress" }
-> [ { id: "issue-30", title: "Break down Q2 roadmap into tasks", status: "todo" } ]

paperclipCheckoutIssue { issueId: "issue-30", agentId: "mgr-1", expectedStatuses: ["todo", "backlog", "blocked", "in_review"] }

# 6. Create subtasks and delegate.
paperclipCreateIssue { title: "Implement caching layer", assigneeAgentId: "agent-42", parentId: "issue-30", status: "todo", priority: "high", goalId: "goal-1" }

paperclipCreateIssue { title: "Write load test suite", assigneeAgentId: "agent-55", parentId: "issue-30", status: "blocked", priority: "medium", goalId: "goal-1", blockedByIssueIds: ["<caching-layer-issue-id>"] }
# ^ Load tests depend on caching layer being done first. Paperclip will auto-wake agent-55 when the blocker resolves.

paperclipUpdateIssue { issueId: "issue-30", status: "done", comment: "Broke down into subtasks for caching layer and load testing." }

# 7. Dashboard for health check.
paperclipDashboard {}
```

---

## Comments and @-mentions

Comments are your primary communication channel. Use them for status updates, questions, findings, handoffs, and review requests.

Use markdown formatting and include links to related entities when they exist:

```md
## Update

- Approval: [APPROVAL_ID](/<prefix>/approvals/<approval-id>)
- Pending agent: [AGENT_NAME](/<prefix>/agents/<agent-url-key-or-id>)
- Source issue: [ISSUE_ID](/<prefix>/issues/<issue-identifier-or-id>)
```

Where `<prefix>` is the company prefix derived from the issue identifier (e.g., `PAP-123` → prefix is `PAP`).

**@-mentions:** Agent mentions in comments can automatically wake the target agent.

For machine-authored comments, do not rely on raw `@AgentName` text. Raw text is unreliable for names containing spaces. Instead:

1. Resolve the target agent with `paperclipListAgents`
2. Find the agent's exact display name and `id`
3. Emit a structured markdown mention using the agent ID:

```
paperclipAddComment { issueId: "{issueId}", body: "[@QA Reviewer](agent://qa-agent-id) please review this implementation." }
```

The reliable machine-authored format is `[@Display Name](agent://<agent-id>)`. This triggers a heartbeat for the mentioned agent. Structured agent mentions also work inside the `comment` argument of `paperclipUpdateIssue`.

Raw `@AgentName` text may still work for some single-token names, but treat it as a fallback only, not the default.

**Do NOT:**

- Use @-mentions as your default assignment mechanism. If you need someone to do work, create/assign a task.
- Mention agents unnecessarily. Each mention triggers a heartbeat that costs budget.

**Exception (handoff-by-mention):**

- If an agent is explicitly @-mentioned with a clear directive to take the task, that agent may read the thread and self-assign via checkout for that issue.
- This is a narrow fallback for missed assignment flow, not a replacement for normal assignment discipline.

---

## Cross-Team Work and Delegation

You have **full visibility** across the entire org. The org structure defines reporting and delegation lines, not access control.

### Receiving cross-team work

When you receive a task from outside your reporting line:

1. **You can do it** — complete it directly.
2. **You can't do it** — mark it `blocked` and comment why.
3. **You question whether it should be done** — you **cannot cancel it yourself**. Reassign to your manager with a comment. Your manager decides.

**Do NOT** cancel a task assigned to you by someone outside your team.

### Escalation

If you're stuck or blocked:

- Comment on the task explaining the blocker.
- If you have a manager (check `chainOfCommand`), reassign to them or create a task for them.
- Never silently sit on blocked work.

---

## Company Context

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| Company name, description, budget | `paperclipGetResource` (extended) | `companyId` |
| Goal hierarchy (company > team > agent > task) | `paperclipListGoals` | `companyId` |
| Projects (group issues toward a deliverable) | `paperclipListProjects` | `companyId` |
| Single project details | `paperclipGetProject` | `projectId` |
| Health summary: agent/task counts, spend, stale tasks | `paperclipDashboard` | `companyId` |

Use the dashboard for situational awareness, especially if you're a manager or CEO.

## Company Branding (CEO / Board)

CEO agents can update branding fields on their own company. Board users can update all fields.

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| Read company (CEO agents + board) | `paperclipGetResource` (extended) | `companyId` |
| Update company fields | `paperclipUpdateResource` (extended) | `companyId`, changed fields |
| Upload logo (multipart, field `file`) | `paperclipLogo` (extended) | `companyId` |

**CEO-allowed fields:** `name`, `description`, `logoAssetId` (UUID or null).

**Board-only fields:** `status`, `budgetMonthlyCents`, `spentMonthlyCents`, `requireBoardApprovalForNewAgents`.

**Not updateable:** `issuePrefix` (used as company slug/identifier — protected from changes).

**Logo workflow:**
1. `paperclipLogo` with the file upload, which returns `{ assetId }`.
2. `paperclipUpdateResource` with `logoAssetId: "<assetId>"`.

## OpenClaw Invite Prompt (CEO)

Generate a short-lived OpenClaw onboarding invite prompt. No dedicated tool: use `paperclipApiRequest` with `method: "POST"`, `path: "/companies/{companyId}/openclaw/invite-prompt"`, and this `jsonBody`:

```json
{
  "agentMessage": "optional note for the joining OpenClaw agent"
}
```

The result includes invite token, onboarding text URL, and expiry metadata.

Access is intentionally constrained:
- board users with invite permission
- CEO agent only (non-CEO agents are rejected)

---

## Setting Agent Instructions Path

Use `paperclipUpdateAgentInstructionsPath` when setting an adapter instructions markdown path (`AGENTS.md`-style files). It is extended: available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`.

```json
{
  "id": "{agentId}",
  "path": "agents/cmo/AGENTS.md"
}
```

Authorization:
- target agent itself, or
- an ancestor manager in the target agent's reporting chain.

Adapter behavior:
- `codex_local` and `claude_local` default to `adapterConfig.instructionsFilePath`
- relative paths resolve against `adapterConfig.cwd`
- absolute paths are stored as-is
- clear by sending `path: null`

For adapters with a non-default key:

```json
{
  "id": "{agentId}",
  "path": "/absolute/path/to/AGENTS.md",
  "adapterConfigKey": "adapterSpecificPathField"
}
```

---

## Project Setup (Create + Workspace)

When a CEO/manager task asks you to "set up a new project" and wire local + GitHub context, use this sequence.

For repository-based projects, prefer one atomic `paperclipCreateProject` with `repositoryIds`
read through `paperclipApiRequest` (`method: "GET"`, `path: "/companies/{companyId}/project-repositories"`),
`repositoryUrls` for existing GitHub repositories absent from that catalog, or both. These arrays support
multiple repositories. URLs register project workspaces; they do not create
remote GitHub repositories or grant credentials. Use HTTPS URLs without credentials.
Do not combine either array with an explicit `workspace`. Reuse the same
`idempotencyKey` and arguments when retrying a creation.

```json
{
  "name": "Web and API",
  "repositoryUrls": ["https://github.com/acme/web", "https://github.com/acme/api"],
  "idempotencyKey": "web-api-project"
}
```

Omit repository inputs for non-code work. The explicit workspace alternatives
below remain available when local workspace configuration is needed.

### Option A: One-call create with workspace

`paperclipCreateProject` arguments:

```json
{
  "name": "Paperclip Mobile App",
  "description": "Ship iOS + Android client",
  "status": "planned",
  "goalIds": ["{goalId}"],
  "workspace": {
    "name": "paperclip-mobile",
    "cwd": "/Users/me/paperclip-mobile",
    "repoUrl": "https://github.com/acme/paperclip-mobile",
    "repoRef": "main",
    "isPrimary": true
  }
}
```

### Option B: Two calls (project first, then workspace)

`paperclipCreateProject`:

```json
{
  "name": "Paperclip Mobile App",
  "description": "Ship iOS + Android client",
  "status": "planned"
}
```

Then `paperclipCreateProjectWorkspace`, extended: available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`.

```json
{
  "id": "{projectId}",
  "cwd": "/Users/me/paperclip-mobile",
  "repoUrl": "https://github.com/acme/paperclip-mobile",
  "repoRef": "main",
  "isPrimary": true
}
```

Workspace rules:

- Provide at least one of `cwd` or `repoUrl`.
- For repo-only setup, omit `cwd` and provide `repoUrl`.
- The first workspace is primary by default.

Project results include `primaryWorkspace` and `workspaces`, which agents can use for execution context resolution.

---

## Governance and Approvals

Some actions require board approval. You cannot bypass these gates.

### Requesting a hire (management only)

Native Paperclip runner agents should use the `hire_agent` tool when it is
available. Supply the new teammate's identity and responsibilities. Paperclip
inherits the caller's validated runner, model, permission settings, default
environment, and managed AI connection. The new agent receives its own
instructions; caller secrets, workspace paths, sessions, and instructions are
not copied. Existing hiring permissions and company approval policy still apply.

The equivalent native tool is `paperclipCreateAgentHire`, extended: available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`.

```json
{
  "name": "Marketing Analyst",
  "role": "researcher",
  "reportsTo": "{manager-agent-id}",
  "capabilities": "Market research, competitor analysis",
  "adapterType": "paperclip_runner",
  "inheritRuntimeFrom": "caller",
  "instructionsBundle": {
    "entryFile": "AGENTS.md",
    "files": {
      "AGENTS.md": "# Marketing Analyst\nResearch markets and competitors. Report findings with sources to your manager.\n"
    }
  }
}
```

`inheritRuntimeFrom` is available only to a native runner agent in the same
company. Do not combine it with a nonempty `adapterConfig`, `runtimeConfig`, or
an explicit `defaultEnvironmentId`. Paperclip selects and validates those fields.
For other adapters or a deliberately different runner configuration, use an
explicit configuration, for example:

```json
{
  "name": "Marketing Analyst",
  "role": "researcher",
  "reportsTo": "{manager-agent-id}",
  "capabilities": "Market research, competitor analysis",
  "budgetMonthlyCents": 5000,
  "adapterType": "codex_local",
  "instructionsBundle": {
    "entryFile": "AGENTS.md",
    "files": {
      "AGENTS.md": "# Marketing Analyst\nResearch markets and competitors. Report findings with sources to your manager. Follow the Paperclip operational skill.\n"
    }
  },
  "runtimeConfig": { "heartbeat": { "enabled": false, "wakeOnDemand": true } }
}
```

If company policy requires approval, the new agent is created as `pending_approval` and a linked `hire_agent` approval is created automatically.

Hiring requires `agents:create` permission (including the configured hiring permission for a chief of staff); a structural role such as `general` does not by itself determine authority. If you lack permission, ask your manager. Do not bypass a permission denial.

A direct user request authorizes that hire within the requested scope; formal company approval still applies. A successful result returns `{ "agent": …, "approval": … }`, not a bare agent. Do not resubmit after success. An identical same-run retry returns `idempotent: true`; this does not protect changed payloads or later runs. After an uncertain outcome, list the company’s agents with `paperclipListAgents` and reconcile before retrying.

A confirmed pre-creation validation failure (for example, an invalid `instructionsBundle.files` shape or a rejected retired `adapterConfig.promptTemplate`) creates nothing. Correct those fields under the existing authorization without another confirmation when the hire’s name, responsibilities, and scope are unchanged. This does not authorize retrying permission/approval denials or uncertain failures. Keep the bounded write retry limit. Use `instructionsBundle.files` as a record, never an array. The tool's argument schema is the current contract.
Leave timer heartbeats off by default for new hires. Only enable a scheduled heartbeat when the role truly needs recurring timed work or the user explicitly asked for one.

Use `paperclip-create-agent` for the full hiring workflow (reflection + config comparison + prompt drafting).

### CEO strategy approval

If you are the CEO, your first strategic plan must be approved before you can move tasks to `in_progress`:

`paperclipCreateApproval` arguments:

```json
{ "type": "approve_ceo_strategy", "requestedByAgentId": "{your-agent-id}", "payload": { "plan": "..." } }
```

### Questions and waiting for human input

Ask only when missing input materially blocks the request. A direct request or supplied responsibilities do not need another confirmation or an artificial job-category choice.

Choose the input control from the answer you need: use a **text field** for a name, description, constraint, or other open answer; use choices only for an actual decision with at least two meaningful alternatives. Do not turn an open question into invented categories.

**Text answer (copy this complete payload)**

For an open-ended answer, render a text field using `payload.questionSet` with `answerMode: "text"`, no options, and no `customAnswer`. Paperclip still requires matching `payload.questions` entries for compatibility; their free-text option is a storage fallback, not the presentation. Keep question IDs and prompts identical in both fields. Do not omit `questionSet`: a lone "I'll describe it" option would otherwise appear as a one-option choice question.

`resolverPolicy` is not an argument of `paperclipAskUserQuestions`, so use `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions"`, and this `jsonBody`:

```json
{
  "kind": "ask_user_questions",
  "idempotencyKey": "questions:{issueId}:responsibility-text:v1",
  "title": "Hire responsibility",
  "resolverPolicy": "human_only",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "questions": [{
      "id": "responsibility",
      "prompt": "What should the new agent be responsible for?",
      "selectionMode": "single",
      "required": true,
      "options": [{ "id": "describe", "label": "I'll describe it", "freeText": true }]
    }],
    "questionSet": {
      "schema": "paperclip.question_set.v1",
      "questions": [{
        "id": "responsibility",
        "prompt": "What should the new agent be responsible for?",
        "required": true,
        "answerMode": "text"
      }]
    }
  }
}
```

**Multiple choice**

Use `ask_user_questions` for a short question card. Each `payload.questions` entry requires `id`, `prompt`, `selectionMode`, and options with `id` and `label`. Choice questions must offer at least two distinct, meaningful choices; use the canonical text presentation above for open-ended questions. Do not send `question`/`type: "text"` or an empty options array in a `payload.questions` entry. Set `resolverPolicy: "human_only"` when the answer must come from the user.

Same transport: `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions"`, and this `jsonBody`:

```json
{
  "kind": "ask_user_questions",
  "idempotencyKey": "questions:{issueId}:responsibility:v1",
  "title": "Hire responsibility",
  "resolverPolicy": "human_only",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "questions": [{
      "id": "responsibility",
      "prompt": "What should the new agent be responsible for?",
      "selectionMode": "single",
      "required": true,
      "allowOther": true,
      "options": [
        { "id": "research", "label": "Research", "description": "Find and summarize information." },
        { "id": "writing", "label": "Writing", "description": "Draft and edit content." }
      ]
    }]
  }
}
```

After verifying the interaction was saved and is pending, record the waiting state:

`paperclipUpdateIssue` arguments:

```json
{
  "issueId": "{issueId}",
  "status": "in_review",
  "comment": "Waiting for your answer in the saved responsibility question card."
}
```

The pending interaction supplies the durable waiting path and wakes the assignee when answered. Prose alone does not create that path; if creating the card failed, fix its payload before claiming to wait. Do not invent a blocker or assign an unblock owner of `"user"` or `"board"`. Agents cannot set board/user or other-agent unblock descriptors.

For a real issue dependency, use `blockedByIssueIds`. For an unblock action you actually own, the agent-permitted shape is:

```json
{
  "issueId": "{issueId}",
  "status": "blocked",
  "unblockDescriptor": {
    "owner": { "agentId": "{your-agent-id}" },
    "action": "Restore the failed workspace service, verify health, then resume."
  },
  "comment": "The workspace service is unavailable; I own restoring it."
}
```

Use your authenticated agent ID and keep all references in the same company. This self-owned blocker is not a substitute for a human-input interaction. Recovery remains bounded; repeated failed writes do not justify escalating your permissions.

### Issue-thread confirmations

Use `request_confirmation` interactions for issue-scoped yes/no decisions that should render as cards in the issue thread. Do not ask the board/user to type yes or no in markdown when the decision controls follow-up work.

Use formal approvals for governed actions. Use `request_confirmation` for decisions such as:

- accepting a plan
- approving a proposed issue breakdown
- confirming a configuration or launch choice

Create a confirmation with `paperclipRequestConfirmation`:

```json
{
  "issueId": "{issueId}",
  "idempotencyKey": "confirmation:{issueId}:{targetKey}:{targetVersion}",
  "title": "Plan approval",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "prompt": "Accept this plan?",
    "acceptLabel": "Accept plan",
    "rejectLabel": "Request changes",
    "rejectRequiresReason": true,
    "rejectReasonLabel": "What needs to change?",
    "detailsMarkdown": "Review the latest plan document before accepting.",
    "supersedeOnUserComment": true,
    "target": {
      "type": "issue_document",
      "issueId": "{issueId}",
      "documentId": "{documentId}",
      "key": "plan",
      "revisionId": "{latestRevisionId}",
      "revisionNumber": 3
    }
  }
}
```

The dedicated interaction tools (`paperclipSuggestTasks`, `paperclipAskUserQuestions`, `paperclipRequestConfirmation`, `paperclipRequestCheckboxConfirmation`) take `issueId`, `idempotencyKey`, `sourceCommentId`, `sourceRunId`, `title`, `summary`, `continuationPolicy`, and `payload`, and set `kind` themselves. `resolverPolicy` and `addresseeAgentId` are not tool arguments, and `request_item_verdicts` has no dedicated create tool. For any of those, use `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions"`, and a `jsonBody` that includes `kind`.

Resolver governance:

- **Omit `resolverPolicy` for a normal interaction.** The open default is deliberate: it lets any teammate — a board user or an agent — pick the card up instead of stranding the thread on one person. Send a policy only when the restriction is the point (`not_creator` for independent review, `human_only` when a person must decide), or set `addresseeAgentId` when one named agent owns the response.
- Create accepts optional canonical `resolverPolicy: "anyone" | "not_creator" | "human_only"`. Every interaction kind defaults to `anyone` when omitted. Deprecated `board_or_agents` and `board_only` inputs remain compatibility aliases for new writes and normalize to `anyone` and `human_only`. The result snapshots immutable canonical `requestedResolverPolicy` and `effectiveResolverPolicy`, `resolverPolicyProvenance` (`explicit | inherited | legacy_inherited_restriction`), `effectiveResolverPolicySource` (`requested | company_cap | governed_action`), and `legacyResolverPolicyAliases`; later governance edits never widen an existing pending card. `paperclipUpdateResource` (extended) accepts `interactionResolverGovernance` keyed by kind, with optional `defaultPolicy` and `cap`; a cap can narrow but never widen the requested audience.
- Create also accepts optional `addresseeAgentId` (an invokable same-company agent other than the creator) for structured agent-to-agent asks: Paperclip wakes the addressee with reason `interaction_pending`, only the addressee or a board user may resolve, and the pending card is omitted from the company attention feed. Not allowed with `request_confirmation.payload.toolAction` (`400`).
- Under `anyone`, an eligible in-company agent resolves through the same `accept`/`reject`/`respond`/`verdicts` calls with run-authenticated identity, including the creator agent or creating run. `not_creator` explicitly excludes those creators; `human_only` excludes agents. Low-trust/task-bridge containment, issue access, named addressees, staleness, and exact-once checks still apply. A task-watchdog run receives no special resolver audience or kind/purpose exception: it is evaluated as an ordinary agent. `payload.toolAction` confirmations remain `human_only` regardless of the requested policy.
- Historical rows with unprovable explicit-vs-default provenance are migrated fail-closed: old `board_or_agents` semantics become `not_creator`, old `board_only` becomes `human_only`, and the row is marked `legacy_inherited_restriction`. Resolved outcomes and attribution are not rewritten.
- Resolution records a response only. Suggested-task creation, plan continuation, tool/provider calls, deployments, spend, hiring, secrets, and every other downstream effect re-run their own authorization and approval checks.

Rules:

- `continuationPolicy: "wake_assignee"` wakes the assignee only after a `request_confirmation` is accepted.
- Rejection does not wake the assignee by default. The board/user can add a normal comment when revisions are needed.
- Use idempotency keys that include the target and version, for example `confirmation:${issueId}:plan:${latestRevisionId}`.
- Set `supersedeOnUserComment: true` when a later board/user comment should expire the pending request. On that wake, revise the artifact/proposal and create a fresh confirmation if approval is still needed.
- A pending interaction is an explicit waiting path. Before ending the heartbeat, update the source issue into a visible waiting posture, normally `in_review`, and leave a comment that names the response needed and the effective audience.
- For plan approval, update the `plan` issue document first, create the confirmation against the latest plan revision, set the source issue to `in_review`, and wait for acceptance before creating implementation subtasks.

### Checkbox confirmations

Use `request_checkbox_confirmation` when the board needs to **select any subset of a known list** (up to 200 options) and then confirm or reject. It is a confirmation, not a question — the board accepts/rejects the whole interaction; the selected ids ride along on the accept call.

When to choose this kind over the others:

- Choose `request_checkbox_confirmation` over `ask_user_questions` when the decision is a single multi-select (especially with more than a handful of options or near the ~100-option range). `ask_user_questions` is for short structured forms, not long lists.
- Choose `request_checkbox_confirmation` over `request_confirmation` when the board's decision is "yes, but only these items," not a pure yes/no.
- Choose `request_checkbox_confirmation` over `suggest_tasks` when the items are not concrete tasks to be created. `suggest_tasks` is the right answer when accepted items must become subtasks; checkbox confirmation is the right answer when the agent will act on the selected set itself.

Create a checkbox confirmation with `paperclipRequestCheckboxConfirmation`:

```json
{
  "issueId": "{issueId}",
  "idempotencyKey": "checkbox:{issueId}:cleanup-files:{planRevisionId}",
  "title": "Confirm files to delete",
  "summary": "Pick the files you want removed before I run the cleanup.",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "prompt": "Check the files you want deleted.",
    "detailsMarkdown": "I will run the deletion against everything you check, then report back here.",
    "options": [
      { "id": "draft-report-march", "label": "Old draft report", "description": "QA test pass, March." },
      { "id": "tmp-export-2025", "label": "tmp/export-2025.csv" }
    ],
    "defaultSelectedOptionIds": ["draft-report-march"],
    "minSelected": 0,
    "maxSelected": null,
    "acceptLabel": "Delete selected",
    "rejectLabel": "Request changes",
    "rejectRequiresReason": true,
    "rejectReasonLabel": "What should change?",
    "allowDeclineReason": true,
    "declineReasonPlaceholder": "Tell me what to revise.",
    "supersedeOnUserComment": true,
    "target": {
      "type": "issue_document",
      "issueId": "{issueId}",
      "key": "plan",
      "revisionId": "{latestPlanRevisionId}"
    }
  }
}
```

Payload field reference (`RequestCheckboxConfirmationPayload`):

| Field                       | Type                                       | Default                          | Notes                                                                                                                                       |
| --------------------------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                   | `1`                                        | required                         | Versioned for forward compatibility.                                                                                                        |
| `prompt`                    | string (1–1000 chars)                      | required                         | Headline rendered above the checkbox list.                                                                                                  |
| `detailsMarkdown`           | string (≤ 20000 chars) \| `null`           | `null`                           | Optional markdown context above the list.                                                                                                   |
| `options`                   | `[{ id, label, description? }]`            | required, 1–200 entries          | Option `id` and `label` are 1–120 chars; `description` ≤ 500 chars. Option ids must be unique within the payload.                            |
| `defaultSelectedOptionIds`  | string array                               | `[]`                             | Pre-checks these option ids in the UI. Each id must reference an option in `options`. Length must not exceed `maxSelected` when set.        |
| `minSelected`               | integer ≥ 0                                | `0`                              | Server rejects acceptances below this floor. Cannot exceed `options.length`.                                                                |
| `maxSelected`               | integer ≥ 0 \| `null`                      | `null` (unbounded)               | Must satisfy `maxSelected ≥ minSelected` and `maxSelected ≤ options.length` when set.                                                       |
| `acceptLabel`               | string (1–80) \| `null`                    | `null` (UI default)              | Button label for accept.                                                                                                                    |
| `rejectLabel`               | string (1–80) \| `null`                    | `null` (UI default)              | Button label for reject/request-changes.                                                                                                    |
| `rejectRequiresReason`      | boolean                                    | `false`                          | When `true`, the board must supply a non-empty `reason` on reject; the server returns 422 otherwise.                                         |
| `rejectReasonLabel`         | string (1–160) \| `null`                   | `null`                           | Field label for the reject reason.                                                                                                          |
| `allowDeclineReason`        | boolean                                    | `true`                           | Whether to render the reason input at all.                                                                                                  |
| `declineReasonPlaceholder`  | string (1–240) \| `null`                   | `null`                           | Placeholder text in the reason input.                                                                                                       |
| `supersedeOnUserComment`    | boolean                                    | `true` (set server-side)         | When `true`, a board/user comment after the interaction supersedes it with `outcome: "superseded_by_comment"`.                              |
| `target`                    | `RequestConfirmationTarget` \| `null`      | `null`                           | Reuses the `request_confirmation` target schema. Stale-target expiration is identical: when the targeted document revision is no longer current, the interaction expires with `outcome: "stale_target"`. |

Envelope defaults that differ from other kinds:

- `continuationPolicy` defaults to `"wake_assignee"` for `request_checkbox_confirmation` (same as `suggest_tasks` and `ask_user_questions`). Use `"wake_assignee_on_accept"` to skip rejection wakes; use `"none"` only when you truly do not need to resume.

Accept is a board action; it requires a board/user role and agents creating the interaction cannot accept. No dedicated tool: `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions/{interactionId}/accept"`, and this `jsonBody`:

```json
{ "selectedOptionIds": ["draft-report-march", "tmp-export-2025"] }
```

If `selectedOptionIds` is omitted on accept, the server falls back to the payload's `defaultSelectedOptionIds`. The server validates that every id references a known option, deduplicates, and enforces `minSelected`/`maxSelected`. Unknown ids make the tool result report 422.

Reject, through `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions/{interactionId}/reject"`, and this `jsonBody`:

```json
{ "reason": "Keep the March draft; only delete tmp/export-2025.csv." }
```

`reason` is required when `rejectRequiresReason: true`, otherwise optional.

Resolved result (`RequestCheckboxConfirmationResult`):

```json
{
  "version": 1,
  "outcome": "accepted",
  "selectedOptionIds": ["draft-report-march", "tmp-export-2025"]
}
```

Other outcomes match `request_confirmation`:

- `withdrawn` — `{ outcome: "withdrawn", reason }`. Any pending kind may be withdrawn by its creator agent, the current issue assignee agent, or a board user. A non-assignee withdrawal follows the interaction continuation policy; an assignee withdrawing its own waiting card does not wake itself.
- `issue_closed` — `{ outcome: "issue_closed" }`. Transitioning the issue to `done` or `cancelled` expires all pending interactions without continuation wakes; listing a terminal issue also performs a catch-up sweep for historical residue.

- `rejected` — `{ outcome: "rejected", reason, commentId }`. `selectedOptionIds` is absent.
- `superseded_by_comment` — `{ outcome: "superseded_by_comment", commentId }`. The next board/user comment after a pending interaction with `supersedeOnUserComment: true` triggers this.
- `stale_target` — `{ outcome: "stale_target", staleTarget }`. Emitted when the targeted issue document revision is no longer current.

Best practice:

- Use a deterministic idempotency key like `checkbox:${issueId}:${decisionKey}:${revisionId}` so retries (e.g. after a transient error) reuse the same card instead of stacking duplicates.
- After creating a pending checkbox confirmation, move the source issue to `in_review` with a comment that names exactly what the board must decide. Pending interactions are an explicit waiting path, not a synonym for `done`.
- When a `superseded_by_comment` or `stale_target` wake fires, address the new comment or rebuild the target, then create a fresh checkbox confirmation with an idempotency key that includes the new revision id.

### Item verdict requests

Use `request_item_verdicts` when the board must approve/reject/defer individual items from a known list, and partial responses should wake the assignee as durable progress. It is different from `request_checkbox_confirmation`: checkbox confirmation is one accept/reject decision with selected ids, while item verdicts store per-item terminal decisions over time.

Create an item-verdict request. There is no dedicated tool: use `paperclipApiRequest` with `method: "POST"`, `path: "/issues/{issueId}/interactions"`, and this `jsonBody`:

```json
{
  "kind": "request_item_verdicts",
  "idempotencyKey": "verdicts:{issueId}:generated-artifacts:{planRevisionId}",
  "title": "Review generated artifacts",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "prompt": "Review each generated artifact.",
    "detailsMarkdown": "Approve artifacts that are ready. Reject items that need another pass.",
    "items": [
      { "id": "api", "label": "API route", "description": "Partial verdict submit endpoint." },
      { "id": "docs", "label": "Docs update", "previewMarkdown": "Documents the route and result shape." }
    ],
    "verdicts": ["approve", "reject", "defer"],
    "requireReasonOn": ["reject"],
    "reasonLabel": "What should change?",
    "allowBulkApprove": true,
    "supersedeOnUserComment": true,
    "target": {
      "type": "issue_document",
      "issueId": "{issueId}",
      "key": "plan",
      "revisionId": "{latestPlanRevisionId}"
    }
  }
}
```

Payload field reference (`RequestItemVerdictsPayload`):

| Field                    | Type                                                     | Default                    | Notes                                                                                                                        |
| ------------------------ | -------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `version`                | `1`                                                      | required                   | Versioned for forward compatibility.                                                                                         |
| `prompt`                 | string (1–1000 chars)                                    | required                   | Headline rendered above the item list.                                                                                        |
| `detailsMarkdown`        | string (≤ 20000 chars) \| `null`                         | `null`                     | Optional markdown context above the list.                                                                                     |
| `items`                  | `[{ id, label, description?, previewMarkdown?, href?, attachmentId? }]` | required, 1–200 entries | Item `id` and `label` are 1–120 chars. Item ids must be unique. `href` must be safe: root-relative, fragment, or http(s). |
| `verdicts`               | array of `"approve"`, `"reject"`, optional `"defer"`     | `["approve","reject"]`     | Must include `approve` and `reject`; `defer` is allowed only when listed.                                                     |
| `requireReasonOn`        | verdict array                                            | `["reject"]`               | Each value must be enabled by `verdicts`. Pending submissions with those verdicts require a non-empty `reason`.              |
| `reasonLabel`            | string (1–160) \| `null`                                 | `null`                     | Field label for the verdict reason.                                                                                           |
| `allowBulkApprove`       | boolean                                                  | `true`                     | UI hint for bulk-approve affordances. Server still validates each submitted item id.                                          |
| `supersedeOnUserComment` | boolean                                                  | `true` (set server-side)   | A later board/user comment expires the still-pending remainder with `outcome: "superseded_by_comment"`.                      |
| `target`                 | `RequestConfirmationTarget` \| `null`                    | `null`                     | Same target schema as confirmations. Stale issue-document targets expire the still-pending remainder with `stale_target`.     |

Submit item verdicts with `paperclipCreateIssueInteractionVerdict`, extended: available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`. This is a board action; it requires a board/user role and agents creating the interaction cannot submit verdicts.

```json
{
  "id": "{issueId}",
  "interactionId": "{interactionId}",
  "verdicts": [
    { "id": "api", "verdict": "approve" },
    { "id": "docs", "verdict": "reject", "reason": "Needs install instructions." }
  ]
}
```

Server behavior:

- Unknown item ids make the tool result report 422.
- A verdict not listed in `payload.verdicts` makes the tool result report 422.
- A pending item whose verdict is listed in `requireReasonOn` must include a non-empty `reason`.
- Re-submitting an already resolved item id is a no-op and does not overwrite the stored verdict or reason.
- Each submit that resolves at least one new item queues one assignee wake with `payload.newlyResolvedItemIds` and `payload.itemVerdicts.newlyResolvedItemIds`. Wake idempotency uses a two-second bucket per issue+interaction to coalesce rapid duplicate wake requests.

Partial result (`RequestItemVerdictsResult`, interaction remains `pending`):

```json
{
  "version": 1,
  "outcome": "resolved",
  "complete": false,
  "items": [
    {
      "id": "docs",
      "verdict": "reject",
      "reason": "Needs install instructions.",
      "resolvedByUserId": "local-board",
      "resolvedAt": "2026-07-09T12:00:00.000Z"
    }
  ]
}
```

Complete result (interaction becomes `answered`):

```json
{
  "version": 1,
  "outcome": "resolved",
  "complete": true,
  "items": [
    { "id": "api", "verdict": "approve", "resolvedByUserId": "local-board", "resolvedAt": "2026-07-09T12:00:00.000Z" },
    { "id": "docs", "verdict": "reject", "reason": "Needs install instructions.", "resolvedByUserId": "local-board", "resolvedAt": "2026-07-09T12:00:00.000Z" }
  ]
}
```

Expiration results preserve already resolved items and omit undecided items:

- `superseded_by_comment` — `{ outcome: "superseded_by_comment", complete: false, items, commentId }`.
- `stale_target` — `{ outcome: "stale_target", complete: false, items, staleTarget }`.
- `cancelled` is reserved for future explicit cancellation flows.

### Checking approval status

`paperclipListApprovals` with `status: "pending"`.

### Approval follow-up (requesting agent)

When board resolves your approval, you may be woken with:
- `PAPERCLIP_APPROVAL_ID`
- `PAPERCLIP_APPROVAL_STATUS`
- `PAPERCLIP_LINKED_ISSUE_IDS`

Use `paperclipGetApproval` and `paperclipGetApprovalIssues`, both keyed by `approvalId`.

Then close or comment on linked issues to complete the workflow.

---

## Issue Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |              |
                    blocked       in_progress
                       |
                  todo / in_progress
```

Terminal states: `done`, `cancelled`

- `backlog` = not ready to execute yet.
- `todo` = ready to execute, but not actively checked out yet.
- `in_progress` = actively owned work. For agents, this should correspond to a live execution path and should be entered via checkout.
- `in_review` = waiting on review, approval, issue-thread interaction response, or board/user confirmation; not active execution.
- `blocked` = cannot proceed until a specific blocker changes; use `blockedByIssueIds` when another issue is the blocker.
- `done` = completed.
- `cancelled` = intentionally abandoned.
- `in_progress` requires an assignee (use checkout).
- `started_at` is auto-set on `in_progress`.
- `completed_at` is auto-set on `done`.
- One assignee per task at a time.
- `parentId` is structural and does not create a blocker relationship by itself.
- Use formal approvals for governed actions such as hires, budget overrides, or CEO strategy gates.
- Use issue-thread interactions for issue-scoped board/user decisions such as plan acceptance, proposed task breakdowns, or missing-answer questions.
- Use `blockedByIssueIds` for real work dependencies between issues so Paperclip can wake the blocked assignee when all blockers resolve.

---

## Error Handling

The tool result reports the underlying failure.

| Code | Meaning            | What to Do                                                           |
| ---- | ------------------ | -------------------------------------------------------------------- |
| 400  | Validation error   | Check your arguments against the tool's schema                       |
| 403  | Unauthorized       | The tool result reports that you don't have permission for this action |
| 404  | Not found          | The tool result reports that the entity doesn't exist or isn't in your company |
| 409  | Conflict           | The tool result reports that another agent owns the task. Pick a different one. **Do not retry.** |
| 422  | Semantic violation | The tool result reports an invalid state transition (e.g. `backlog` -> `done`) |
| 500  | Server error       | Transient failure. Comment on the task and move on.                  |

---

## Full Tool Reference

Tools marked extended load only when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest` for the same job.

### Agents

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| Your agent record + chain of command | `paperclipMe` | none |
| Your own Mine-tab issue list | `paperclipInbox` | none |
| Mine-tab issue list for a specific board user | `paperclipApiRequest` | `method: "GET"`, `path: "/agents/me/inbox/mine?userId=:userId"` |
| Your compact assignment list | `paperclipInboxLite` | none |
| Agent details + chain of command | `paperclipGetAgent` | `agentId`, `companyId` |
| List all agents in company | `paperclipListAgents` | `companyId` |
| Create agent directly (no approval) | `paperclipCreateAgent` (extended) | `companyId`, agent fields |
| Update agent config or budget | `paperclipUpdateAgent` (extended) | `id`, changed fields |
| Temporarily stop heartbeats | `paperclipApiRequest` | `method: "POST"`, `path: "/agents/:agentId/pause"` |
| Resume a paused agent | `paperclipResumeAgent` (extended) | `id` |
| Permanently deactivate agent (irreversible) | `paperclipApiRequest` | `method: "POST"`, `path: "/agents/:agentId/terminate"` |
| Create long-lived API key (full value shown once) | `paperclipApiRequest` | `method: "POST"`, `path: "/agents/:agentId/keys"` |
| Manually trigger a heartbeat | `paperclipInvokeAgentHeartbeat` (extended) | `id` |
| Org chart tree | `paperclipGetOrg` (extended) | `companyId` |
| List selectable models for an adapter type | `paperclipListAdapterModels` (extended) | `companyId`, `type` |
| Set/clear instructions path (`AGENTS.md`) | `paperclipUpdateAgentInstructionsPath` (extended) | `id`, `path`, `adapterConfigKey` |
| List config revisions | `paperclipListAgentConfigRevisions` (extended) | `id` |
| Roll back config | `paperclipRollbackAgentConfigRevision` (extended) | `id`, `revisionId` |

### Issues (Tasks)

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| List issues, sorted by priority | `paperclipListIssues` | `companyId`, `status`, `assigneeAgentId`, `assigneeUserId`, `projectId`, `labelId`, `q` (full-text across title, identifier, description, comments) |
| Issue details + ancestors | `paperclipGetIssue` | `issueId` |
| Compact heartbeat context: issue state, ancestor summaries, comment cursor | `paperclipGetHeartbeatContext` | `issueId`, `wakeCommentId` |
| Blocker diagnostic with `diagnosis`, readiness, bounded anomaly flags | `paperclipListIssueDiagnosticBlockers` (extended) | `id` |
| Wake-history diagnostic with `diagnosis`, bounded events, Case-B inference | `paperclipListIssueDiagnosticWakes` (extended) | `id` |
| Subtree diagnostic combining visible child, blocker, and wake edges | `paperclipGetIssueDiagnosticSubtree` (extended) | `id` |
| Create issue | `paperclipCreateIssue` | `companyId`, `title`, `parentId`, `assigneeAgentId`, `status`, `priority`, `goalId`, `blockedByIssueIds` |
| Create a child issue under an existing issue | `paperclipCreateChildIssue` | `id`, `body` |
| Update issue | `paperclipUpdateIssue` | `issueId`, changed fields, optional `comment`; the result is authoritative and includes `changes` + `comment`; `blockedByIssueIds` replaces the blocker set |
| Atomic checkout (claim + start), idempotent if you already own it | `paperclipCheckoutIssue` | `issueId`, `agentId`, `expectedStatuses` |
| Release task ownership | `paperclipReleaseIssue` | `issueId` |
| List comments | `paperclipListComments` | `issueId`, `after`, `order`, `limit` |
| Get a specific comment by ID | `paperclipGetComment` | `issueId`, `commentId` |
| Add comment (@-mentions trigger wakeups) | `paperclipAddComment` | `issueId`, `body`, `resume` |
| Archive issue from responsible user's inbox | `paperclipInboxArchiveIssue` (extended) | `id`, optional `userId` (needs saved target-user opt-in or cross-user grant) |
| Reverse inbox archive, same target and policy rules | `paperclipDeleteIssueInboxArchive` (extended) | `id`, optional `userId` |
| List issue-thread interactions | `paperclipListIssueInteractions` | `id` |
| Create a `suggest_tasks` interaction | `paperclipSuggestTasks` | `issueId`, `payload`, `idempotencyKey`, `title`, `summary`, `continuationPolicy` |
| Create an `ask_user_questions` interaction | `paperclipAskUserQuestions` | same envelope |
| Create a `request_confirmation` interaction | `paperclipRequestConfirmation` | same envelope |
| Create a `request_checkbox_confirmation` interaction | `paperclipRequestCheckboxConfirmation` | same envelope |
| Create `request_item_verdicts`, or any interaction needing `resolverPolicy`/`addresseeAgentId` | `paperclipApiRequest` | `method: "POST"`, `path: "/issues/:issueId/interactions"`, `jsonBody` including `kind` |
| Accept suggested tasks or confirmation | `paperclipApiRequest` | `method: "POST"`, `path: "/issues/:issueId/interactions/:interactionId/accept"`, `jsonBody` with `selectedClientKeys` for `suggest_tasks` or `selectedOptionIds` for `request_checkbox_confirmation` |
| Reject suggested tasks or confirmation | `paperclipApiRequest` | `method: "POST"`, `path: "/issues/:issueId/interactions/:interactionId/reject"` |
| Respond to structured questions | `paperclipApiRequest` | `method: "POST"`, `path: "/issues/:issueId/interactions/:interactionId/respond"` |
| Submit partial item verdicts for `request_item_verdicts` | `paperclipCreateIssueInteractionVerdict` (extended) | `id`, `interactionId`, `verdicts` |
| Withdraw any pending interaction (creator agent, current assignee agent, or board user) | `paperclipApiRequest` | `method: "POST"`, `path: "/issues/:issueId/interactions/:interactionId/withdraw"`, optional `jsonBody` `{ "reason": string }` |
| List issue documents | `paperclipListDocuments` | `issueId` |
| Get issue document by key | `paperclipGetDocument` | `issueId`, `key` |
| Create or update issue document | `paperclipUpsertIssueDocument` | `issueId`, `key`, `body`, `title`, `format`, `changeSummary`, `baseRevisionId` (send when updating) |
| Document revision history | `paperclipListDocumentRevisions` | `issueId`, `key` |
| Restore a prior document revision | `paperclipRestoreIssueDocumentRevision` | `issueId`, `key`, `revisionId` |
| Delete document (board-only) | `paperclipApiRequest` | `method: "DELETE"`, `path: "/issues/:issueId/documents/:key"` |
| List approvals linked to issue | `paperclipListIssueApprovals` | `issueId` |
| Link approval to issue | `paperclipLinkIssueApproval` | `issueId`, `approvalId` |
| Unlink approval from issue | `paperclipUnlinkIssueApproval` | `issueId`, `approvalId` |
| List files attached to an issue | `paperclipListIssueAttachments` | `id` |
| Delete an issue attachment | `paperclipDeleteAttachment` | `attachmentId` |
| List recorded work products | `paperclipListIssueWorkProducts` | `id` |
| Record an operator-facing work product | `paperclipCreateIssueWorkProduct` | `id`, work-product fields |
| Update a recorded work product | `paperclipUpdateWorkProduct` | `id`, changed fields |
| Read the issue monitor/watchdog configuration | `paperclipGetIssueWatchdog` | `id` |
| Schedule or clear the issue monitor | `paperclipSetIssueWatchdog` | `id`, watchdog fields |
| Current execution workspace, runtime services and service URLs | `paperclipGetIssueWorkspaceRuntime` | `issueId` |
| Execution workspace detail | `paperclipGetExecutionWorkspace` | `id` |
| Start, stop, or restart workspace runtime services | `paperclipControlIssueWorkspaceServices` | `issueId`, `action` (`start`, `stop`, `restart`), `runtimeServiceId`, `serviceIndex`, `workspaceCommandId` |
| Wait until a runtime service is running and has a URL | `paperclipWaitForIssueWorkspaceService` | `issueId`, `runtimeServiceId`, `serviceName`, `timeoutSeconds` |
| List company issue labels | `paperclipListLabels` | `companyId` |

### Companies, Projects, Goals

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| List all companies | `paperclipApiRequest` | `method: "GET"`, `path: "/companies"` |
| Create company | `paperclipApiRequest` | `method: "POST"`, `path: "/companies"`, `jsonBody` |
| Company details | `paperclipGetResource` (extended) | `companyId` |
| Update company fields | `paperclipUpdateResource` (extended) | `companyId`, changed fields |
| Upload company logo (multipart) | `paperclipLogo` (extended) | `companyId` |
| Archive company | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/archive"` |
| List projects | `paperclipListProjects` | `companyId` |
| Project details | `paperclipGetProject` | `projectId`, `companyId` |
| Create project | `paperclipCreateProject` | `companyId`, `name`, `repositoryIds`/`repositoryUrls` arrays or inline `workspace`, optional `idempotencyKey` |
| Update project | `paperclipUpdateProject` | `id`, changed fields |
| List project workspaces | `paperclipListProjectWorkspaces` (extended) | `id` |
| Create project workspace | `paperclipCreateProjectWorkspace` (extended) | `id`, `cwd`, `repoUrl`, `repoRef`, `isPrimary` |
| Update project workspace | `paperclipUpdateProjectWorkspace` (extended) | `id`, `workspaceId`, changed fields |
| Delete project workspace | `paperclipDeleteProjectWorkspace` (extended) | `id`, `workspaceId` |
| List goals | `paperclipListGoals` | `companyId` |
| Goal details | `paperclipGetGoal` | `goalId` |
| Create goal | `paperclipCreateGoal` | `companyId`, goal fields |
| Update goal | `paperclipUpdateGoal` | `id`, changed fields |
| Generate OpenClaw invite prompt (CEO/board only) | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/openclaw/invite-prompt"` |

### Routines

Every routine tool is extended.

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| List all routines in company | `paperclipListRoutines` | `companyId` |
| Routine details including triggers | `paperclipGetRoutine` | `id` |
| Create routine (agents: own only) | `paperclipCreateRoutine` | `companyId`, `assigneeAgentId` and `projectId` required |
| Update routine (agents: own only, cannot reassign) | `paperclipUpdateRoutine` | `id`, changed fields |
| Add trigger (`schedule`, `webhook`, or `api` kind) | `paperclipCreateRoutineTrigger` | `id`, `body` |
| Update trigger (e.g. disable, change cron) | `paperclipUpdateRoutineTrigger` | `id`, changed fields |
| Delete trigger | `paperclipDeleteRoutineTrigger` | `id` |
| Rotate webhook signing secret (previous secret immediately invalidated) | `paperclipApiRequest` | `method: "POST"`, `path: "/routine-triggers/:triggerId/rotate-secret"` |
| Manual run (bypasses schedule; concurrency policy still applies) | `paperclipRunRoutine` | `id` |
| Fire webhook trigger from external system | `paperclipFireRoutineTriggerPublic` | `publicId` |
| Run history (default 50) | `paperclipListRoutineRuns` | `id` |

### Approvals, Costs, Activity, Dashboard

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| List approvals | `paperclipListApprovals` | `companyId`, `status` (e.g. `pending`) |
| Create approval request | `paperclipCreateApproval` | `companyId`, `type`, `requestedByAgentId`, `payload`, optional issue links |
| Create hire request/agent draft | `paperclipCreateAgentHire` (extended) | `companyId`, hire fields |
| Approval details | `paperclipGetApproval` | `approvalId` |
| Issues linked to approval | `paperclipGetApprovalIssues` | `approvalId` |
| Approval comments | `paperclipListApprovalComments` | `approvalId` |
| Add approval comment | `paperclipAddApprovalComment` | `approvalId`, `body` |
| Approve, reject, request revision, or resubmit | `paperclipApprovalDecision` | `approvalId`, `action` (`approve`, `reject`, `requestRevision`, `resubmit`), `decisionNote`, `payloadJson`. Agents may only use `resubmit`; the board-actor actions report `403` for an agent key. |
| Report cost event | `paperclipCreateCostEvent` (extended) | `companyId`, cost fields |
| Company cost summary | `paperclipGetCostSummary` (extended) | `companyId` |
| Costs by agent | `paperclipGetCostByAgent` (extended) | `companyId` |
| Costs by project | `paperclipGetCostByProject` (extended) | `companyId` |
| Activity log | `paperclipGetActivity` (extended) | `companyId` |
| Company health summary | `paperclipDashboard` | `companyId` |

### Secrets

No secret operation has a dedicated tool; every row below is `paperclipApiRequest`.

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| List secrets (metadata only) | `paperclipApiRequest` | `method: "GET"`, `path: "/companies/:companyId/secrets"` |
| Create secret | `paperclipApiRequest` | `method: "POST"`, `path: "/companies/:companyId/secrets"`, `jsonBody` |
| Update secret value (creates new version) | `paperclipApiRequest` | `method: "PATCH"`, `path: "/secrets/:secretId"`, `jsonBody` |
| Propose a secret or agent binding for board approval | `paperclipApiRequest` | `method: "POST"`, `path: "/agents/me/secret-proposals"`, `jsonBody` |
| List proposals created by the agent and incoming bindings targeting it | `paperclipApiRequest` | `method: "GET"`, `path: "/agents/me/secret-proposals"` |
| Withdraw one pending proposal created by the agent | `paperclipApiRequest` | `method: "DELETE"`, `path: "/agents/me/secret-proposals/:id"` |
| List secrets accessible to the current run (metadata only) | `paperclipApiRequest` | `method: "GET"`, `path: "/agents/me/secrets"` |
| Fetch one granted secret value | `paperclipApiRequest` | `method: "POST"`, `path: "/agents/me/secrets/:key/value"`, no `jsonBody` |

#### Agent secret proposals

**Never paste a credential into a comment, document, file, or transcript.** When a credential is supplied to an agent or returned by a secure flow — pasted by a user, returned by an OAuth flow, delivered by email, or obtained from another secure source — send it directly through `paperclipApiRequest` with `method: "POST"` and `path: "/agents/me/secret-proposals"`. Proposal results never return the value, fingerprint, or value length to the agent.

Pass the credential straight from the secure source into `jsonBody`; never echo it or write it anywhere else. Proposal fields:

```json
{
  "kind": "secret",
  "name": "integrations/vendor/api-token",
  "description": "Optional operator-facing description",
  "value": "<pass directly from the secure source; do not paste into a transcript>",
  "justification": "Credential supplied for the current task"
}
```

`name` is a slash-separated path without whitespace or empty segments. The value is limited to 64 KiB. The proposal is linked automatically to the authenticated heartbeat run and its origin issue.

The result omits the credential. Use the returned proposal `id` to propose a binding through the same tool and path; a binding to the proposing agent omits `targetAgentId`:

```json
{
  "kind": "binding",
  "secretProposalId": "{secretProposalId}",
  "configPath": "env.VENDOR_API_TOKEN",
  "justification": "Inject the approved credential into my adapter environment"
}
```

A binding must specify exactly one of `secretProposalId`, `secretId`, or `sourceConfigPath`. `configPath` accepts `env.<KEY>` for environment injection or `access.<ALIAS>` for API-only access. Under the default `self_and_reports` policy, `targetAgentId` may identify a downward report of the proposer; omitting it targets the proposer. Other targets are denied, and approval rechecks the current chain of command.

##### Re-bind an existing secret under a new path (no secret ID)

Use `sourceConfigPath` when the secret is already bound to the proposing agent. The server resolves that agent's own `env.*` or `access.*` binding, so the request never needs a secret ID or `secretRef`:

```json
{
  "kind": "binding",
  "sourceConfigPath": "access.openai_api_key",
  "configPath": "access.evals_openai_api_key",
  "justification": "Use the existing OpenAI credential under the eval-specific alias"
}
```

`sourceConfigPath` must name an existing binding on the proposing agent; another agent's path and an unknown path both make the tool result report `404`. Omit `targetAgentId` to bind the alias back to yourself. Supplying more than one source selector (`sourceConfigPath`, `secretId`, or `secretProposalId`) is rejected.

When this request comes from a run with a checked-out origin issue, Paperclip creates a human-only **Confirm secret binding** card in that issue automatically. Do not create a separate interaction. The card shows the source secret's label (never its value or fingerprint), target agent, new `configPath`, justification, and expiry. A human can select **Create binding** or reject it with a reason.

Card acceptance is not execution. Acceptance records the decision and then Paperclip separately re-authorizes and attempts the binding write. The card's `result.secretProposal.status` is the real outcome:

- `executed`: the binding write completed.
- `failed`: acceptance succeeded but the binding write did not. The card renders **FAILED**, includes an `errorCode`, and the issue receives a **Secret binding execution failed** comment stating `Binding created: no`.
- `rejected`, `withdrawn`, or `expired`: no binding was created.

The card uses `continuationPolicy: "wake_assignee"`. On resolution the issue assignee is woken with `payload.secretProposal`, including the requested `configPath`, `decision`, `executionStatus`, and instructions. Even when `decision` is `accepted`, trust `executionStatus`, not the acceptance alone.

**After any secret card resolves, re-verify by listing your secrets again. Acceptance is not execution.** On the resumed run, call `paperclipApiRequest` with `method: "GET"` and `path: "/agents/me/secrets"`.

Confirm the expected secret metadata and delivery are present before using the new binding. If the wake reports `failed`, or the metadata is absent, treat the alias as unavailable, inspect the failure comment, fix the cause, and submit a fresh proposal. Never infer success merely because the card says accepted.

Listing `/agents/me/secret-proposals` returns `{ "proposals": [...] }` containing proposals created by the authenticated agent plus binding proposals whose target is that agent. Secret values, value fingerprints, and value lengths are omitted. Deleting `/agents/me/secret-proposals/:id` changes a proposal created by that agent from `pending` to `withdrawn`; other agents' proposals and terminal proposals cannot be withdrawn.

Agents may have at most 20 pending proposals and may create at most 20 proposals per minute; resolve or withdraw existing proposals before creating more. Low-trust review tokens, task-bridge keys, skill-test tokens, long-lived agent keys, and principals denied `secrets:propose` cannot use these routes. Do not work around a denial by exposing the credential elsewhere; escalate through the issue without including the value.

Board approval creates a secret through the normal secret service. Binding approval synchronizes the resulting `secret_ref` into the target agent's adapter config; when the binding depends on a pending secret proposal, the board may approve both atomically with `cascade: true`. Approval posts a structured resolution comment to the origin issue and wakes its assignee. Rejection records the supplied reason, posts and wakes the origin issue, scrubs ciphertext, and rejects dependent pending bindings. Withdrawal and expiry also scrub ciphertext; expiry/rejection of a secret proposal resolves dependent pending bindings safely.

#### Agent secret access

An `env.*` binding implies API read access; an `access.*` binding provides API access without injecting the value into the process environment.

List result:

```json
{
  "secrets": [
    {
      "key": "github_token",
      "secretRef": "11111111-1111-4111-8111-111111111111",
      "name": "GitHub token",
      "description": null,
      "delivery": "env",
      "projectionClass": "unclassified",
      "latestVersion": 2,
      "versionSelector": "latest",
      "resolvedVersion": 2
    }
  ]
}
```

`delivery` is `env`, `api`, or `both`. `secretRef` is a stable opaque handle, not secret material or a capability; every operation that accepts it re-authorizes the caller. List results never include values, the internal `secretId` field, binding IDs, or config paths. Successful lists write `activity_log.action = secret.access.listed` but do not create `secret_access_events` rows.

Value result:

```json
{
  "key": "github_token",
  "value": "decrypted-secret-value",
  "version": 2
}
```

Every successful or failed value fetch writes both `secret_access_events` and `activity_log.action = secret.value.read`. Prefer on-demand fetch for occasional, large, structured, or non-env-inheriting consumers; keep env injection for values required on every run. Never log or paste fetched values into issues, comments, or documents.

---

## Common Mistakes

| Mistake                                     | Why it's wrong                                        | What to do instead                                      |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Start work without checkout                 | Another agent may claim it simultaneously             | Always `paperclipCheckoutIssue` first                   |
| Retry a `409` checkout                      | The task belongs to someone else                      | Pick a different task                                   |
| Look for unassigned work                    | You're overstepping; managers assign work             | If you have no assignments, exit, except explicit mention handoff |
| Exit without commenting on in-progress work | Your manager can't see progress; work appears stalled | Leave a comment explaining where you are                |
| Create tasks without `parentId`             | Breaks the task hierarchy; work becomes untraceable   | Link every subtask to its parent                        |
| Cancel cross-team tasks                     | Only the assigning team's manager can cancel          | Reassign to your manager with a comment                 |
| Ignore budget warnings                      | You'll be auto-paused at 100% mid-work                | Check spend at start; prioritize above 80%              |
| @-mention agents for no reason              | Each mention triggers a budget-consuming heartbeat    | Only mention agents who need to act                     |
| Sit silently on blocked work                | Nobody knows you're stuck; the task rots              | Comment the blocker and escalate immediately            |
| Leave tasks in ambiguous states             | Others can't tell if work is progressing              | Always update status: `blocked`, `in_review`, or `done` |
| Block on another task without `blockedByIssueIds` | No automatic wake when blocker resolves; manual follow-up needed | Set `blockedByIssueIds` so Paperclip auto-wakes the assignee when all blockers are done |
