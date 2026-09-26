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

- **Toolset.** `core` is the default: the curated hand-written tools plus the everyday generated ones (61 tools, ~36 KB of `tools/list` JSON, ~9k tokens). `extended` is a **superset of `core`**, not a sibling: selecting it registers `core` plus the rest of the generated surface (442 tools, ~210 KB; an agent carrying company authority also sees the board-authority tools, 719 tools, ~344 KB). `all` is the same union of everything. Select with `PAPERCLIP_MCP_TOOLSETS=core,extended` or `--toolsets core,extended`; the CLI flag wins, an empty or unknown value falls back to `core`. Requesting `extended` alone therefore never drops a core-only tool such as `paperclipCreateChildIssue` or the watchdog pair.
- **Names.** Generated tool names are capped at 40 characters (`NAME_LENGTH_LIMIT` in `scripts/generate-mcp-tools.ts`) because a host that truncates an over-long name cannot call the truncated form. An over-long name is shortened by dropping redundant path words, then by a deterministic six-hex path digest, so a name is stable across regenerations.
- **Parameter names.** A bare `{id}` or `{key}` path placeholder is renamed after the resource segment that precedes it (`/issues/{id}` becomes `issueId`, `/cases/{key}` becomes `caseId`), so a caller never has to guess which `id` a tool wants. The rename is internal: the request path substitution and the wire path are unchanged.
- **Shared description text.** Statements a route repeats on every one of its operations are lifted out of the per-tool descriptions into `src/generated/shared-tool-notes.json`, surfaced once through `sharedToolNotes()` on the MCP `initialize` result. Each tool description keeps only what is specific to that operation.
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

## Server-hosted endpoint

The Paperclip server hosts the same tool surface at `POST /api/mcp/paperclip`, so a run does not have to spawn this package as a child process. It is stateless streamable HTTP: one endpoint, JSON responses, no `Mcp-Session-Id`, `GET` and `DELETE` answer `405`.

- Authentication is the REST API's: `Authorization: Bearer <run agent key>` plus `X-Paperclip-Run-Id`. Only agent actors are accepted; a board actor gets `403`, a missing credential `401`.
- `companyId` and `agentId` come from the authenticated agent, never from a request header, and board-authority tools are exposed only when that agent's `agentAuthorityCapabilities` include company-level authority.
- Toolsets come from `?toolsets=core,extended`; absent, empty or unknown values fall back to `core`, and `extended` implies `core` rather than replacing it.
- Each `tools/call` re-enters the REST API over the server's own loopback address with the caller's bearer token, so every route guard, record rule and audit hook runs exactly as it does for a direct API call.

Tool definitions are built once per process and per (toolset, authority) variant; the `tools/list` payload is memoized with them.

## Error contract

A `tools/call` that fails is still a JSON-RPC success with a `result`, but the result carries the MCP error flag so a host cannot mistake it for data:

- **`isError: true`** on every failure path: an API rejection (`PaperclipApiError`), a bad argument (zod validation), and any other thrown value. A successful call omits the field.
- **`_meta["paperclip/httpStatus"]`** carries the original HTTP status when the failure came from the API, so a host can tell a `403` from a `500` without parsing the text. It is absent for argument and unknown failures.
- **Argument failures are flattened to one line per problem**, `issueId: expected string, received undefined`, instead of a stringified JSON array inside a JSON string. API failures keep the structured `{ error, status, method, path, body }` text payload.

```json
{
  "content": [{ "type": "text", "text": "GET /issues/X failed with 403: Board access required" }],
  "isError": true,
  "_meta": { "paperclip/httpStatus": 403 }
}
```

## Tool Surface

Curated tools keep their names and behaviour: the run-scoped `connections_search` and `connection_request`, the issue/comment/document/approval/workspace helpers (`paperclipMe`, `paperclipInboxLite`, `paperclipListIssues`, `paperclipCheckoutIssue`, `paperclipGetHeartbeatContext`, `paperclipUpdateIssue`, `paperclipAddComment`, `paperclipUpsertIssueDocument`, `paperclipGetIssueWorkspaceRuntime`, `paperclipApprovalDecision`, and the rest), and the `paperclipApiRequest` escape hatch.

`paperclipListIssues` returns at most `limit` issues and defaults to **25**, not the route's 500, so one call cannot pull the whole board into context. It accepts `limit` (max 1000), `offset`, `view: "compact"`, `updatedSince`, `sortField`, `sortDir` and `includeConversations`, alongside the existing filters. Raise `limit` explicitly when a complete listing is genuinely needed.

Everything else is generated from the OpenAPI registry into `src/generated/api-tools.json`, one tool per operation, with a zod input schema built from its path parameters, query parameters and JSON body, `companyId` filled from `PAPERCLIP_COMPANY_ID` when the route is company-scoped, and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

`paperclipApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that have no dedicated MCP tool, including the credential
routes that are deliberately kept off the generated surface.
