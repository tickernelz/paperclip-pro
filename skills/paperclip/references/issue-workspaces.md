# Issue Workspace Runtime Controls

Use this reference when an issue has an isolated execution workspace and you need to inspect or run that workspace's services, especially for QA/browser verification.

All tools in this file are in the default `core` toolset.

## Discover the Workspace

Start from the issue, not from memory. Call `paperclipGetIssueWorkspaceRuntime` with the issue:

```json
{ "issueId": "PAP-1135" }
```

Read `currentExecutionWorkspace` in the result:

- `id` — execution workspace id used by workspace-scoped tools
- `cwd` / `branchName` — local checkout context
- `status` / `closedAt` — whether the workspace is usable
- `runtimeServices[]` — current services, including `serviceName`, `status`, `healthStatus`, `url`, `port`, and `runtimeServiceId`

If `currentExecutionWorkspace` is `null`, the issue does not currently have a realized execution workspace. For child/follow-up work, create the child with `parentId` or use `inheritExecutionWorkspaceFromIssueId` so Paperclip preserves workspace continuity.

## Control Services

Prefer Paperclip-managed runtime service controls over manual `pnpm dev &` or ad-hoc background processes. The tool keeps service state, URLs, logs, and ownership visible to other agents and the board.

`paperclipControlIssueWorkspaceServices` resolves the issue's workspace for you. Pass `issueId` and `action`:

```json
{ "issueId": "PAP-1135", "action": "start" }
{ "issueId": "PAP-1135", "action": "restart" }
{ "issueId": "PAP-1135", "action": "stop" }
```

`start` waits for the configured readiness checks. To target one configured service instead of all of them, add exactly one of:

```json
{ "workspaceCommandId": "web" }
{ "runtimeServiceId": "<runtime-service-id>" }
{ "serviceIndex": 0 }
```

The result includes an updated `workspace.runtimeServices[]` list and a `workspaceOperation`/`operation` record for logs. Treat that returned service state as the confirmation that the control actually applied; if the service you asked for is not in the result with the expected `status`, read the runtime again before claiming it is running.

## Read the URL

After `start` or `restart`, read the service URL from:

- the control result at `workspace.runtimeServices[].url`
- or a fresh `paperclipGetIssueWorkspaceRuntime` call at `currentExecutionWorkspace.runtimeServices[].url`

To block until a service is actually up, call `paperclipWaitForIssueWorkspaceService`:

```json
{ "issueId": "PAP-1135", "serviceName": "web", "timeoutSeconds": 120 }
```

Select the service by `serviceName` or `runtimeServiceId`. `timeoutSeconds` is optional (default 60, maximum 300). The tool returns once the service is running and reports its URL when one is exposed.

For QA/browser checks, use the service whose `status` is `running` and whose `healthStatus` is not `unhealthy`. If multiple services are running, prefer the one named `web`, `preview`, or the configured service the issue mentions.

## Workspace-Scoped Read

When you already hold an execution workspace id — for example from another agent's comment — `paperclipGetExecutionWorkspace` with `{ "id": "<execution-workspace-id>" }` returns that workspace and its runtime services. Prefer the issue-scoped tools above when you start from an issue: they resolve the workspace id for you.
