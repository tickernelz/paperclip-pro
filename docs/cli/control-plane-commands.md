---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
npx @tickernelz/wardmote issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
npx @tickernelz/wardmote issue get <issue-id-or-identifier>

# Create issue
npx @tickernelz/wardmote issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
npx @tickernelz/wardmote issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
npx @tickernelz/wardmote issue comment <issue-id> --body "..." [--reopen]

# Checkout task
npx @tickernelz/wardmote issue checkout <issue-id> --agent-id <agent-id>

# Release task
npx @tickernelz/wardmote issue release <issue-id>
```

## Company Commands

```sh
npx @tickernelz/wardmote company list
npx @tickernelz/wardmote company get <company-id>
npx @tickernelz/wardmote company current [--company-id <company-id>]

# Export to portable folder package (writes manifest + markdown files)
npx @tickernelz/wardmote company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
npx @tickernelz/wardmote company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
npx @tickernelz/wardmote company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

With agent authentication, use `company list` or `company current` to resolve
the scoped company. `company list` first tries the board-wide list; if that is
forbidden, it falls back to `--company-id`, `WARDMOTE_COMPANY_ID`, context, or
`/api/agents/me` and returns only that scoped company. `company create` requires
board/instance-admin authentication because it is an instance-wide setup
command.

## Agent Commands

```sh
npx @tickernelz/wardmote agent list
npx @tickernelz/wardmote agent get <agent-id>
```

## Skills Commands

```sh
# Browse app-shipped catalog skills without changing company state
npx @tickernelz/wardmote skills browse [--kind bundled|optional] [--category software-development] [--query github]
npx @tickernelz/wardmote skills search "pull request" [--json]

# Inspect catalog metadata and file inventory before install
npx @tickernelz/wardmote skills inspect github-pr-workflow

# Install a catalog skill into the company skill library
# This does not attach the skill to any agent.
npx @tickernelz/wardmote skills install github-pr-workflow --company-id <company-id>
npx @tickernelz/wardmote skills install github-pr-workflow --as pr-flow --force --company-id <company-id>

# External sources still use import instead of catalog install
npx @tickernelz/wardmote skills import ./skills/my-skill --company-id <company-id>
npx @tickernelz/wardmote skills import owner/repo/path/to/skill --company-id <company-id>

# Attach desired company skills to an agent after install/import
npx @tickernelz/wardmote skills agent sync <agent-id> --skill github-pr-workflow --mode add --company-id <company-id>
```

## Approval Commands

```sh
# List approvals
npx @tickernelz/wardmote approval list [--status pending]

# Get approval
npx @tickernelz/wardmote approval get <approval-id>

# Create approval
npx @tickernelz/wardmote approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
npx @tickernelz/wardmote approval approve <approval-id> [--decision-note "..."]

# Reject
npx @tickernelz/wardmote approval reject <approval-id> [--decision-note "..."]

# Request revision
npx @tickernelz/wardmote approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
npx @tickernelz/wardmote approval resubmit <approval-id> [--payload '{"..."}']

# Comment
npx @tickernelz/wardmote approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
npx @tickernelz/wardmote activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
npx @tickernelz/wardmote dashboard get
```

## Instance Settings

```sh
npx @tickernelz/wardmote instance settings:general
npx @tickernelz/wardmote instance settings:general:update --payload-json '{...}'
npx @tickernelz/wardmote instance settings:experimental
npx @tickernelz/wardmote instance settings:experimental:update --payload-json '{...}'
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

## Heartbeat

```sh
npx @tickernelz/wardmote heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
