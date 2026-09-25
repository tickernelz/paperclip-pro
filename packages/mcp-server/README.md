# Paperclip MCP Server

Model Context Protocol server for Paperclip.

This package is a thin MCP wrapper over the existing Paperclip REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - Paperclip base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests
- `PAPERCLIP_MCP_TOOLSETS` - comma-separated toolsets to register: `core` (default), `extended`, or `all`
- `PAPERCLIP_AGENT_ROLE` - caller role; management roles (`ceo`, `board`) also see board-authority tools

Inside an active heartbeat, Paperclip also injects `PAPERCLIP_RUNTIME_TOOLS_*` variables. They enable the run-scoped `connections_search` and `connection_request` tools and expire with the run.

## Toolsets and authority

The tool surface is generated from the server's OpenAPI registry, so it tracks the API. Two independent filters decide what a client sees:

- **Toolset.** `core` is the default: the curated hand-written tools plus the everyday generated ones (61 tools, ~94 KB of `tools/list` JSON). `extended` adds the rest of the generated surface (all toolsets, management role: 715 tools, ~537 KB). Select with `PAPERCLIP_MCP_TOOLSETS=core,extended` or `--toolsets core,extended`; the CLI flag wins, an empty or unknown value falls back to `core`.
- **Authority.** Every generated tool carries `authority`: `agent` for routes an ordinary agent key can call, `board` for routes whose handler asserts board authority (the deciding guard and its `file:line` are recorded in `src/generated/api-tools.json`). Board-authority tools are registered only when the caller has a management role, taken from `PAPERCLIP_AGENT_ROLE` or, when that is unset, from `GET /api/agents/me` at startup.

Instance-admin, auth/setup/cli-auth, protocol/websocket and credential-reveal routes are excluded for everyone; `src/generated/excluded-operations.json` records each excluded operation with its reason and guard evidence.

## Regenerating the tool set

```sh
pnpm generate:mcp-tools   # rewrites src/generated/*.json from server/src/routes/openapi.ts
pnpm check:mcp-tools      # fails when the checked-in files are stale (CI Policy lane)
```

Names, descriptions, toolsets and annotations are refined in `src/tool-overrides.ts`, which also holds the reviewed allow/deny lists and the routes already covered by a curated tool.

## Usage

```sh
npx -y @tickernelz/paperclip-pro-mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @tickernelz/paperclip-pro-mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Curated tools keep their names and behaviour: the run-scoped `connections_search` and `connection_request`, the issue/comment/document/approval/workspace helpers (`paperclipMe`, `paperclipInboxLite`, `paperclipListIssues`, `paperclipCheckoutIssue`, `paperclipGetHeartbeatContext`, `paperclipUpdateIssue`, `paperclipAddComment`, `paperclipUpsertIssueDocument`, `paperclipGetIssueWorkspaceRuntime`, `paperclipApprovalDecision`, and the rest), and the `paperclipApiRequest` escape hatch.

Everything else is generated from the OpenAPI registry into `src/generated/api-tools.json`, one tool per operation, with a zod input schema built from its path parameters, query parameters and JSON body, `companyId` filled from `PAPERCLIP_COMPANY_ID` when the route is company-scoped, and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

`paperclipApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that have no dedicated MCP tool, including the credential
routes that are deliberately kept off the generated surface.
