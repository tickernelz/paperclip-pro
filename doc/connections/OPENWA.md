# OpenWA WhatsApp

**Status: experimental. Live qualification is pending; see the
[verification record](OPENWA-VERIFICATION.md).**

This channel binds one Paperclip agent to one WhatsApp number served by a
self-hosted [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA) gateway.
The provider id is `openwa` and the catalog label is **OpenWA**. The agent answers
people in DMs and groups, reports to the number's owners, asks the owners before
it acts for anyone else, and leaves an audit trail per endpoint. The connection
is a chat channel, not an MCP tool connection. Paperclip calls the gateway's
REST API and listens on its Socket.IO `/events` namespace; the gateway's own
`/mcp` endpoint is not used.

Implementation contract: [spec](../plans/2026-10-03-openwa-connector.md) and
[plan](../plans/2026-10-03-openwa-connector-plan.md).

## Risk: an unofficial WhatsApp engine

OpenWA drives a normal WhatsApp account through an unofficial engine
(`whatsapp-web.js` is the active engine; Baileys is installed but idle). It is
not the WhatsApp Business Platform. WhatsApp can restrict or ban a number that
sends too much, too fast, or to people who did not expect it.

- Keep the gateway's send pacing on (`SEND_PACING_ENABLED=true`). Paperclip
  cannot read that flag through the API, so setup asks the operator to attest
  it, and the health card shows **Observed** once the gateway first answers a
  send with `429 SEND_PACING_LIMITED`.
- The server never composes WhatsApp text, never auto-replies and never
  auto-approves. Every message is the agent's own decision; bulk and cross-chat
  sends need owner approval (`cross_chat_send`).
