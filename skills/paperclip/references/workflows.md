# Paperclip Workflow Playbooks

Reference material for niche workflows that are pointed to from `SKILL.md`. Load only when the task matches.

Some playbooks below use `extended` toolset tools: they are available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`. Each step names the toolset when it matters.

---

## Project Setup (CEO/Manager)

When asked to set up a new project with workspace config (local folder and/or GitHub repo):

1. `paperclipCreateProject` (core) with the project fields. `companyId` is optional and defaults to your company.
2. Optionally include `workspace` in that same create call, or call `paperclipCreateProjectWorkspace` (extended) right after create with `{ "id": "<project-id>", ... }`.

Workspace rules:

- Provide at least one of `cwd` (local folder) or `repoUrl` (remote repo).
- For repo-only setup, omit `cwd` and provide `repoUrl`.
- Include both `cwd` + `repoUrl` when local and remote references should both be tracked.

---

## OpenClaw Invite (CEO)

Use this when asked to invite a new OpenClaw employee.

1. Generate a fresh OpenClaw invite prompt. There is no dedicated tool, so use `paperclipApiRequest` with `method: "POST"`, `path: "/companies/<companyId>/openclaw/invite-prompt"`, and `jsonBody: "{\"agentMessage\":\"optional onboarding note for OpenClaw\"}"`.

Access control:

- Board users with invite permission can call it.
- Agent callers: only the company CEO agent can call it.

2. Build the copy-ready OpenClaw prompt for the board:

- Use `onboardingTextUrl` from the result.
- Ask the board to paste that prompt into OpenClaw.
- If the issue includes an OpenClaw URL (for example `ws://127.0.0.1:18789`), include that URL in your comment so the board/OpenClaw uses it in `agentDefaultsPayload.url`.

3. Post the prompt in the issue comment so the human can paste it into OpenClaw.

4. After OpenClaw submits the join request, monitor approvals and continue onboarding (approval + API key claim + skill install).

---

## Setting Agent Instructions Path

Use `paperclipUpdateAgentInstructionsPath` (extended) instead of the generic agent patch when you need to set an agent's instructions markdown path (for example `AGENTS.md`):

```json
{
  "id": "<agent-id>",
  "path": "agents/cmo/AGENTS.md"
}
```

Rules:

- Allowed for: the target agent itself, or an ancestor manager in that agent's reporting chain.
- For `codex_local` and `claude_local`, default config key is `instructionsFilePath`.
- Relative paths are resolved against the target agent's `adapterConfig.cwd`; absolute paths are accepted as-is.
- To clear the path, send `"path": null`.
- For adapters with a different key, provide it explicitly:

```json
{
  "id": "<agent-id>",
  "path": "/absolute/path/to/AGENTS.md",
  "adapterConfigKey": "yourAdapterSpecificPathField"
}
```

---

## Company Import / Export

Whole-company package moves have no dedicated tool by design. Use `paperclipApiRequest` with the company-scoped paths when a CEO agent needs to inspect or move package content.

- CEO-safe imports — `method: "POST"` with `path: "/companies/<companyId>/imports/preview"`, then `path: "/companies/<companyId>/imports/apply"`
- Allowed callers: board users and the CEO agent of that same company.
- Safe import rules:
  - existing-company imports are non-destructive
  - `replace` is rejected
  - collisions resolve with `rename` or `skip`
  - issues are always created as new issues
- CEO agents may use the safe paths with `target.mode = "new_company"` to create a new company directly. Paperclip copies active user memberships from the source company so the new company is not orphaned.

For export, preview first and keep tasks explicit:

- `method: "POST"` with `path: "/companies/<companyId>/exports/preview"`, then `path: "/companies/<companyId>/exports"`
- Export preview defaults to `issues: false`
- Add `issues` or `projectIssues` only when you intentionally need task files
- Use `selectedFiles` to narrow the final package to specific agents, skills, projects, or tasks after you inspect the preview inventory

Send the request body as `jsonBody`, a JSON string.

---

## Self-Test Playbook (App-Level)

Use this when validating Paperclip itself (assignment flow, checkouts, run visibility, and status transitions).

1. Create a throwaway issue assigned to a known local agent (`claudecoder` or `codexcoder`) with `paperclipCreateIssue` (core):

```json
{
  "title": "Self-test: assignment/watch flow",
  "description": "Temporary validation issue",
  "status": "todo",
  "assigneeAgentId": "<agent-id>"
}
```

2. Trigger a heartbeat for that assignee with `paperclipInvokeAgentHeartbeat` (extended): `{ "id": "<agent-id>" }`.

3. Verify the issue transitions (`todo -> in_progress -> done` or `blocked`) and that comments are posted, with `paperclipGetIssue`: `{ "issueId": "<issue-id-or-identifier>" }`.

4. Reassignment test (optional): move the same issue between `claudecoder` and `codexcoder` with `paperclipUpdateIssue` and confirm wake/run behavior:

```json
{ "issueId": "<issue-id>", "assigneeAgentId": "<other-agent-id>", "status": "todo" }
```

5. Cleanup: mark temporary issues done/cancelled with `paperclipUpdateIssue` and a clear note.

The tools carry the current run context for you, so mutating calls stay attributed to the heartbeat run without any extra argument.
