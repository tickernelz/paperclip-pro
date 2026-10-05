# Spec: OpenWA chat connector

Status: draft v3 (2026-10-03). Revised after independent review cycles 1 (15 findings) and 2 (10 findings) and the owner's tool-access clarification. Owner: Zhafron.
Flow: interview-me -> spec-driven-development -> independent review -> planning-and-task-breakdown.

Evidence sources: the live gateway OpenAPI document (`GET /api/docs-yaml`, version 0.23.7, 202 operations; checked in by plan task T2), upstream `docs/06-api-specification.md` and `src/engine/engine-capability-matrix.ts` at tag `v0.23.7`, and the code citations inline.

## 0. Decision log

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Whose number | Both modes per endpoint: `agent_number` (dedicated number) and `owner_number` (owner's personal number) |
| D2 | Gates vs actions | Code enforces gates. Every outgoing action is the agent's decision (section 2) |
| D3 | Conversation mapping | One conversation issue per chat; real work becomes agent-created child issues |
| D4 | Wake triggers | Configurable trigger rules (section 6.5) |
| D5 | Absence timer | Server measures, wakes the agent with `owner_absent`; agent asks the owner through a `reply` approval and holds the group |
| D6 | Approval channel | WhatsApp reply to the request bubble, or Paperclip UI; first resolution wins |
| D7 | Group sender outside allowlist | Reaches the agent as `outside_allowlist`; answered without a grant when they mentioned the agent or replied to it in an active group, otherwise report/approval only. Denylist always dropped |
| D8 | Tool path | Paperclip proxies gateway REST; gateway `/mcp` unused |
| D9 | Ingress | Socket.IO `/events` plus catch-up |
| D10 | In-flight messages | Steer by default, queue fallback |
| D11 | Approval categories | Configurable list, default all required |
| D12 | Unanswered approval | Stays pending; agent-driven reminders; silence never approves. Refined: the shared conversation issue is not set to `blocked` (review #13) |
| D13 | Owners | One or more per endpoint, each linked to a Paperclip user |
| D14 | Progress | Agent sends progress; server steers nudges into a silent run |
| D15 | Voice notes | Optional speech-to-text, instance-wide |
| D16 | New groups (`agent_number`) | Active when an owner is a participant; otherwise inactive and reported by the agent |
| D17 | `owner_number` privacy | Only explicitly enabled chats can trigger the agent |
| D18 | Release | One release containing every slice |
| D19 | Non-owner replies | Default `allowed`; configurable `ask_owner` / `owner_absent_only` |
| D20 | `owner_number` absence in DMs | Supported, configurable per chat |
| D21 | `owner_number` label | Configurable prefix, default on |
| D22 | Conversation lifetime | New conversation issue after N idle hours (default 24) or `/new` |
| D23 | Audit | Content + metadata, content retention default 90 days |
| D24 | Config management | Paperclip UI and owner-triggered WhatsApp turns |
| D25 | Instruction language | Built-in guidance in English; the agent replies in the person's language |
| D26 | Publication | Automatic final output plus tool sends, per-trigger dedupe, explicit silence |
| D27 | Non-trigger chatter | Not copied into Paperclip |
| D28 | Performance | Section 15 budgets are acceptance criteria |
| D29 | Anti-ban pacing | Required: operator attestation plus runtime detection |
| D30 | Gateway admin tools | Included, configurable `off` / `read` / `full` |
| D31 | Tool access | Run profile per run: owner-triggered runs get full access; other runs get every read capability (knowledge is not limited); writes and execution need owner approval |
| D32 | `bash` in read-only runs | Available; read-only for `bash` is instruction-bound (accepted risk) |
| D33 | WhatsApp reads in non-owner runs | Every chat visible to the endpoint is readable (accepted risk) |
| D34 | Steering vs profile | Owner messages are always steered into the active run without raising its profile; non-owner messages are steered only into read-only runs |
| D35 | Adapter authentication | OpenWA endpoints require an agent adapter that authenticates runs with signed run-bound JWTs (`supportsLocalAgentJwt`); persistent agent keys of that agent are read-only |
| D36 | Grant scope | A grant applies only to the approved request: its requester, origin chat and proposed action. Other members need their own approval. A `one_action` `external_tools` grant is consumed at run start and covers that single grant run, because runtime tool profiles are fixed at adapter launch and individual runtime dispatches cannot be metered. |
| D37 | Approval chats | Owner replies to approval bubbles are detected in any chat regardless of activation; the self-chat is implicitly active for owner commands in `owner_number` mode |
| D38 | Gateway secrets | Secret-issuing gateway operations are refused for agents; credential fields in gateway results are redacted |

## 1. Objective

Add a chat-channel provider **OpenWA** (`openwa`) that binds one Paperclip agent to one WhatsApp number served by a self-hosted [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA) gateway. The connector helps the number's owner work: the agent answers people in DMs and groups with full knowledge, reports to the owner, asks the owner before executing anything for other people, and leaves an audit trail the owner inspects in Paperclip.

The name is `OpenWA`, not `WhatsApp`; other WhatsApp libraries may become separate providers.

Success:

- The owner works with the agent from WhatsApp without opening Paperclip, with the agent's full toolset.
- A member asks about a problem; the agent investigates with read access (code, logs, issues, chats) and answers. Fixing it waits for the owner's approval.
- A member mentions the owner; the owner stays silent for 2 minutes; the agent answers from its knowledge.
- Every trigger, filtered attempt, outgoing message, tool call, approval and configuration change is inspectable per endpoint.

## 2. Principle: gates in code, actions by the agent

A **gate** is a server check that admits, denies or schedules based on identity, configuration and provenance: owner identity, sender lists, chat activation, trigger rules, run profile, approval categories and grants, approval provenance, timers, idempotency, rate limits.

An **action** is anything a WhatsApp user sees or that changes external state.

Server-initiated effects are limited to:

1. Waking the agent with a structured event (section 9.3).
2. Steering an internal reminder or a newly arrived message into a running turn.
3. Typing presence while a triggered run is active (presentation toggle, no content).
4. Publishing the agent's own final output under section 7.5.
5. Delivering agent-authored text for `openwa_request_approval`.

The server never composes WhatsApp message text, never auto-replies, auto-reports or auto-approves. The only server-added text is the configured `owner_number` prefix. The generic "needs an authorized response in Paperclip" interaction text (`server/src/services/chat-interaction-publications.ts:208-212`) is never published to OpenWA chats.

## 3. Gateway facts this spec depends on

| Fact | Consequence |
| --- | --- |
| rmyndharis/OpenWA `0.23.7` (NestJS, `/api` prefix, port 2785); not open-wa.org | Operation manifest pinned to 0.23.7, regenerated and reviewed on upgrade |
| Active engine `whatsapp-web.js`; Baileys installed, idle | Static capability matrix per (version, engine) in the manifest; a 501 marks the operation unavailable at runtime and is never retried |
| `X-API-Key` header only; roles viewer < operator < admin; key scopes `allowedSessions`, `allowedChats`, `allowedIps` | Operator key scoped to one session, no `allowedChats` (it disables Socket.IO) |
| Admin operations (API keys, settings, stats overview, session create, plugins) require an **unscoped admin** key; reading key scopes needs admin; `/metrics` needs `METRICS_TOKEN` | Optional second credential for gateway admin tools; setup infers key scope from visible sessions |
| `SEND_PACING_ENABLED` is not readable through the API; only `429 SEND_PACING_LIMITED` reveals it | Pacing is an operator attestation plus a runtime detector |
| Socket.IO namespace `/events`, subscribe `{type:"subscribe", sessionId, events}`; live events nested `{type:"event", payload:{event, sessionId, data}}` | Ingress transport |
| `GET /sessions/:id/messages` returns stored rows **newest first**; `after` = stored row uuid of the previous page and walks **older**; unknown uuid = 400 | Catch-up walks backwards to a stop point, then processes ascending (section 5.4) |
| Stored rows carry `waMessageId`, `chatId`, `from`, `body`, `type`, `direction`, `timestamp`, `metadata{media, quotedMessage, ...}`; they lack `fromMe`, `mentionedIds`, `senderPhone`, `kind` | Degraded trigger rules for caught-up rows |
| `message.sent` fires for connector sends and for anything typed on the phone or sent by other gateway clients | Durable outbound registry (section 5.3) |
| Mentions need `mentions:["<n>@c.us"]` plus `@<n>` in text; edit drops mentions unless resent | Send tool builds both from one argument |
| Quote ids are engine-specific; an unresolvable quote fails the send | Typed error `quote_unresolvable` |
| `201` = accepted, not delivered; unregistered numbers also return 201 | `contacts/check` before the first send to a new number; delivery and failure state from `message.ack` (`message.failed` is webhook-only, not on the socket) |
| `@lid` senders in groups; `GET /contacts/:id/phone` resolves; `RESOLVE_LID_TO_PHONE=true` adds `senderPhone` | LID handling (section 6.1) |
| No poll-vote event in the event catalog | WhatsApp approvals use reply-to-bubble |
| Text max 4096 chars, caption 1024, media cap 50 MiB, list `limit` 1-100 | Splitting and paging |

## 4. Scope

In scope: provider `openwa` across db/shared/server/ui/mcp-server behind the existing experimental chat-connectors setting; both number modes; owners, sender policy, chat activation, triggers, absence timers, run profiles, approval categories and grants; proxied tools for the full gateway API plus a bundled skill; steering; publication and WhatsApp formatting; layered instructions; instance-wide optional speech-to-text; audit; performance budget.

Out of scope (v1): webhook ingress; more than one gateway session per endpoint; gateway `/mcp`; making Baileys-only features work on whatsapp-web.js; applying the new policy model to other chat providers (tables are provider-neutral); upgrading the gateway; the declared-but-unimplemented `relay` deployment mode.

## 5. Connection and ingress

### 5.1 Credentials

- `baseUrl`: http(s) origin; loopback allowed (self-hosted).
- `apiKey` (required, write-only, vaulted): operator role, `allowedSessions` = the selected session, no `allowedChats`.
- `adminApiKey` (optional, write-only, vaulted): unscoped admin key; accepted only when `gatewayAdminTools` is not `off`.

Agents never receive either key.

### 5.2 Setup inspection (read-only)

0. The endpoint's agent must use an adapter with signed run-bound JWTs (`supportsLocalAgentJwt`, `server/src/services/heartbeat.ts:24568`); otherwise setup fails with 422. Changing the agent to an adapter without it sets the endpoint to `attention` and stops admission (D35).
1. Gateway version from the public OpenAPI `info.version` when Swagger is enabled; otherwise "unknown, assuming 0.23.7" warning.
2. `POST /api/auth/validate` -> role and engine type.
3. `GET /api/sessions` -> sessions visible to the key. More than one visible session -> warning "key is not session-scoped". Operator selects one.
4. Session must be `ready`; number shown masked (`+62xxx...1234`) with push name.
5. Pacing attestation checkbox ("`SEND_PACING_ENABLED=true` is set on the gateway") is required before activation. Health later shows `attested` or `observed` (after the first `SEND_PACING_LIMITED`).
6. Attestation that this key is the only client sending as this session (owner_number mode relies on it, section 5.3).
7. Activation: an owner sends a test DM; setup completes when the agent's reply is published.

Errors: credentials/scope 422, gateway rate limit 429, gateway unreachable 503 ("do not replace credentials"), malformed upstream 502. A failed reconnect keeps the previous credential binding.

Reservation: `(gateway origin, session id)` and the session's number are reserved instance-wide by any non-archived endpoint (Photon pattern).

### 5.3 Outbound registry and echoes

Every send by the connector (tool, publication or approval request) writes a `chat_outbound_messages` row **before** the HTTP call (state `pending`, chat key, body hash, client nonce) and records the `waMessageId` from the 201 response. An in-memory index of outbound ids for the last 7 days (cap 50k, preloaded at lease start, updated on every send) is authoritative within its window; older quoted ids cost one indexed lookup, for trigger candidates only.

A `message.sent` event is classified as:

- **connector echo** when its id is registered, or when a non-terminal outbound row (`pending` or `uncertain`, no age bound) in the same chat has the same body hash; the match records the `waMessageId` on that row;
- **phone-typed** otherwise (in `owner_number` mode: owner activity; owner command only under section 6.5 rules).

A send whose HTTP call ends without a definite gateway answer (timeout, crash, connection reset) leaves its row `uncertain`. At lease start and before catch-up classification, uncertain rows are reconciled against stored outgoing messages by chat and body hash. Failure state comes from `message.ack` with `status: failed`.

In `owner_number` mode, approval replies and owner commands from the session's own number must be phone-typed. Other gateway clients sending as the session are indistinguishable from the phone (attested in setup, accepted risk).

`reply_to_agent` detection and approval-bubble lookup use the same registry, so they survive restarts and failover.

### 5.4 Ingress pipeline

Runtime: lease-elected stream (Discord/Photon pattern, `chat_endpoint_leases`). One Paperclip process holds the socket per endpoint.

Subscription: `message.received`, `message.sent`, `message.ack`, `message.revoked`, `message.edited`, `message.reaction`, `group.join`, `group.leave`, `group.update`, `session.status`, `session.restriction`.

Connect / reconnect:

1. Subscribe and buffer live events (bounded 10k; overflow drops the buffer and relies on step 2).
2. Catch-up: read cursor `{waMessageId, timestamp}` from `chat_sdk_state` key `openwa.ingest_cursor`. Page `GET /sessions/:id/messages?limit=100&inlineMedia=false` newest first, `after=<last row uuid>`, stop at the cursor `waMessageId`, at `timestamp < cursor.timestamp - 120 s`, at 2000 rows or 24 h age. Process collected rows oldest first with `source: catch_up`.
3. Drain the live buffer, then live mode. Dedupe key for every admitted message: `openwa:<sessionId>:<waMessageId>` on the delivery ledger unique index; stored rows without `waMessageId` use `openwa:<sessionId>:row:<uuid>`.
4. Cursor advanced to the newest processed message, written at most every 2 s or 200 events.

Caught-up rows use degraded rules: `direction = outgoing` means `fromMe`; group vs DM from the chat id suffix; mentions from `@<digits>` tokens in the body against agent/owner numbers (LID-only mentions undetectable); quotes from `metadata.quotedMessage`; sender from `from`. Missed `ack`, `revoked`, `edited`, `reaction` and `group.*` events are not recovered; group participants are re-read for active groups on reconnect.

Per-event classification (in memory, no DB access unless the event is a trigger or a group needs first-time discovery):

1. Connector echo -> ignore.
2. Approval reply (section 6.9): a message from a current owner (in `owner_number` mode: phone-typed or from another owner) quoting a recorded approval bubble -> admit as `approval_reply`, regardless of chat activation and trigger rules (D37).
3. Owner activity (section 6.6): cancel the chat's pending absence timer; if an `owner_absent` run for that chat is active, admit the message as an owner message to steer with `owner_now_active`.
4. Chat activation (section 6.4). Unknown group -> discovery off the hot path (one `GET /groups/:id`, then resource row); the triggering message waits for it only when it is a trigger candidate (bound 2 s).
5. Trigger rules (section 6.5). Not a trigger -> discard. Nothing is written to Paperclip; the message stays in the gateway database and remains readable through tools.
6. Sender gate (section 6.2) for triggers.
7. Admit: one transaction writes the delivery row (with trigger class and principal role), the comment on the conversation issue, and the wake request (section 7.2).

The in-memory policy snapshot (owners with numbers and LIDs, sender lists, active chats with overrides, agent JID/LID, trigger rules) is rebuilt when `policy_revision` changes.

The chat SDK concurrency strategy does not order OpenWA traffic: `openwa` endpoints are fixed to `concurrency_policy = concurrent` so every message reaches classification, and the single socket consumer serializes classification and admission per chat in socket order. Ordering of agent work is defined in section 7.2.

### 5.5 Session health

`session.status` other than `ready`, or `session.restriction.active`, sets endpoint health `attention` and writes an audit entry. The agent learns it through a `session_health` wake and decides whether to inform owners.

## 6. Gates

### 6.1 Owners and identity

- An owner is a WhatsApp number in `chat_endpoint_owners` whose identity link (`chat_identity_links`) is `linked` and whose Paperclip membership is active and not `viewer`. Owner status is re-derived per turn; there is no cached authority.
- Losing owner status revokes the live grants that owner approved; pending approval requests stay open for other owners.
- Owner LIDs are learned from messages that carry both a `@lid` sender and `senderPhone`, and stored on the owner's external principal (`alternate_external_ids`). Mention and sender matching use number and LID forms. An unknown LID is never treated as an owner.

### 6.2 Sender policy

`senderPolicy.mode`: `all` | `allowlist` (default) | `denylist`. Entries: E.164 with optional label. Owners are always allowed; denylist entries are dropped everywhere.

| Sender | DM | Active group |
| --- | --- | --- |
| Owner | trigger, class `owner` | trigger, class `owner` |
| Allowed | trigger, class `other` | trigger, class `other` |
| Outside allowlist | dropped, audited | trigger, class `other`, role `outside_allowlist`: replying in the origin chat needs a grant for `reply_outside_allowlist` unless the trigger mentioned or replied to the agent in an active group |
| Denylisted | dropped, audited | dropped, audited |
| Unresolvable `@lid` | outside allowlist | outside allowlist |

OpenWA admission does not use the generic guest ladder: no sponsor-guest admission and no sticky `low_trust_review` conversion of the conversation issue (`server/src/services/chat-channels.ts:16080-16125`). Trust is decided per run by the profile (section 6.7).

### 6.3 Reply policy

`replyPolicy` for runs whose class is `other`: `allowed` (default) | `ask_owner` | `owner_absent_only`. Endpoint default, per-chat override. Enforced on origin-chat sends and on publication.

### 6.4 Chat activation

Per chat `activation`: `auto` (default) | `on` | `off`.

- `agent_number`: DMs `auto` = active. Groups `auto` = active while at least one owner is a participant; re-evaluated on `group.join` / `group.leave` and on reconnect. When the number is added to a group whose `auto` evaluates inactive, the agent is woken with `group_added` (actor, group name, participant count).
- `owner_number`: `auto` = inactive for every chat except the self-chat, which is active for phone-typed owner commands; only `on` chats are visible to other triggers. Approval replies are detected in every chat (D37). Settings can create a chat row for any chat listed by the gateway.
- Joining a group via invite link is a `wa_admin` operation.
- Publication to a group the number has left is blocked.

### 6.5 Trigger rules

Endpoint defaults, per-chat override wins.

| Rule | Definition | `agent_number` default | `owner_number` default |
| --- | --- | --- | --- |
| `direct_message` | Any message in an active DM | on | off |
| `agent_mentioned` | `mentionedIds` contains the agent JID/LID, or body contains `@<agentNumber>` | on | n/a |
| `reply_to_agent` | Quoted id is in the outbound registry | on | on |
| `command_prefix` | Body starts with the prefix (default `/ai`, case-insensitive) | off | on, phone-typed only |
| `self_chat` | Phone-typed message in the self-chat | n/a | on |
| `owner_mentioned_absent` | Arms the absence timer (section 6.6) | on in groups | on in groups; per-chat opt-in for DMs |
| `keywords` | Whole-word, case-insensitive match | empty | empty |
| `all_messages` | Any message in an active chat | off | off |

A message matching an immediate rule and `owner_mentioned_absent` wakes immediately and arms no timer.

### 6.6 Absence timer

- **Arm**: a non-owner message M in an active chat that mentions an owner or quotes an owner's message (groups) or arrives in a DM with the rule on (`owner_number`). With no pending timer for the chat: insert one with `fireAt = M.timestamp + absenceSeconds` (default 120, endpoint and per chat). With a pending timer: attach M; `fireAt` never moves.
- **Owner activity** in that chat before `fireAt` cancels it: an owner-authored text, media, sticker, location, contact or poll message (`owner_number`: phone-typed). Reactions, edits, revokes, read receipts, presence and activity in other chats do not count.
- **Fire**: wake `owner_absent` (class `other`) with every attached message. That run raises a one-action `reply` approval whose proposed action is the suggested reply and whose owner message summarises the mentions and offers the choice (post the suggestion, post the owner's wording, or the owner answers themselves by rejecting), then posts a short holding reply in the origin chat that mentions the owner. On approval the agent posts the agreed text to the origin chat.
- **Late owner**: owner activity after `fireAt` while that run is active is steered into it as an owner message marked `owner_now_active`.
- Durable rows; the lease holder keeps a min-heap of deadlines and sleeps until the earliest (no polling). Restart rebuilds the heap.

### 6.7 Run profiles

Every OpenWA-triggered run records in its immutable context: `triggerClass`, `profile`, `grantIds`, requester principal, origin chat. Gates read it; a later grant revocation narrows it, nothing widens it.

Profile resolution is fail-closed for every run on an OpenWA conversation issue: a run is `full` only when its context says `owner` or its wake was requested by a human board user; a `grant` run gets its granted categories; every other run on that issue (agent mention, interaction continuation, recovery, retry) is `read_only`. Child issues created by an `owner` or `grant` run are owner-sanctioned work: their runs follow normal Paperclip authority and record the approval request id. Comments written by a `read_only` run never trigger mention wakes (delegation is `create_task`).

| Trigger class | Source | Profile |
| --- | --- | --- |
| `owner` | Owner triggers, `approval_reply` | `full` |
| `other` | Allowed and outside-allowlist senders, `owner_absent`, `group_added`, `session_health`, `approval_pending`, rejected `approval_resolved` | `read_only` |
| `grant` | Approved `approval_resolved` for one request | `read_only` plus the granted categories |

`read_only` may:

- use every read capability: runtime read/search/LSP/web tools and `bash` (instruction-bound, D32); Paperclip reads (issues, documents, comments, projects, runs); connector tools with risk `read`; every OpenWA read operation over all chats visible to the endpoint (D33; `owner_number`: enabled chats only);
- comment on and attach artifacts to its own conversation issue;
- send to its origin chat, subject to the reply policy and `outside_allowlist` rule;
- call `openwa_request_approval` (the only path to owner chats).

`read_only` may not, unless the category's approval is turned off or a live grant covers it: `create_task`, `external_tools`, `cross_chat_send`, `wa_admin`, `gateway_admin`. Endpoint configuration changes are owner-only in every profile.

A category whose `requireOwnerApproval` is off is allowed in `read_only`. With `external_tools` off, `other` runs are effectively `full`.

The issue work mode stays `standard`; the OpenWA guidance states the run's profile. Enforcement never depends on the prompt (section 13).

### 6.8 Approval categories and grants

| Category | Covers |
| --- | --- |
| `create_task` | Creating, assigning, reassigning or delegating Paperclip issues; project creation |
| `external_tools` | Connector tools with risk `write`/`destructive`; runtime write tools; email/agentmail sends; any Paperclip mutation outside the read-only allowlist |
| `cross_chat_send` | Sending or forwarding to a chat other than the origin chat (owner approval chats excepted via `openwa_request_approval`) |
| `wa_admin` | Join/leave group, participants, group settings, edit/delete/pin/star messages, block/unblock, labels write, status posts, chat archive/mute/delete |
| `gateway_admin` | Session lifecycle, API keys, webhooks, plugins, settings, infrastructure |

Conditional permissions: `reply_outside_allowlist` (section 6.2) and `reply` when `replyPolicy` = `ask_owner` or `owner_absent_only` blocks the turn.

Grant: `{requestId, category, originChat, requesterPrincipal, scope: one_action | requester, status, approvedByUserId, approvedVia: whatsapp | paperclip, expiresAt}` (D36).

- `one_action`: usable only by the `grant` run created from that request (its context lists the grant id) and that run's steered turns; consumed atomically by the first authorized dispatch of a gated call in that category (row lock). A `one_action` `external_tools` grant is consumed at run start and covers that single grant run, because runtime tool profiles are fixed at adapter launch and individual runtime dispatches cannot be metered.
- `requester`: usable by runs triggered by the same requester in the same origin chat until `expiresAt` (default 24 h). Live grants are resolved once at run start into the run context; runs started earlier never pick them up.
- Grants survive conversation rotation. They are keyed by request, chat and requester, never by issue; another member's run never uses them.

A gated call without a live grant returns `{error: "approval_required", category, hint}`.

### 6.9 Approval flow

1. `openwa_request_approval({categories, scope, summary, proposedAction, messageToOwners})` from a run of class `other` or `grant`.
2. Server commits, in one transaction: the request row; a `request_confirmation` interaction on the origin conversation issue with resolver policy `chat_endpoint_owner`, `continuationPolicy: "none"` and `payload.openwaApprovalRequestId` (excluded from chat interaction publication and from run-owned interaction suppression, `chat-run-publications.ts:489-497`); one `pending` outbound row per owner approval chat (`agent_number`: DM agent<->owner; `owner_number`: self-chat plus other owners' DMs). It then sends the agent-written `messageToOwners` and records each bubble id from the 201 or from reconciliation (section 5.3). Returns `requestId`.
3. **WhatsApp resolution**: a phone-typed or owner-sent message from a current owner whose quoted id is a recorded bubble of a pending request -> dedicated wake `approval_reply` (class `owner`, never steered or coalesced with other triggers) on the owner's approval chat conversation. The agent interprets the free text and calls `openwa_approval_resolve({requestId, decision: approve | reject | clarify, conditions})`. Accepted only when the run's initial trigger is that `approval_reply` for that request, the owner is still an owner, and the request is pending (`SELECT ... FOR UPDATE`). `clarify` keeps it pending.
4. **Paperclip resolution**: the generic interaction resolve routes enforce `chat_endpoint_owner`: only human board users linked as current owners of the endpoint; agents never. Same canonical resolve, same row lock.
5. First resolution wins; the loser gets `already_resolved`. The owner's verbatim text and the agent's `conditions` are stored on the request and grant.
6. Approved -> wake `approval_resolved` (class `grant`) on the origin chat's current conversation. Rejected -> wake `approval_resolved` (class `other`). The agent informs the requester (its decision).
7. Reminders: scheduled wakes `approval_pending` (class `other`) at `reminderMinutes` x k (default 30, k <= `maxReminders` default 3). The agent may call `openwa_request_approval({remindRequestId, messageToOwners})`. After the last reminder the request stays pending until resolved or cancelled in Paperclip.
8. A message quoting a bubble of an already-resolved request wakes `approval_reply` with `requestStatus: resolved`; no second grant.

### 6.10 Configuration from WhatsApp

`openwa_endpoint_config` (owner-class runs only, else `owner_only`) changes: sender lists, chat activation, per-chat triggers / absence / reply policy / note, approval toggles, reminders, custom instructions. Every change bumps `policy_revision` and is audited with before/after. Credentials, number mode, owners and gateway admin level are Paperclip-UI only.

## 7. Conversations, runs and publication

### 7.1 Conversation issues

One conversation issue per chat, assigned to the endpoint's agent, origin `chat_channel`, `originId = chat:<endpointId>:<chatKey>:<generation>`. A trigger after more than `rotateAfterIdleHours` (default 24) of chat inactivity, or `/new`, starts a new generation and issue linked to the previous one. Pending approval requests and live grants are keyed by request and chat and survive rotation; `approval_resolved` targets the chat's current conversation. Real work is created by the agent as child issues of the conversation issue. `/status` and `/close` follow existing linear-surface semantics; control commands are accepted from owners and allowed DM senders.

### 7.2 Wake classes and ordering

Pending triggers of different classes never share a wake. Per conversation issue, wakes run one at a time in FIFO order of their first trigger. The class is stored in the wake request payload (`payload.openwa.triggerClass`). Coalescing happens in `admitWakeBehindIssueExecution` (`server/src/modules/wake-queue/application/use-cases.ts:781`), both when merging into the active run's context and when merging into the oldest deferred wake (`findExistingDeferredWake`, `server/src/modules/wake-queue/adapters/postgres.ts:878-905`); both paths gain a same-class predicate for OpenWA wakes. `approval_reply` and `grant` wakes are never coalesced.

Burst control (live stress test: 17 messages from 4 senders in 3 minutes produced one wake per trigger). Spam guard at admission, per endpoint, chat and sender, in memory and bounded: a non-owner plain-text message equal (normalized) to the sender's previous admitted trigger within 60 s is not admitted (`trigger_filtered` reason `duplicate`; the earlier delivery's `normalizedEvent.openwa.repeatCount` is incremented and shown in the wake); more than 5 admitted triggers per sender per rolling 60 s in one chat are `trigger_filtered` reason `rate_limited`. Group debounce at wake dispatch: when a group member (`other`) `message` wake is accepted and the conversation issue has no queued or running run, the wake is held for 5 s (`chat_actions.result.code = openwa_burst_held`, `retryAt`); further member wakes in that window fold their delivery ids into the held wake and settle as `openwa_burst_folded` (activity `openwa.burst_folded`). A clock timer releases the hold; the durable sweep dispatches it after `retryAt` if the process restarted. Owner triggers, DMs and approval events bypass the hold; with an active run, section 7.3 applies.

### 7.3 In-flight messages

New endpoint column `inflight_mode`: `steer` (default) | `queue`, separate from the chat SDK concurrency strategy.

| New trigger | Active run | Result |
| --- | --- | --- |
| Owner message | any | Steered (profile unchanged). If the agent cannot act on it in the current profile, `openwa_handoff` or an unanswered owner trigger yields a follow-up `owner` run after the current run |
| `other` message | `read_only`, class `other` | Steered |
| `other` message | `full` or `grant` | Queued as the next wake |
| `approval_reply` | any | Own wake, never steered |

Steering uses the queued-comment steering path: the admitted comment is a deferred queued comment of the active run, and a server-side steer call with a system actor delivers it when `decideQueuedCommentQueueSteering` returns `probe` (`server/src/services/issue-queued-comment-queue.ts:141-150`). That needs a native runner or a live adapter steer target (`hasLiveAdapterSteering`; OMP registers one in RPC mode through `registerAdapterSteerTarget`). OpenWA comments are never quarantined; non-owner text is marked as untrusted data in the wake payload and the guidance. Without steering support (adapter or `inflight_mode = queue`) every row above becomes "queued". Settings shows when the agent's adapter cannot steer.

### 7.4 Per-trigger answer state

Each admitted trigger has `answer_state`: `pending` | `answered` | `silenced` | `handed_off`.

- An origin-chat send whose `quoteMessageId` is a trigger marks that trigger `answered`; an origin-chat send without a quote marks every visible `pending` trigger of the run's class `answered`.
- `openwa_stay_silent({triggerIds?})` marks the listed (default all visible pending) triggers `silenced`.
- `openwa_handoff({triggerIds, note})` marks owner triggers `handed_off`, which schedules a follow-up `owner` run carrying the note.
- Owner triggers steered into a `read_only` run are never marked `answered` by publication; if still `pending` when the run ends, a follow-up `owner` run is scheduled.

### 7.5 Automatic publication

At run end the final output is published to the origin chat when at least one visible trigger of the run's class is `pending` and replying is allowed for every pending trigger's sender. Publication quotes the oldest pending trigger in groups and marks the run-class pending triggers `answered`. Otherwise the output stays internal, an audit entry `publication_suppressed` records why, and the next wake carries `lastOutputSuppressed`. Empty output publishes nothing. All text passes `projectSafeChatPublicationText` (credential redaction, `server/src/services/chat-publication-projection.ts:221-243`).

### 7.6 Progress nudges

While a triggered run is active and nothing was sent to the origin chat for `progressNudgeSeconds` (default 60; then every 180 s; at most 5 per run; 0 disables), the server steers an internal reminder into the run. Timers are in memory per active run. Without steering, nudges are unavailable (Settings shows it).

### 7.7 Typing

Typing presence in the origin chat while a triggered run is active; endpoint toggle, default on.

## 8. Agent tools

### 8.1 Exposure

- Native runner tools for native runtimes.
- HTTP route `POST /api/companies/:companyId/openwa/tasks/:issueId/tools` (agent bearer + `X-Paperclip-Run-Id`), same pattern as Slack task tools.
- Paperclip MCP server toolset `openwa` (`packages/mcp-server`, toolset selection at `src/config.ts:66`) for MCP-capable adapters; enabled for runs on OpenWA conversation issues and their child issues.
- Bundled skill `skills/openwa/SKILL.md`: environment, profiles, approval flow, mentions/quotes, formatting, catalog usage, error handling.

Company, endpoint, session, issue, run, trigger class and profile come from run context; tool arguments never carry them.

### 8.2 Tools

Schema budget about 3k tokens: frequent operations are first-class; the rest of the gateway goes through catalog/describe/call.

| Tool | Purpose |
| --- | --- |
| `openwa_send` | Text, image, video, document, audio, voice note (`ptt`), sticker, location, contact card, poll to a chat id or E.164 number; `mentions` (numbers) builds both the array and `@n` tokens; `quoteMessageId`; markdown converted to WhatsApp formatting |
| `openwa_read_chat` | Paged chat history: stored source (cursor) or live source (`deep`, up to 2000 metadata-only); text, sender, quote, mentions, media refs, location, contact |
| `openwa_get_media` | Media of one message into a Paperclip attachment (policy limits); attachment id, mime, size, transcript when STT is configured |
| `openwa_find` | Contacts and chats by name or number, number existence check, LID to phone |
| `openwa_request_approval` | Section 6.9 (create, remind) |
| `openwa_approval_resolve` | Section 6.9 |
| `openwa_stay_silent` | Section 7.4 |
| `openwa_handoff` | Section 7.4 |
| `openwa_endpoint_config` | Section 6.10 |
| `openwa_catalog({category?, query?})` | Operation ids, summaries, category, availability on the active engine and key |
| `openwa_describe({operation})` | Argument schema of one operation |
| `openwa_call({operation, args})` | Executes one manifest operation through the same gates and audit |

### 8.3 Operation manifest

`packages/shared/src/openwa-operations.ts`, generated from the pinned OpenAPI document by a script and reviewed: operation id, method, path template, zod argument schema, `category` (`read`, `write`, `wa_admin`, `gateway_admin`), `requiredKey` (`operator` | `admin_unscoped`), `sessionScoped`, `crossChat`, engine availability. Path parameter `sessionId` is injected server-side for session-scoped operations. No arbitrary path execution. Coverage: all 202 operations (OpenWA 0.23.7).

### 8.4 Gateway admin tools

`gatewayAdminTools`: `off` (default; hidden from catalog) | `read` | `full`. Operations needing `admin_unscoped` are listed as unavailable without `adminApiKey`. Instance-global admin operations affect every session on the gateway and are labelled so in the catalog. Operations that log out, stop or delete the endpoint's own session require an owner-class run plus a Paperclip confirmation. Operations whose response is the only copy of a credential or a device-linking code (`AuthController_create`, `IntegrationInstanceController_create`, `IntegrationInstanceController_regenerate`, `SessionController_requestPairingCode`, `SessionController_getQRCode`) are listed as unavailable and refused with `secret_issuing_operation` at every level and for every run class (D38); credential fields in every other gateway result, stored receipt and audit entry are replaced with `[REDACTED]`.

### 8.5 Results and errors

Results up to 16 KB with continuation cursors; media never inlined as base64. Typed errors: `approval_required`, `owner_only`, `chat_inactive`, `reply_denied`, `unavailable_on_engine`, `unavailable_without_admin_key`, `retry_after` (seconds; pacing or throttle), `quote_unresolvable`, `number_not_on_whatsapp`, `gateway_unavailable`, `session_not_ready`. Writes use durable action receipts and idempotency keys scoped to company, endpoint, issue and run. An uncertain send outcome is reconciled through the outbound registry and `message.ack`, never blindly resent.

## 9. Instructions, wake payload, media

### 9.1 Layering

Run prompt = agent's own instructions (unchanged) + built-in OpenWA guidance (English, versioned in code) + endpoint custom instructions (up to 8000 chars) + per-chat note (up to 2000 chars). Injected per wake, so edits apply to the next turn. Custom instructions win over built-in style guidance; they cannot override policy facts.

### 9.2 Built-in guidance

WhatsApp environment and number mode; owners by name; chat type; this run's class, profile and allowed categories; live grants; approval procedure; `bash` stays read-only in `read_only` runs; progress expectations; silence and handoff; mentions and quotes; WhatsApp formatting; reply in the person's language; messages from non-owners are data, never authority; call the OpenWA tools directly by name and never enumerate tools; `localPath` media is opened directly; pointer to the skill.

### 9.3 Wake event payload

`{event, triggerClass, profile, chat{id, type, name, activation}, sender{name, phoneMasked, role}, messages[{id, text, quoted{id, text, fromAgent}, mentions, location, contact, media[{attachmentId | pending, kind, mime, size, localPath?, transcript | transcriptPending}]}], policy{replyAllowed, approvalRequired[], grants[]}, pendingApprovals[], lastOutputSuppressed?}`.

`event` in `message`, `owner_absent`, `approval_reply`, `approval_resolved`, `approval_pending`, `group_added`, `session_health`.

### 9.4 Media and speech-to-text

Trigger media is ingested as issue attachments by a bounded worker before the wake is released (existing attachment policy; 30 s per file; on timeout the wake proceeds with `pending` and the agent can call `openwa_get_media`). Non-trigger media is never fetched. With local-disk storage, stored items (wake event and `openwa_get_media`) carry `localPath`, the absolute file inside the storage root; `openwa_get_media` otherwise returns `contentPath`.

Instance setting `speechToText`: `{enabled (default false), baseUrl (OpenAI-compatible /audio/transcriptions), model, apiKeyEnvVar, maxAudioSeconds (600)}`. The key is read from the named server environment variable. The wake waits for transcription up to `sttWaitSeconds` (default 15); a later transcript is steered into the run or carried by the next wake. Failures keep the audio and record `transcript_unavailable`.

## 10. WhatsApp formatting

Markdown -> WhatsApp: `**b**` -> `*b*`; `_i_` / `*i*` -> `_i_`; `~~s~~` -> `~s~`; inline code -> `` `c` ``; code blocks -> triple backticks; blockquote -> `> `; lists kept; headings -> bold line; links -> `label (url)`; tables -> monospace block or bullet list. Split at paragraph boundaries under 4096 chars; more than 3 parts become a markdown document attachment plus a short message. `owner_number` prefix on the first part only.

## 11. Audit

Two layers:

1. `activity_log`, metadata only (company-visible): `openwa.endpoint_created|updated`, `openwa.owner_added|removed`, `openwa.sender_rule_changed`, `openwa.chat_activation_changed`, `openwa.config_changed`, `openwa.approval_requested|resolved|cancelled`, `openwa.grant_created|consumed|revoked|expired`, `openwa.gateway_admin_called`. Actor: board user, or `chat:<principalId>` for WhatsApp-originated changes.
2. `chat_audit_entries`, content-bearing, endpoint-restricted: `trigger_admitted`, `trigger_filtered`, `message_sent`, `publication_suppressed`, `tool_called` (redacted args up to 4 KB, result summary up to 1 KB, latency, error code), `approval_*` with owner text, `config_changed` with before/after, `group_added|left`, `session_health`.

Read access (`GET /chat-endpoints/:endpointId/audit`, cursor-paged): endpoint owners and company owners see content; other board users with endpoint access see metadata only. Owner-class runs can read it via `openwa_call` operation `paperclip.audit.list`.

Retention: a daily job nulls `content` where `content_purge_at <= now()` in batches of 1000 (pattern of `server/src/services/decision-retention.ts`). Default 90 days, endpoint setting. The same job marks `live` grants past `expires_at` as `expired` and logs one `openwa.grant_expired` entry per endpoint.

Conversation issues follow normal issue visibility; in `owner_number` mode they contain the owner's chats (Settings warns).

## 12. Data model

All new tables: `company_id` FK to companies (cascade), `endpoint_id`, composite FK `(company_id, endpoint_id)` -> `chat_endpoints(company_id, id)` cascade, `created_at`/`updated_at`.

`chat_endpoints` additions: `policy jsonb not null default '{}'` (validated by `openwaEndpointPolicySchema`), `policy_revision integer not null default 0`, `inflight_mode text not null default 'queue'` check in (`steer`,`queue`) (`openwa` endpoints are created with `steer`). Provider check constraints include `openwa`. Partial unique indexes for `openwa` non-archived endpoints on `provider_account_id` (`<origin>#<sessionId>`) and `bot_external_id` (number).

`openwaEndpointPolicySchema`: `numberMode`, `senderPolicyMode`, `replyPolicy`, `triggers{directMessage, agentMentioned, replyToAgent, commandPrefix{enabled, prefix}, selfChat, ownerMentionedAbsent, keywords[], allMessages}`, `absenceSeconds`, `approvals{createTask, externalTools, crossChatSend, waAdmin, gatewayAdmin, reminderMinutes, maxReminders, grantTtlHours}`, `rotateAfterIdleHours`, `progressNudgeSeconds`, `typingIndicator`, `ownerNumberPrefix{enabled, text}`, `gatewayAdminTools`, `customInstructions`, `auditContentRetentionDays`, attestations `{pacing, soleClient}`.

`chat_endpoint_resources`: `settings jsonb not null default '{}'` (`activation`, trigger overrides, `absenceSeconds`, `replyPolicy`, `note`).

`chat_external_principals`: `alternate_external_ids text[] not null default '{}'`.

`chat_deliveries`: `trigger_class text null`, `principal_role text null`, `answer_state text null` with checks.

Shared: `ISSUE_THREAD_INTERACTION_CANONICAL_RESOLVER_POLICIES` += `chat_endpoint_owner` (`packages/shared/src/constants.ts:299-303`), enforced by the generic resolve routes. Wake requests: `payload.openwa = {triggerClass, deliveryIds}`.

| New table | Columns | Keys / indexes |
| --- | --- | --- |
| `chat_endpoint_owners` | `identity_link_id` -> `chat_identity_links`, `added_by_user_id` | unique `(endpoint_id, identity_link_id)` |
| `chat_sender_rules` | `list` (`allow`|`deny`), `e164`, `label`, `created_by_user_id`, `created_by_principal_id` | unique `(endpoint_id, list, e164)` |
| `chat_scheduled_wakes` | `chat_key`, `kind` (`owner_absent`|`approval_reminder`), `fire_at`, `state` (`pending`|`fired`|`cancelled`), `related_id`, `payload jsonb` | partial index `fire_at` where pending; unique pending `owner_absent` per `(endpoint_id, chat_key)` |
| `chat_owner_approval_requests` | `origin_chat_key`, `origin_conversation_id`, `interaction_id`, `requested_by_principal_id`, `requested_in_run_id`, `categories text[]`, `scope`, `summary`, `proposed_action`, `status` (`pending`|`approved`|`rejected`|`cancelled`), `reminder_count`, `resolved_via`, `resolved_by_user_id`, `owner_text`, `agent_conditions`, `resolved_at` | index `(endpoint_id, status)` |
| `chat_outbound_messages` | `chat_key`, `source` (`tool`|`publication`|`approval`), `run_id`, `provider_message_id` null, `state` (`pending`|`sent`|`uncertain`|`failed`), `body_hash`, `client_nonce`, `sent_at` | unique `(endpoint_id, provider_message_id)` where not null; index `(endpoint_id, chat_key, state)`; index `(endpoint_id, sent_at)` |
| `chat_owner_approval_bubbles` | `request_id`, `owner_id` -> `chat_endpoint_owners`, `outbound_message_id` -> `chat_outbound_messages` | unique `(endpoint_id, outbound_message_id)` |
| `chat_owner_grants` | `request_id`, `origin_chat_key`, `requester_principal_id`, `category`, `scope` (`one_action`|`requester`), `status` (`live`|`consumed`|`revoked`|`expired`), `approved_by_user_id`, `approved_via`, `expires_at`, `consumed_at`, `consumed_by_run_id` | index `(endpoint_id, origin_chat_key, requester_principal_id, status)` |
| `chat_audit_entries` | `conversation_id`, `chat_key`, `kind`, `actor_kind`, `actor_ref`, `run_id`, `metadata jsonb`, `content jsonb null`, `content_purge_at`, `occurred_at` | index `(endpoint_id, occurred_at desc)`; partial index `content_purge_at` where content is not null |

Ingest cursor: `chat_sdk_state` key `openwa.ingest_cursor`. Instance settings: `speechToText` block. Contracts synced across db, shared types/validators, server routes and OpenAPI, generated `api-tools.json`, UI clients.

## 13. Enforcement seams

Closed list. Each mutating seam calls `assertOpenwaRunMay(run, category)`. The profile comes from the run context; a run on an OpenWA conversation issue without OpenWA context resolves fail-closed (section 6.7); runs on other issues are unaffected. Reads perform no grant query; each mutating check reads the run's grant ids from context and performs at most one indexed lookup.

| Family | Seam | `read_only` behaviour | Lifted by |
| --- | --- | --- | --- |
| Paperclip REST mutations by run JWT | `server/src/middleware/auth.ts` after signed run resolution (`:376-404`) | Deny non-safe methods except the read-only allowlist: own-issue comments (mention wakes suppressed), own-issue artifacts/work products, run lifecycle, OpenWA tools route | per category; unlisted routes need `external_tools` |
| Persistent agent keys of an OpenWA-bound agent | `server/src/middleware/auth.ts` agent-key path (`:493`) | Deny every non-safe method (D35) | never |
| GitHub credential export and `connection_request` runtime tools | `server/src/routes/connection-intents.ts:47-58`, mounted before the actor middleware (`server/src/app.ts:569-575`); checked by the `run_id` claim | Deny | `external_tools` |
| Issue create / assign / delegate, project create | `paperclip-runner-tool-authority.ts` (`:1004-1057`), issue routes, `project-tool-context.ts:24` | Deny | `create_task` |
| Native runner tools | `PaperclipRunnerToolAuthority` | Same predicate | per category |
| Connector tools | `tool-gateway.ts` policy decision (`:10255`) | Deny risk `write`/`destructive` | `external_tools` |
| Email / agentmail sends | `email-channels.ts:575`, `connectors/agentmail.ts:163` | Deny | `external_tools` |
| Runtime tools | Adapter capability `readOnlyToolProfile` applied at run start | OMP: tool-guard extension denies write tools, `bash` passes (`packages/adapters/omp-local/src/server/tool-guard.ts`); Codex: `--sandbox read-only` (also confines `bash`); Claude: write tools disallowed, `bash` kept; others: instruction only, Settings warning | `external_tools` (`full` toolset) |
| OpenWA tools | OpenWA tool authority | Per category, reply policy, origin chat | per category |

## 14. UI

Apps -> OpenWA card and agent Channels panel through the shared chat setup controller (`doc/connections/CHAT-CONNECTOR-UX.md`): connect (URL + key) -> inspect -> select session -> number mode -> owners (link each number) -> attestations -> owner test message. Settings: owners, sender lists, chats (activation, per-chat triggers / absence / reply policy / note; chat picker from gateway), approval categories, reminders, grant TTL, rotation, in-flight mode, progress nudge, typing, owner-number prefix, gateway admin level and admin key, custom instructions, audit retention, and capability warnings (steering, runtime read-only profile). Health: gateway version, engine, session, pacing (`attested` / `observed`), restriction. Pending approvals list with resolve actions for owners. Audit tab with filters (kind, chat, actor). Token-only styling (`pnpm check:token-gates`); icon per `doc/connections/CONNECTOR-ICONS.md`.

## 15. Performance

Harness `scripts/bench/openwa-ingest.mjs` with a fake Socket.IO + REST gateway whose latency is configurable (default 20 ms per REST call), sequence-numbered events, a DB query counter, and the Telegram admission path measured on the same harness as baseline.

| Seam | Interval | Budget |
| --- | --- | --- |
| S0 non-trigger | socket event without trigger features -> discard | p99 < 1 ms, 0 DB queries |
| S0b candidate check | quoted id outside the 7-day index, or pending-timer cancel | p95 <= 10 ms, at most 1 query |
| S1 admission | socket event -> admission transaction committed (LID cache hit, no media) | p95 <= 50 ms and <= 1.2x Telegram baseline |
| S2 dispatch | admission committed -> run start requested (burst window excluded) | p95 <= 200 ms |
| S3 tool overhead | tool call wall time minus fake gateway latency | p95 <= 30 ms |
| S4 media | 1 MiB trigger image ingested, gateway transfer excluded | p95 <= 300 ms |
| S5 LID miss | resolution | <= 2 s timeout; hit ratio reported |
| Burst | 50 msg/s for 60 s, 10% triggers | no loss or duplicate (sequence check); wakes <= distinct (conversation, class) per burst window; RSS growth < 50 MB |
| Reconnect | socket killed at 30 s for 10 s during burst | every trigger admitted exactly once |
| Context | tool schemas; results | <= ~3k tokens (tokenizer script); <= 16 KB |

Negative control: injecting one DB query into the S0 path must fail the benchmark.

A run with `--skip` or any `not available` row exits 3 and reports `partial: true`; only a full run counts as AC17 evidence.

Techniques: policy snapshot keyed by revision; keep-alive HTTP pool; credentials decrypted once per lease; throttled cursor writes; deadline-driven timer heap; LRU caches with caps (outbound ids 50k, LID 10k, discovered groups 5k); streamed media; static capability matrix.

## 16. Gateway prerequisites (operator, separate approval)

In `~/Projects/openwa-docker/.env`: `SEND_PACING_ENABLED=true`, `RESOLVE_LID_TO_PHONE=true`. A dedicated operator key with `allowedSessions` = the session and no `allowedChats`; optionally an unscoped admin key for gateway admin tools. Executed only after explicit approval; this spec does not change the gateway.

## 17. Commands

```sh
bash /tmp/pb/go.sh db:generate
bash /tmp/pb/go.sh -r typecheck
bash /tmp/pb/go.sh build
bash /tmp/pb/go.sh check:token-gates
bash /tmp/pb/go.sh --filter @tickernelz/paperclip-pro-db run check:migrations
bash /tmp/pb/go.sh vitest run server/src/__tests__/openwa <test paths owning touched modules>
bash /tmp/pb/go.sh vitest run --exclude '**/vitest-chat-shards.test.ts' --exclude '**/dist/**'
node scripts/bench/openwa-ingest.mjs
```

`scripts/bench/` and `server/src/__tests__/openwa/` are created by this work. Never run the `cli` install/uninstall tests on this workstation: they act on the real `paperclip-pro.service`. `/tmp/pb/go.sh` is the PATH shim defined by the `run-paperclip-pro-gates-safely` skill (Node 24 through fnm, corepack pnpm, cargo on `PATH`). Never run `pnpm test:run`: its chat-shards preflight runs `pnpm install` and destroys `node_modules`. The broad run (second to last line) takes over an hour; it runs once at the final checkpoint against a `main` baseline, and every suite not run is reported.

## 18. Testing strategy

- Unit: classifier (sender matrix, triggers, echo registry, LID), timer heap, profile and grant evaluation, formatter and splitter, manifest validation.
- Integration on embedded Postgres: admission, catch-up dedupe and ordering, approval provenance and races, category seams, wake classes and steering rules, publication dedupe, rotation with pending approvals, audit access and retention.
- Fake gateway fixture (Socket.IO + REST) for deterministic end-to-end flows and the benchmark.
- Every security gate has a negative-control test shown to fail with the gate removed.
- Live qualification against the real gateway and number, recorded in `doc/connections/OPENWA-VERIFICATION.md`.

## 19. Acceptance criteria

1. **Setup**: an agent whose adapter lacks run-JWT support -> 422. Valid key and session -> inspection shows version (or pinned assumption), engine, ready session, masked number; a key seeing several sessions warns; an `allowedChats` key is rejected; activation requires attestations and an owner test DM answered by the agent. Wrong key -> 422; gateway down -> 503 with "do not replace credentials".
2. **Owner full run**: owner asks to fix something; the run has the full toolset and edits code; a follow-up owner message mid-run is steered (OMP RPC agent); with a non-steering adapter it is handled next turn.
3. **Sender policy**: unlisted DM -> no wake, `trigger_filtered`; denylisted -> ignored in DMs and groups; outside-allowlist group mention -> wake with role `outside_allowlist` and the agent may answer it in the active group; an unaddressed outside-allowlist group trigger -> `reply_denied` until an owner grants it.
4. **Groups**: added to a group with an owner -> active; without an owner -> inactive and a `group_added` wake; invite-link join from an `other` run -> `approval_required(wa_admin)`.
5. **Read-only knowledge**: a member asks why error X happens; the `read_only` run reads code, logs and issues and answers; a runtime write tool is unavailable (OMP/Codex/Claude); creating an issue -> `approval_required(create_task)`; a connector write -> `approval_required(external_tools)`; a non-allowlisted REST mutation -> 403.
6. **WhatsApp approval**: agent-written request reaches owner DMs; owner replies "boleh, tapi jangan sebut harga" quoting it -> `approval_reply` run -> resolve -> grant -> `grant` run creates the child issue -> requester informed. Negative controls: a member quoting the bubble; an owner reply without quote; `openwa_approval_resolve` from an `other` or `grant` run; quoting another request's bubble resolves only that request; replay during catch-up of an already-resolved reply -> no second grant; member B's run cannot use the grant approved for member A.
7. **Paperclip approval**: owner resolves in UI -> same grant; simultaneous WhatsApp and UI resolution -> exactly one wins; non-owner board user -> 403.
8. **Owner absent**: member mentions the owner, owner silent 120 s -> `owner_absent` wake, agent asks the owner through a `reply` approval with a suggested reply and posts a holding reply in the group; on approval it posts the reply. Owner message at 60 s -> cancelled, no wake. Owner reaction only -> not cancelled. Message mentioning owner and agent -> immediate wake, no timer.
9. **Mixed principals**: member trigger during an owner run -> queued; owner message during a member `read_only` run -> steered, profile stays `read_only`, a request needing writes produces a follow-up owner run. Negative control: removing the class rule must fail the test.
10. **Publication**: final output published once; a tool reply quoting the trigger -> no duplicate; `openwa_stay_silent` -> nothing; `ask_owner` policy -> suppressed and audited.
11. **Formatting and media**: mentions render as tags; replies show the quote bubble; image, document, location, contact card and voice note readable; transcript present when STT is configured; wake delay bounded by `sttWaitSeconds`.
12. **Tools**: catalog lists 202 operations (OpenWA 0.23.7) with category and availability; gateway admin hidden at `off`; at `full` with admin key an owner run can list sessions; an `other` run -> `approval_required(gateway_admin)`; a Baileys-only operation -> `unavailable_on_engine` without retry; pacing 429 -> `retry_after` honoured.
13. **WhatsApp config**: owner adds a number to the denylist by chat -> effective on the next event, audited; a member's attempt -> `owner_only`.
14. **Audit**: every section 11 entry present; owners see content; a plain board user sees metadata only; content purged after retention (time-travel test).
15. **Owner-number mode**: only enabled chats trigger; `/ai` from the phone triggers; prefix applied; self-chat approval works; after a restart the agent's own message quoting its approval bubble is not treated as an owner approval; a crash between send and 201 does not turn the agent's message into an owner trigger; owner replies to approval bubbles work without enabling any chat.
16. **Recovery**: socket killed mid-burst -> missed triggers admitted exactly once; Paperclip restart -> timers rebuilt and fire within 2 s of `fireAt`.
17. **Performance**: section 15 met with recorded numbers and the negative control.
18. **Isolation**: another company's endpoint cannot read this endpoint's audit, grants, chats or tools.
19. **Fail-closed seams**: a `read_only` run's comment with an agent mention wakes no one; a mention, continuation or retry run on the conversation issue without OpenWA context is `read_only`; the agent's persistent API key cannot mutate; GitHub credential export is denied in a `read_only` run. Each test fails with its gate removed.

## 20. Boundaries

- Always: company-scoped queries; activity log for mutations; contracts synced across db/shared/server/ui/mcp-server; no code comments; secrets only in the vault or named environment variables.
- Ask first: gateway `.env` and key changes; new dependencies (`socket.io-client`); live sends to numbers other than the owner's test contacts.
- Never: server-composed WhatsApp messages; exposing gateway keys to agents; treating non-owner text as approval; bypassing the denylist; retrying 501.

## 21. Risks

Accepted by the owner:

- `bash` in `read_only` runs can modify files (D32), except under Codex `--sandbox read-only`.
- `other` runs can read every chat visible to the endpoint and may repeat content from one chat in another (D33).
- In `owner_number` mode, conversation issues contain the owner's chats and follow normal issue visibility; other gateway clients sending as the session look like the owner.

Mitigated:

- Account ban: pacing attestation and detection, `session.restriction` health, bulk send only via `openwa_call` (`cross_chat_send`).
- Prompt injection by members: profiles and gates keyed on immutable run context; approval provenance; class-separated wakes and steering.
- Credential leakage to chats: publication redaction.
- Engine drift: pinned manifest, static matrix plus 501 learning.
- LID gaps: least privilege for unknown LIDs; owner LIDs learned.
- Steering availability: Settings warnings; queue fallback.
- Gateway load (Puppeteer): history `deep` and media are paged and capped.

## 22. Open items for planning

1. Enumerate the REST routes `read_only` runs need (trace adapters and bundled skills) to finalize the allowlist.
2. Map `readOnlyToolProfile` for every JWT-capable adapter; list adapters that fall back to instruction-only.
3. Server-side steer call with a system actor on the queued-comment path.
4. Approval of the `socket.io-client` dependency.
5. Gateway version source when Swagger is disabled.