- A `session.restriction` event puts the endpoint in Attention (see
  [Health card](#health-card)).
- Paperclip is tested against OpenWA `0.23.7`
  (`OPENWA_GATEWAY_VERSION`, `packages/shared/src/openwa-operations.ts:3`). Another
  version shows a warning in setup and on the health card.

## Gateway prerequisites

Do these on the gateway host before connecting (spec §16). Paperclip never
changes the gateway.

1. Run rmyndharis/OpenWA `0.23.7` with a connected WhatsApp session whose
   status is `ready`.
2. In the gateway environment set `SEND_PACING_ENABLED=true` and
   `RESOLVE_LID_TO_PHONE=true`. The second lets group senders that appear as
   `@lid` resolve to phone numbers; unresolved LIDs are treated as outside the
   allowlist and never as owners.
3. In the OpenWA dashboard, open **API Keys** and create an **operator** key whose
   `allowedSessions` contains only this agent's session. Leave `allowedChats`
   empty: a chat-restricted key disables live Socket.IO events and setup rejects
   it. `allowedIps` may be used.
4. Optional: an unscoped **admin** key, only if you plan to enable gateway admin
   tools. Setup accepts it, and it is used only when **Gateway admin tools** is
   not `off`.
5. Use a session that no other bot, webhook consumer or script sends from.
   Messages other clients send as the session look like the owner typing on the
   phone.

Both keys are write-only and vaulted. Agents never receive either key.

## Setup

1. Enable the experimental **Chat connectors** setting
   (`enableChatConnectors`). Open **Apps → OpenWA**, or the agent's **Channels**
   panel, and choose the agent. The agent's adapter must authenticate runs with
   signed run tokens (`supportsLocalAgentJwt`); otherwise setup fails with 422
   `openwa_agent_adapter_unsupported` (see [Adapter support](#adapter-support)).
2. **Connect OpenWA**: enter **Gateway URL** (origin only, for example
   `http://localhost:2785`, without `/api`) and **Operator API key**. Under
   **Advanced**, optionally enter **Admin API key (optional)**. Select **Inspect
   gateway** (`POST /api/chat-endpoints/:endpointId/openwa/inspect`). Inspection
   is read-only and returns no secrets: gateway version (or "Unknown (assuming
   0.23.7)"), engine, key role, admin key role, warnings, and the sessions the key
   can see with masked numbers (`+62xxx...1234`) and push names. A key that sees
   more than one session gets the warning that it is not session-scoped.
3. Under **WhatsApp session**, select a `ready` session. A session or number
   already used by another non-archived endpoint in this instance is shown as
   unavailable ("This session or WhatsApp number already belongs to another
   channel").
4. **Whose number is this?** chooses the number mode, which cannot be changed
   later without reconnecting:
   - **A number dedicated to** the agent (`agent_number`, default): people message
     this number to reach the agent. DMs, mentions and replies start work.
   - **An owner's personal number** (`owner_number`): the agent replies as the
     owner. Only chats enabled in Settings can trigger it, its messages carry a
     visible prefix, and Paperclip can read every chat the session sees.
5. **Before connecting, confirm** both attestations: send pacing is on in the
   gateway, and Paperclip is the only app sending as this session. Both are
   required (`attestations.pacing`, `attestations.soleClient`). Select **Connect
   session** (`POST /api/chat-endpoints/:endpointId/setup` with action
   `configure`).
6. **Owners**: in Settings, **Add owner number** (E.164, for example
   `+6281234567890`). Paperclip returns a **Private identity-link URL**
   (valid 30 minutes by default, `expiresInSeconds` 300 to 86400). Send it only to
   that owner; they open it while signed in to Paperclip to link the number to
   their account (`POST /api/chat-endpoints/:endpointId/openwa/owners`).
7. **Owner test DM**: send a WhatsApp message from an owner's phone to the
   connected number. Only an owner's message completes the test. Setup completes
   after the agent's actual reply is delivered.

Setup errors: credential and scope problems 422, gateway throttling 429,
gateway unreachable 503 ("do not replace the API key or other credentials
because of this error"), malformed upstream 502. A failed reconnect keeps the
previous credential binding. **Reconnect** verifies the same gateway session and
API key, then recovers missed messages; leave the key blank to reuse the saved
keys. Reconnecting to a different gateway or session returns 409
`chat_bot_identity_changed` and needs a new channel. **Disconnect** archives the
channel and removes its saved API keys; the gateway session, its WhatsApp login
and its chat history remain on the gateway.

## Policy

Settings are stored in the endpoint policy (`openwaEndpointPolicySchema`,
`packages/shared/src/validators/chat-channels.ts:319`) and changed with
`PATCH /api/chat-endpoints/:endpointId/openwa/policy`. Each change bumps
`policy_revision`, applies to the next event, and is logged as
`openwa.config_changed`. A concurrent change returns 409
`openwa_policy_conflict`.

### Owners

An owner is a WhatsApp number in the endpoint's owner list whose identity link is
`linked` and whose Paperclip membership is active and not `viewer`. Owner status
is re-derived per message and per run. Owners can start full-access runs and
approve requests. Removing an owner, or revoking their identity link, revokes
the live grants that owner approved. Routes: `GET`/`POST`
`/api/chat-endpoints/:endpointId/openwa/owners`,
`DELETE /api/chat-endpoints/:endpointId/openwa/owners/:ownerId`.

### Sender policy

**Who can trigger the agent** (`senderPolicyMode`):

| Value | Label | Meaning |
| --- | --- | --- |
| `all` | Everyone | Every sender except the denylist |
| `allowlist` (default) | Owners and the allowlist | Owners and allowlisted numbers |
| `denylist` | Everyone except the denylist | Every sender except the denylist |

Owners are always allowed. Denylisted numbers are dropped everywhere, including
groups, and audited as `trigger_filtered`. A DM from outside the allowlist is
dropped and audited. In an active group, a sender outside the allowlist still
reaches the agent with role `outside_allowlist`; replying to them in that chat
needs a `reply_outside_allowlist` grant. Lists hold E.164 numbers with an optional
label: `GET`/`POST` `/api/chat-endpoints/:endpointId/openwa/sender-rules` (body
`list` `allow`|`deny`, `e164`, `label`),
`DELETE /api/chat-endpoints/:endpointId/openwa/sender-rules/:ruleId`.

### Chats

Each chat has an **Activation** (`activation`): `auto` (Automatic, default),
`on`, `off`.

- `agent_number`: DMs on `auto` are active. Groups on `auto` are active while at
  least one owner is a member, re-evaluated on join/leave and on reconnect. When
  the number is added to a group that evaluates inactive, the agent is woken with
  `group_added`.
- `owner_number`: `auto` is inactive for every chat except the owner's self-chat,
  which is always on for phone-typed owner commands. Only chats set to `on` can
  trigger the agent.
- Owner replies to approval bubbles are detected in every chat, whatever its
  activation.

Per-chat settings override the endpoint defaults: **Activation**, **Replies to
non-owners**, **Trigger overrides** (Default/On/Off per rule), **Prefix
override**, **Chat keywords**, **Absence timer (seconds)** (blank uses the
endpoint default) and **Note for the agent** (up to 2000 characters). **Add a
chat from WhatsApp** lists the gateway's chats. Routes:
`GET`/`PUT` `/api/chat-endpoints/:endpointId/openwa/chats` (body `chatId` ending in
`@c.us`, `@g.us` or `@lid`, optional `label`, `settings`),
`GET /api/chat-endpoints/:endpointId/openwa/gateway-chats` (`limit` 1 to 500, default
100; `offset`).

### Trigger rules

A message that matches no rule is discarded in memory: nothing is written to
Paperclip and it stays readable on the gateway through tools. Defaults come
from the number mode (`openwaDefaultTriggerRules`,
`packages/shared/src/validators/chat-channels.ts:286`); a chat's override wins.

| Key | Settings label | `agent_number` | `owner_number` |
| --- | --- | --- | --- |
| `directMessage` | Direct messages | on | off |
| `agentMentioned` | Agent mentioned | on | off |
| `replyToAgent` | Replies to the agent | on | on |
| `commandPrefix` | Command prefix (`/ai`) | off | on |
| `selfChat` | Self-chat | off | on |
| `ownerMentionedAbsent` | Owner mentioned while away | on | on |
| `keywords` | Keywords | none | none |
| `allMessages` | All messages | off | off |

The command prefix is 1 to 32 characters without whitespace and matches
case-insensitively. Keywords are comma-separated whole words, case-insensitive,
up to 50 of 1 to 100 characters. In `owner_number` mode the agent number's own
messages count only when typed on the phone. Control commands `/new`, `/close`
and `/status` are accepted from owners, and from allowed senders in DMs.

### Absence timer

While **Owner mentioned while away** is on for the chat, a non-owner message
that matches no other trigger arms a timer when it mentions an owner in an
active group, or arrives in an active DM in `owner_number` mode. The timer
lasts **Absence timer (seconds)**
(`absenceSeconds`, default 120, 10 to 86400; per chat override). Owner activity in
that chat before it fires cancels it: an owner-authored text, media, sticker,
location, contact or poll (phone-typed in `owner_number` mode). Reactions, edits,
revokes, read receipts and activity in other chats do not cancel it. When it
fires, the agent is woken with `owner_absent` (class `other`) carrying every
attached message, and decides whether to answer. A message that mentions both
the owner and the agent wakes the agent immediately and arms no timer. Timers
survive restarts.

### Reply policy

**Replies to non-owners** (`replyPolicy`, endpoint default with per-chat override)
applies to runs of class `other`:

| Value | Label |
| --- | --- |
| `allowed` (default) | Reply freely |
| `ask_owner` | Ask an owner first |
| `owner_absent_only` | Only while owners are away |

It is enforced on origin-chat sends (`reply_denied`) and on automatic
publication (suppressed and audited as `publication_suppressed`) until a
`reply` grant exists.

### Other endpoint settings

| Setting | Key | Default | Bounds |
| --- | --- | --- | --- |
| Start a new conversation after idle (hours) | `rotateAfterIdleHours` | 24 | 1 to 720 |
| Progress reminder (seconds) | `progressNudgeSeconds` | 60 | 0 to 3600, 0 turns it off |
| Typing indicator | `typingIndicator` | on | |
| Owner number label: Show the label / Label text | `ownerNumberPrefix.enabled` / `.text` | on / `🤖 *Assistant:*` | 1 to 64 characters |
| Gateway admin tools | `gatewayAdminTools` | `off` | `off`, `read`, `full` |
| Custom instructions | `customInstructions` | empty | up to 8000 characters |
| Keep content for (days) | `auditContentRetentionDays` | 90 | 1 to 3650 |

Each chat keeps one conversation task until it has been idle for
`rotateAfterIdleHours`, or until someone sends `/new`. The owner-number label is
added to the first part of each published message in `owner_number` mode. Custom
instructions are added to the agent's OpenWA guidance on every run, after the
built-in rules; they cannot override policy. Settings also shows capability
warnings for the agent's adapter (steering and read-only enforcement) and, in
`owner_number` mode, that conversation tasks contain the owner's own chats and
follow normal task visibility (`openwaCapabilityWarnings`,
`ui/src/pages/apps/chat/openwa-settings-model.ts:206`).

## Run classes and profiles

Every run on an OpenWA conversation issue has an immutable class and tool
profile derived at run start from server-written records only: the admitted
deliveries referenced by the wake, or an approved request with live grants.
Class claims in caller-supplied wake payloads are ignored.

| Class | Started by | Profile |
| --- | --- | --- |
| `owner` | Owner triggers, owner replies to an approval bubble (`approval_reply`) | `full` |
| `other` | Allowed and outside-allowlist senders, `owner_absent`, `group_added`, `approval_pending`, rejected `approval_resolved` | `read_only` |
| `grant` | Approved `approval_resolved` for one request | `read_only` plus the granted categories |

A run on the conversation issue without OpenWA context (agent mention,
continuation, retry, recovery) is `read_only`. A run requested by a human board
user is `full`. A live `external_tools` grant, or that category's approval toggle
turned off, also gives the run the `full` runtime tool profile. Child issues
created by owner or grant runs follow normal Paperclip authority.

A `read_only` run may use every read capability: runtime read/search tools and
`bash`, Paperclip reads, connector tools with risk `read`, and every OpenWA read over
the chats visible to the endpoint (in `owner_number` mode, enabled chats only). It
may comment on and attach artifacts to its own conversation issue, send to its
origin chat subject to the reply policy, and call `openwa_request_approval`. It may
not, unless the category's approval toggle is off or a live grant covers it:

| Category | Settings toggle | Covers |
| --- | --- | --- |
| `create_task` | Creating or delegating tasks | Creating, assigning or delegating issues; project creation |
| `external_tools` | Write tools and external actions | Connector tools with risk `write`/`destructive`, runtime write tools, email sends, Paperclip mutations outside the read-only allowlist |
| `cross_chat_send` | Sending to other chats | Sending or forwarding to a chat other than the origin chat |
| `wa_admin` | WhatsApp admin actions | Group join/leave/settings, message edit/delete/pin/star, block, labels, status posts, chat archive/mute/delete |
| `gateway_admin` | Gateway admin actions | Session lifecycle, API keys, webhooks, plugins, settings, infrastructure |

The REST seam denies non-allowlisted mutations of a `read_only` run with 403
(allowlist at `server/src/services/openwa/authority.ts:612`). Comments written by a
`read_only` run never trigger mention wakes. Persistent API keys of an agent bound
to a live OpenWA endpoint cannot make non-safe requests at all.

### Adapter support

The runtime half of `read_only` depends on the adapter's
`readOnlyToolProfile` capability (`enforced` or `instruction_only`; absent means
`instruction_only`, `server/src/routes/adapters.ts:191`). With `instruction_only`
the Paperclip seams above still apply, but the adapter's own file-writing tools
are not blocked and the run relies on the agent following its instructions.
`bash` stays available in every `read_only` run and is instruction-bound except
under Codex's read-only sandbox (accepted risk D32).

| Adapter type | Read-only | Mechanism | Source |
| --- | --- | --- | --- |
| `omp_local` | enforced | Per-run tool-guard extension blocks `edit`, `apply_patch`, `ast_edit`, `write` (except `xd://` devices), memory/skill/agent tools, LSP applies, non-read `github` ops, `hub` send and isolated tasks; `bash` kept | `packages/adapters/omp-local/src/server/tool-guard.ts:14-18`, `packages/adapters/omp-local/src/server/index.ts:104` |
| `codex_local` (CLI engine) | enforced | `--sandbox read-only -c approval_policy="never"`; configured bypass ignored and widening `extraArgs` removed; `bash` confined by the sandbox | `packages/adapters/codex-local/src/server/codex-args.ts:13`, `:82`, `server/src/adapters/registry.ts:355` |
| `codex_local` (ACP engine) | enforced | ACP session mode `read-only` plus a permission hook that allows only read/search/fetch/think kinds and MCP tool approvals | `packages/adapter-utils/src/acpx-engine/execute.ts:1478-1495` |
| `claude_local` (CLI engine) | enforced | `--disallowedTools Edit,Write,MultiEdit,NotebookEdit`; Bash kept | `packages/adapters/claude-local/src/server/permissions.ts:3`, `:21`, `server/src/adapters/registry.ts:279` |
| `claude_local` (ACP engine) | enforced | ACP session mode `default` plus a permission hook that rejects edit/delete/move kinds and the same four tools | `packages/adapter-utils/src/acpx-engine/execute.ts:1475-1493` |
| `pi_local` | enforced | `--tools read,bash,grep,find,ls`; operator `--tools`/`-t` removed | `packages/adapters/pi-local/src/server/execute.ts:233-236`, `server/src/adapters/registry.ts:848` |
| `gemini_local` | instruction only | On the ACP engine the shared hook still rejects edit/delete/move requests | `server/src/adapters/registry.ts:730` |
| `kimi_local` | instruction only | Same ACP note as Gemini | `server/src/adapters/registry.ts:784` |
| `opencode_local` | instruction only | | `server/src/adapters/registry.ts:827` |
| `cursor` | instruction only | | `server/src/adapters/registry.ts:686` |
| `grok_local` | instruction only | | `server/src/adapters/registry.ts:751` |
| `hermes_local` | instruction only | | `packages/adapters/hermes/src/index.ts:166` |
| `process` | instruction only | Arbitrary command | `server/src/adapters/process/index.ts:12` |

Adapters without signed run tokens cannot be bound to OpenWA:
`cursor_cloud`, `paperclip_runner`, `hermes_gateway`, `openclaw_gateway` and the
retired `acpx_local` (`supportsLocalAgentJwt: false`). Switching the endpoint's agent
to such an adapter puts the endpoint in Attention and stops admission.

## Approvals and grants

The agent asks with `openwa_request_approval` (categories, scope, summary,
proposed action and an agent-written `messageToOwners`, up to 3500 characters).
The server records the request and sends one bubble per owner approval chat (the
agent number's DM with each owner, or the owner's self-chat in `owner_number`
mode). Silence never approves.

- **WhatsApp**: an owner replies to the bubble, quoting it. That reply starts a
  dedicated `approval_reply` run (class `owner`). The agent interprets the free text
  and records `approve`, `reject` or `clarify` with `openwa_approval_resolve`; only that
  run may resolve that request, and `clarify` keeps it pending. A member quoting
  the bubble, an owner reply without a quote, and a quote of an already-resolved
  bubble never create a grant.
- **Paperclip**: the endpoint's **Approvals** tab lists requests by **Status**
  (Pending, Approved, Rejected, Cancelled, All) with origin chat, masked
  requester, scope, reminders sent and grants. Owners choose **Approve** or
  **Reject** with optional conditions or reason. API:
  `GET /api/chat-endpoints/:endpointId/openwa/approvals?status=`,
  `POST /api/chat-endpoints/:endpointId/openwa/approvals/:requestId/resolve` (body
  `decision` `approve`|`reject`, optional `reason` up to 2000 characters). The
  request also appears as an interaction on the conversation issue with resolver
  policy `chat_endpoint_owner`. Only current owners may resolve; other board users
  get 403 and see the requests view-only.
- The first resolution wins on either surface; the loser gets 409
  `already_resolved` with the winning `requestStatus`.
- Approved: the agent is woken with `approval_resolved` as a `grant` run in the origin
  chat. Rejected: `approval_resolved` as an `other` run; the agent tells the requester.
- **Reminders**: while a request is pending the server wakes the agent with
  `approval_pending` at **Reminder interval (minutes)** × k (`reminderMinutes`,
  default 30, 1 to 1440) for k up to **Maximum reminders** (`maxReminders`,
  default 3, 0 to 10). The agent may send a reminder with `remindRequestId` or do
  nothing. After the last reminder the request stays pending.
- **Grants** are one row per approved category with scope `one_action` (one gated
  call, consumed atomically by the grant run) or `requester` (usable by that
  requester's runs in that origin chat until expiry). A grant expires after
  **Grant lifetime (hours)** (`grantTtlHours`, default 24, 1 to 720). Grants are
  keyed by request, origin chat and requester; another member never uses them,
  and they survive conversation rotation.
- **Revocation**: removing an owner, or revoking or unlinking their identity link,
  revokes every live grant that owner approved (`openwa.grant_revoked`). Pending
  requests stay open for the other owners.

## Agent tools

Exposure: native runner tools; the HTTP route
`POST /api/companies/:companyId/openwa/tasks/:issueId/tools` (agent bearer plus
`X-Paperclip-Run-Id`, body `{ tool, arguments }`); and the per-run Paperclip MCP
toolset `openwa`. The bundled skill is `skills/openwa/SKILL.md`. Tools are offered on
runs of OpenWA conversation issues and their child issues. The server binds
company, endpoint, session, issue, run and profile; arguments never carry them.
Results are capped at 16 KB with continuation cursors, and media is never inlined.
Every call is audited as `tool_called`.

| Tool | Risk | Purpose |
| --- | --- | --- |
| `openwa_send` | write | Send text, image, video, audio, voice note, document, sticker, location, contact or poll to a chat (default origin chat). Markdown text; media from a task attachment; `mentions`; `quoteMessageId`; required `idempotencyKey`. New numbers are checked first. |
| `openwa_read_chat` | read | Page chat history, newest first, from the stored source (cursor) or live (`deep` reaches 2000 messages). |
| `openwa_get_media` | read | Store one message's media as a task attachment; returns attachment id, mime, size and transcript when available. |
| `openwa_find` | read | Find contacts and chats by name or number, check a number, or resolve a LID (exactly one of `query`, `phone`, `lid`). |
| `openwa_request_approval` | write | Ask the owners for categories; remind with `remindRequestId`. |
| `openwa_approval_resolve` | write | Record the owner's decision; only in the run started by that owner's reply to the bubble. |
| `openwa_stay_silent` | write | Mark the listed (default all visible pending) triggers silenced. |
| `openwa_handoff` | write | Hand owner triggers to a follow-up owner run with a note. |
| `openwa_catalog` | read | List gateway operations with category, availability and gate; filter by category or text. |
| `openwa_describe` | read | Argument schema and gates of one operation. |
| `openwa_call` | write | Run one catalog operation; non-read operations need an `idempotencyKey`. |

Source: `OPENWA_TOOLS`, `packages/shared/src/openwa-tools.ts:33`.

**Catalog.** The pinned manifest has 202 operations for OpenWA 0.23.7: 49
`read`, 25 `write`, 49 `wa_admin`, 79 `gateway_admin`. The catalog adds one
`paperclip` entry, `paperclip.audit.list`, for owner runs only. Each entry carries a
gate: `none` (reads), `reply_or_cross_chat_send` (writes that name a chat),
`cross_chat_send`, `wa_admin`, `gateway_admin`, `owner_confirmation` or `owner_only`.
Operations the active engine lacks are listed as unavailable
(`unavailable_on_engine`); a 501 from the gateway marks the operation unavailable
for that engine and it is never retried.

**Gateway admin levels** (`gatewayAdminTools`, Settings **Gateway admin tools**):

| Level | Label | Effect |
| --- | --- | --- |
| `off` (default) | Off | `gateway_admin` operations are hidden; calls return 403 `gateway_admin_disabled` |
| `read` | Read only | Only safe-method (GET/HEAD/OPTIONS) `gateway_admin` operations are visible |
| `full` | Full | All `gateway_admin` operations are visible; with an admin key, listing sessions becomes instance-global |

Operations that need an unscoped admin key stay unavailable
(`unavailable_without_admin_key`) until one is saved under **Admin API key**; saving
re-verifies the session and returns the channel to its test step. Non-owner
runs need `gateway_admin` approval. Stopping, logging out, deleting or force-killing
the endpoint's own session needs an owner run plus an owner's confirmation in
Paperclip (`self_session_requires_confirmation`); other runs get `owner_only`.

**WhatsApp configuration.** `openwa_endpoint_config` lets owner-class runs change
endpoint configuration from WhatsApp; other runs get `owner_only`. This tool is
being added in a separate task; see the bundled skill for its arguments.

## Gateway secrets (D38)

Operations that issue a credential or a device-linking code shown only once
are refused for every run class and level with 403 `secret_issuing_operation`
(`OPENWA_SECRET_ISSUING_OPERATIONS`, `server/src/services/openwa/catalog.ts:23`):
`AuthController_create`, `IntegrationInstanceController_create`,
`IntegrationInstanceController_regenerate`, `SessionController_requestPairingCode`
and `SessionController_getQRCode`. Do these in the OpenWA dashboard only.

Credential fields in every other gateway result, stored receipt, replay and
audit entry are replaced with `[REDACTED]` (`server/src/services/openwa/redact.ts`):
keys named `apiKey`, `api_key`, `secret`, `clientSecret`, `verifyToken`, `token`,
`accessToken`, `refreshToken`, `password`, `pairingCode`, `qr` and `qrCode`
(case-insensitive), any string starting with `owa_k1_`, and image data URLs under
`qr*` keys.

## Media and speech-to-text

Media of trigger messages is stored as attachments on the inbound comment
before the wake, under the normal attachment policy and the host cap
(`PAPERCLIP_ATTACHMENT_MAX_BYTES`, default 10 MiB). Each file has a 30 s deadline;
on timeout the wake proceeds with the item `pending` and the agent can call
`openwa_get_media`. Over-cap files are rejected without storing. Location and
contact cards arrive as structured data. Media of non-trigger messages is never
fetched unless the agent asks.

Speech-to-text is instance-wide: **Speech-to-text** on the instance General
settings page (`speechToText` in `GET`/`PATCH /api/instance/settings/general`):

| Field | Key | Default | Bounds |
| --- | --- | --- | --- |
| Toggle | `enabled` | off | needs base URL, model and env var |
| Base URL | `baseUrl` | empty | http(s) origin or ending at `/v1` (OpenAI-compatible `/audio/transcriptions`) |
| Model | `model` | empty | |
| API key environment variable | `apiKeyEnvVar` | empty | a server environment variable name, never the key |
| Max audio (seconds) | `maxAudioSeconds` | 600 | 1 to 7200 |
| Wake wait (seconds) | `sttWaitSeconds` | 15 | 1 to 120 |

The wake waits for a transcript up to `sttWaitSeconds`; a later transcript is
carried to the active run or the next wake. On failure the audio is kept and
the item is marked `transcript_unavailable`.

## Audit

The endpoint's **Audit** tab lists `chat_audit_entries` newest first with filters
**Kind**, **Actor**, **Chat**, **From** and **To**
(`GET /api/chat-endpoints/:endpointId/audit`, query `kind`, `chatKey`, `actorKind`,
`actorRef`, `from`, `to`, `cursor`, `limit` 1 to 100, default 25). Kinds:
`trigger_admitted`, `trigger_filtered`, `message_sent`, `publication_suppressed`,
`tool_called`, `approval_requested`, `approval_reminded`, `approval_resolved`,
`approval_cancelled`, `config_changed`, `group_added`, `group_left`,
`session_health`. Endpoint owners, company owners and instance admins see content;
other board users with endpoint access see metadata only. Owner-class runs can
read it through `openwa_call` operation `paperclip.audit.list`. Tool arguments are
redacted and bounded (4 KB arguments, 1 KB result summary).

**Retention**: a daily job clears content older than **Keep content for (days)**
(`auditContentRetentionDays`, default 90) in batches of 1000; metadata is kept and the
entry shows **Content purged**. Company activity also receives metadata-only
entries: `openwa.endpoint_created`, `openwa.endpoint_updated`, `openwa.owner_added`,
`openwa.owner_removed`, `openwa.sender_rule_changed`,
`openwa.chat_activation_changed`, `openwa.config_changed`,
`openwa.approval_requested`, `openwa.approval_resolved`, `openwa.approval_cancelled`,
`openwa.grant_created`, `openwa.grant_consumed`, `openwa.grant_revoked`,
`openwa.grant_expired` and `openwa.gateway_admin_called`.

## Health card

Settings opens with **Gateway health**
(`GET /api/chat-endpoints/:endpointId/openwa/health`, **Check again** to refresh). It
never returns keys or full numbers.

| Row | Shows |
| --- | --- |
| Gateway version | Version from the gateway's API document, highlighted when it differs from 0.23.7; "Unknown (API document unavailable)" otherwise |
| Engine | Active engine |
| Session | Session status and masked number, highlighted unless `ready` |
| Pacing | "Observed · last limited …", "Attested · not yet observed" or "Not attested" |
| Restriction | "None", or "Active (kind) until …" |

A session status other than `ready` sets the endpoint to Attention with
"OpenWA session: session is …"; an active restriction sets it with "OpenWA
restriction: WhatsApp restricted this account (…)". Both write a
`session_health` audit entry and clear when the session is ready again.

## In-flight messages and progress

Configured through the in-flight mode setting (endpoint `inflight_mode`, `steer` or
`queue`; OpenWA endpoints are created with `steer`). Settings → **Conversation** shows
it as **Messages during a run**. Behaviour per spec §7.3:

| New trigger | Active run | Result |
| --- | --- | --- |
| Owner message | any | Steered into the run; the profile does not change |
| `other` message | `read_only`, class `other` | Steered |
| `other` message | `full` or `grant` | Queued as the next wake |
| `approval_reply` | any | Its own wake, never steered |

If the agent cannot act on an owner message in its current profile, an
`openwa_handoff` or an unanswered owner trigger produces a follow-up owner run after
the current run. Steering needs an adapter with live steering (OMP registers a
steer target in RPC mode). With `queue`, or an adapter that cannot steer, every
row above becomes "queued", and Settings warns.

**Progress nudges** (spec §7.6): while a triggered run is active and nothing was
sent to the origin chat for `progressNudgeSeconds` (default 60), the server steers
an internal reminder into the run; then every 180 s, at most 5 per run; 0
disables them. Without steering, nudges are unavailable. The server never sends
progress text itself; the agent decides. **Typing indicator** shows typing in
the origin chat while a triggered run is active.

## Troubleshooting

| Symptom | Code | Action |
| --- | --- | --- |
| Setup or reconnect returns 503 "could not reach the OpenWA gateway" | `openwa_gateway_unreachable` | Start the gateway or fix the network path. Do not replace credentials: the stored keys are kept. Tools report 503 `gateway_unavailable`. |
| 422 "OpenWA rejected the API key" | `openwa_credentials_invalid` | Copy an active operator key from the OpenWA dashboard. |
| 422 viewer role / not allowed to read sessions | `openwa_key_role_insufficient`, `openwa_credentials_scope` | Use an operator key scoped to the agent's session. |
| 422 "restricted to selected chats" | `openwa_key_chat_scoped` | Create a key with `allowedSessions` only and no `allowedChats`. |
| 422 admin key invalid | `openwa_admin_key_invalid` | Use an unscoped admin key, or leave it empty. |
| 422 adapter cannot sign run tokens, or endpoint in Attention after an agent change | `openwa_agent_adapter_unsupported` | Choose an agent with a supported adapter, then reconnect. |
| 409 when connecting | `chat_bot_identity_in_use`, `chat_bot_identity_changed` | The session or number belongs to another channel, or reconnect targets a different gateway/session; free it or create a new channel. |
| 502 unexpected response | `openwa_invalid_response` | Check the gateway version and logs. |
| Attention "OpenWA restriction: …" | `session_health` audit | WhatsApp restricted the number. Stop sending, review pacing, wait for expiry; the health card shows the kind and expiry. Tools report 409 `session_not_ready` while the session is not ready. |
| Tool error `unavailable_on_engine` (422) | gateway 501 | The active engine does not implement the operation. It is not retried; use another operation. |
| Tool error `unavailable_without_admin_key` (422) | | Save an unscoped admin key, or avoid the operation. |
| Tool error `gateway_admin_disabled` (403) | | Raise **Gateway admin tools** to `read` or `full`. |
| Tool error `retry_after` (429) with `retryAfterSeconds` | `pacing: true` when the gateway paced the send | WhatsApp throttling; the agent retries with the same `idempotencyKey` after the delay. The health card then shows Pacing Observed. |
| Approval returns 409 | `already_resolved` | Another owner or surface resolved it first; the list refreshes with the winner. |
| Approval returns 403 | | Only current owners may resolve; add and link your number under Settings → Owners. |
| Tool error `owner_only` | | The action needs an owner-class run: audit reads, own-session stop/logout/delete, handoff of non-owner triggers, configuration from WhatsApp. |
| Tool error `approval_required` / `reply_denied` (403) | category in `details` | The run's profile or the reply policy needs an owner grant; the agent asks with `openwa_request_approval`. |
| Tool error `secret_issuing_operation` (403) | | Issue keys, pairing codes and QR codes in the OpenWA dashboard. |
| Tool error `number_not_on_whatsapp` / `quote_unresolvable` (422) | | The number is not registered, or the quoted message is not in that chat. |
| Tool error `chat_inactive` (403) | | In `owner_number` mode only chats enabled in Settings are visible. |

Diagnostics use the endpoint's Audit tab, company activity and run records.
