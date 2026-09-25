# Paperclip Create Agent API Reference

## Tools

Tools marked extended load only when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest` (`method`, `path` relative to `/api`, `jsonBody` as a JSON string) for the same job.

| Job | Tool | Key arguments |
| --- | ---- | ------------- |
| Read the company adapter-configuration catalogue | `paperclipListAgentConfigurations` (extended) | `companyId` |
| List the company skill library | `paperclipListSkills` | `companyId` |
| Import a skill into the company library | `paperclipImportSkill` (extended) | `companyId`, import fields |
| Read one agent's resolved configuration | `paperclipGetAgentConfiguration` (extended) | `id` |
| Sync skills onto an agent | `paperclipSyncAgentSkill` (extended) | `id`, sync fields |
| Submit a hire request (agent draft + approval) | `paperclipCreateAgentHire` (extended) | `companyId`, hire fields below |
| Create an agent directly, no approval | `paperclipCreateAgent` (extended) | `companyId`, same shape as the hire fields |
| List agent config revisions | `paperclipListAgentConfigRevisions` (extended) | `id` |
| Roll back a config revision | `paperclipRollbackAgentConfigRevision` (extended) | `id`, `revisionId` |
| Link an approval to an issue | `paperclipLinkIssueApproval` | `issueId`, `approvalId` |
| List issues linked to an approval | `paperclipGetApprovalIssues` | `approvalId` |
| Approval details | `paperclipGetApproval` | `approvalId` |
| Approval comments | `paperclipListApprovalComments` | `approvalId` |
| Add an approval comment | `paperclipAddApprovalComment` | `approvalId`, `body` |
| Approve, reject, request revision (board), or resubmit | `paperclipApprovalDecision` | `approvalId`, `action` (`approve`, `reject`, `requestRevision`, `resubmit`), `decisionNote`, `payloadJson`. Agents may only use `resubmit`. |

Adapter documentation and the icon catalogue are plain-text documents published by the deployment at `/llms/agent-configuration.txt`, `/llms/agent-configuration/<adapterType>.txt`, and `/llms/agent-icons.txt`. They are documentation, not API operations, and have no tool; `paperclipListAgentConfigurations` returns the structured adapter-configuration catalogue.

## `paperclipCreateAgentHire`

Arguments match the agent create shape:

```json
{
  "companyId": "{companyId}",
  "name": "CTO",
  "role": "cto",
  "title": "Chief Technology Officer",
  "icon": "crown",
  "reportsTo": "uuid-or-null",
  "capabilities": "Owns architecture and engineering execution",
  "desiredSkills": ["vercel-labs/agent-browser/agent-browser"],
  "adapterType": "claude_local",
  "adapterConfig": {
    "cwd": "/absolute/path",
    "model": "claude-sonnet-4-5-20250929"
  },
  "instructionsBundle": {
    "entryFile": "AGENTS.md",
    "files": {
      "AGENTS.md": "You are CTO..."
    }
  },
  "runtimeConfig": {
    "heartbeat": {
      "enabled": false,
      "wakeOnDemand": true
    }
  },
  "budgetMonthlyCents": 0,
  "sourceIssueId": "uuid-or-null",
  "sourceIssueIds": ["uuid-1", "uuid-2"]
}
```

Result:

```json
{
  "agent": {
    "id": "uuid",
    "status": "pending_approval"
  },
  "approval": {
    "id": "uuid",
    "type": "hire_agent",
    "status": "pending",
    "payload": {
      "desiredSkills": ["vercel-labs/agent-browser/agent-browser"]
    }
  }
}
```

If company setting disables required approval, `approval` is `null` and the agent is created as `idle`.

`desiredSkills` accepts company skill ids, canonical keys, or a unique slug. The server resolves and stores canonical company skill keys.
Leave timer heartbeats disabled by default. Only set `runtimeConfig.heartbeat.enabled=true` and include an `intervalSec` when the role truly needs scheduled recurring work or the user explicitly requested it.

## Approval Lifecycle

Statuses:

- `pending`
- `revision_requested`
- `approved`
- `rejected`
- `cancelled`

For hire approvals:

- approved: linked agent transitions `pending_approval -> idle`
- rejected: linked agent is terminated

## Safety Notes

- Config read tools redact obvious secrets.
- `pending_approval` agents cannot run heartbeats, receive assignments, or create keys.
- All actions are logged in activity for auditability.
- Use markdown in issue/approval comments and include links to approval, agent, and source issue.
- After approval resolution, requester may be woken with `PAPERCLIP_APPROVAL_ID` and should reconcile linked issues.
