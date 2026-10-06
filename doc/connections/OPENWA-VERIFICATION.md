# OpenWA verification — 2026-10-04

Branch: `feat/openwa-connector` (PR #109). Base inspected for this skeleton:
`c860a2ea9`. Gateway: rmyndharis/OpenWA `0.23.7`, engine `whatsapp-web.js`.

**Status: experimental. Fixture evidence is recorded below. Live results come
from the journeys and from production traffic on 2026-10-04..06; a "Live result"
cell reads `pending live window` only where no live evidence exists yet.**

This record separates deterministic fixture evidence from live proof. Fixtures
use the fake Socket.IO + REST gateway (`server/src/__tests__/openwa/fake-gateway.ts`) and the repository's
embedded PostgreSQL helpers. They do not substitute for the real gateway, the
real WhatsApp number, or a real agent run.

## Environment

- Live gateway: local OpenWA `0.23.7` at `http://localhost:2785`, one dedicated
  operator key scoped to one session, no `allowedChats`. Keys, phone numbers and
  session identifiers are not recorded here; numbers appear masked
  (`+62xxx...1234`).
- Gateway prerequisites (spec §16): `SEND_PACING_ENABLED=true`,
  `RESOLVE_LID_TO_PHONE=true`, set during gateway preparation; send pacing
  attested at setup.
- Paperclip production instance on 2026.1004.1; agent adapter `omp_local`;
  number mode `agent_number` (agent number +62xxx...7040); one owner
  (+62xxx...7561). No other test contacts.

## Acceptance criteria

Fixture evidence is `file:line "test name"`. Paths under `server/src/__tests__/openwa/` are written as
`openwa/...`. Line numbers are from `f44fce533`; the commit that records them changes no test file.

| AC | Criterion | Fixture evidence | Live result |
| --- | --- | --- | --- |
| AC1 | Setup: run-JWT adapter gate, inspection, multi-session warning, `allowedChats` rejection, attestations, owner test DM, 422 wrong key, 503 gateway down | `openwa/setup.integration.test.ts:301` "rejects an agent whose adapter cannot sign run tokens"; `:254` "inspects a valid gateway read-only and returns no secrets"; `:275` "validates an optional admin key and warns about an unknown gateway version"; `:285` "warns when the key sees more than one session"; `:294` "rejects a key restricted to selected chats"; `:354` "requires both attestations before configuring"; `:364` "configures with vaulted keys, the session identity, and attestations, then waits in the test step"; `:312` "rejects a wrong or viewer key with 422"; `:323` "returns 503 telling the user not to replace credentials when the gateway is down"; `:444` "refuses a second endpoint on the same gateway session or number with 409"; `:458` "puts the endpoint in attention when its agent switches to an adapter without run tokens"; UI `ui/src/pages/apps/chat/OpenwaConnectStep.test.tsx:78` "inspects the gateway, shows the session, and requires both attestations before connecting". Owner test DM to setup completion: `openwa/activation.integration.test.ts:210` "AC1: configure, attest, owner test DM answered by the agent, then verifying becomes active; a non-owner DM never wakes or activates". | Pass on 2026.1004.1 (2026-10-04): owner test DM admitted as owner/full at 03:21:49Z, agent replied with `openwa_send` at 03:22:09Z, endpoint active at 04:17:01Z after the tool-reply setup fix (`bddbd74fe`). See [Live qualification](#live-qualification). |
| AC2 | Owner full run; follow-up owner message steered mid-run, or handled next turn without steering | `openwa/authority-admission.integration.test.ts:199` "resolves owner DMs to full and allowlisted member DMs to read_only from server records"; `server/src/__tests__/openwa-authority.test.ts:401` "derives owner only from admitted owner deliveries whose principal is still an owner"; `:611` "allows full runs and denies read_only runs with a typed category"; `openwa/round-trip.integration.test.ts:328` "answers an owner DM end to end without quoting and marks the trigger answered". Steering and queue fallback: `openwa/steering.integration.test.ts:436` "steers an owner follow-up into a live steer target, never sends nudges to WhatsApp, and queues without steering or in queue mode (AC2)". Code edits by a real run: live only. | Pass on 2026.1004.1 (2026-10-04): owner request at 04:26:52Z ran owner/full; a second owner message at 04:27:43Z was steered into the same run (both delivery ids on one run, both answered, no second run). Code edits by the run were not exercised live. |
| AC3 | Sender policy: unlisted DM filtered, denylist, outside-allowlist group role, `reply_denied` until granted | `openwa/admission.integration.test.ts:279` "admits owner and allowlisted DMs and filters outside-allowlist and denylisted senders (AC3)"; `:364` "activates groups by owner presence, admits outside-allowlist members, and never converts to low trust (AC4)"; `openwa/policy.test.ts:101` "applies the sender policy in direct messages, with owners bypassing the denylist"; `openwa/publication.integration.test.ts:567` "requires a reply_outside_allowlist grant for an outside-allowlist group sender"; `openwa/tools.integration.test.ts:380` "denies origin replies the reply policy holds back and the outside_allowlist rule" | Partial live 2026-10-04/05; denylist not yet. See [Live evidence](#live-evidence-2026-10-0406) |
| AC4 | Groups: owner present active; no owner inactive plus `group_added`; invite-link join needs `wa_admin` | `openwa/admission.integration.test.ts:364` (above); `:402` "wakes the agent once when added to an inactive group"; `openwa/policy.test.ts:122` "activates groups only with an owner present and admits outside-allowlist members there"; `openwa/catalog.integration.test.ts:349` "refuses with typed reasons for an other-class run at read level without an admin key" (covers `wa_admin` refusal for group operations; no fixture names the invite-link join operation) | Partial live 2026-10-05 (owner-present join); ownerless join and invite link not yet |
| AC5 | Read-only knowledge run reads and answers; runtime write tools unavailable (OMP/Codex/Claude); `create_task`, `external_tools`, REST 403 | `openwa/authority-admission.integration.test.ts:199` (above); `server/src/__tests__/heartbeat-openwa-run-profile.test.ts:133` "writes read_only for a non-owner run on an OpenWA conversation issue before the adapter runs"; `openwa/tools.integration.test.ts:338` "lets a read_only run reply to its origin chat under the reply policy and gates other chats"; `packages/adapters/omp-local/src/server/tool-guard.test.ts:115` describe "OMP tool guard extension in a read_only run"; `packages/adapters/codex-local/src/server/codex-args.test.ts:305` "runs a read_only run in the read-only sandbox without approval pauses", `:329` "ignores the configured bypass in a read_only run"; `packages/adapters/claude-local/src/server/execute.paperclip-mcp.test.ts:113` "disallows Claude's file-writing tools only in a read_only run and keeps Bash"; `server/src/routes/adapters.test.ts:86` "projects the registered adapters' declared read-only enforcement and steering"; `server/src/__tests__/openwa-authority.test.ts:968` "denies create_task and reassign_task in a read_only run and allows create_task in a full run"; `:1064` "denies write tools in a read_only run with openwa_approval_required"; `:701` "denies read_only mutations outside the allowlist and allows the run's own lifecycle writes" | Partial live: `read_only` answers and `create_task` approval; guard refusals and 403 not yet |
| AC6 | WhatsApp approval end to end with every negative control | `openwa/approvals.integration.test.ts:466` "AC6: WhatsApp approval end to end with every negative control"; `:606` "AC6: quoting another request's bubble resolves only that request"; `:628` "AC6/AC7: requester grants stay with their requester, Paperclip resolves through the generic route, owner loss revokes"; `:784` "rejects approval requests from owner-class runs"; `openwa/policy.test.ts:91` "detects approval-reply candidates only for owners quoting a message, regardless of activation"; `server/src/__tests__/openwa-authority.test.ts:631` "consumes a one_action grant exactly once under concurrency and keeps requester grants" | Live end to end 2026-10-04/05; four negative controls not yet |
| AC7 | Paperclip approval; simultaneous resolution has one winner; non-owner 403 | `openwa/approvals.integration.test.ts:628` (above); `:706` "AC7: a Paperclip rejection reason reaches the agent's approval_resolved comment"; `:724` "AC7: simultaneous WhatsApp and Paperclip resolution yields exactly one winner"; UI `ui/src/pages/apps/chat/OpenwaApprovalsList.test.tsx:125` "refreshes and says another owner won when the request was already resolved", `:144` "explains that only endpoint owners can resolve when the server refuses with 403" (UI mapping; no server fixture asserts the 403 status for a plain board user). Cancel in Paperclip (spec §6.9 step 7): `openwa/approvals.integration.test.ts:874` "spec 6.9: an owner cancels a pending request in Paperclip; non-owners and resolved requests are refused" (owner-only gate has a recorded negative control); UI `OpenwaApprovalsList.test.tsx:169` "cancels a pending request after confirmation and refreshes the list", `:187` "refreshes and explains when a request was resolved before the cancellation", `:204` "explains that only endpoint owners can cancel when the server refuses with 403" | Paperclip resolution live 2026-10-04/05; race and non-owner 403 not yet |
| AC8 | Owner absent: 120 s wake; owner message at 60 s cancels; reaction does not; owner plus agent mention wakes immediately | `openwa/scheduled-wakes.integration.test.ts:424` "owner silent 120 s wakes owner_absent with every attached message; fireAt never moves (AC8)"; `:471` "owner message at 60 s cancels; an owner reaction or revoke alone does not (AC8)"; `:496` "a message mentioning the owner and the agent wakes immediately and arms no timer (AC8)"; `:172` "counts only owner content as activity; reactions, edits and revokes never cancel" | Live: 120 s wake, approval plus holding reply, cancel by owner activity; reaction and dual mention not yet |
| AC9 | Mixed principals: member trigger queued during owner run; owner message steered into `read_only` run without raising it; follow-up owner run; class-rule negative control | `openwa/steering.integration.test.ts:284` "queues a member trigger and an unclassified wake behind an owner run, steers an owner message into a member read_only run and follows up with an owner run (AC9)"; `:355` "gives alternating member and owner group mentions their own class runs without steering, and an owner run answers the owner triggers"; `:470` "steers only the grant holder's member messages into a requester-grant run; another member gets a plain read_only run"; `:614` "gives a deferred wake that another member merged into no requester grant approved before it started (D36)"; `:626` "gives a queued run that another member coalesced into no requester grant approved before it started (D36)"; `:634` "gives the requester's own deferred wake its requester grant approved before it started"; `server/src/__tests__/openwa-authority.test.ts:492` "drops requester grants when any delivery merged into the run belongs to another principal or cannot be verified"; `openwa/nudges.test.ts:102` describe "OpenWA in-flight table (spec 7.3)"; `server/src/modules/wake-queue/application/use-cases.test.ts:1185` describe "admitWakeBehindIssueExecution OpenWA wake classes"; `openwa/authority-admission.integration.test.ts:244` "keeps a forged agent wakeup claiming the owner class read_only on the OpenWA issue"; bench burst budget "windows with > 1 run for one (conversation, class)" in `openwa/ingest-bench.ts` | Queueing live 2026-10-05; owner steering into a member run not yet |
| AC10 | Publication once; no duplicate after quoting tool reply; stay silent; `ask_owner` suppressed and audited | `openwa/publication.integration.test.ts:416` "publishes the final output exactly once, redacted, and marks the run-class triggers answered"; `:479` "does not publish again after a tool reply quoting the trigger (dedupe)"; `:522` "publishes nothing when the agent stayed silent"; `:533` "suppresses and audits an other-class reply under ask_owner until a reply grant exists"; `:602` "refuses server-composed publications for OpenWA conversations" | Live except `ask_owner` suppression |
| AC11 | Formatting and media: mentions, quotes, image, document, location, contact, voice note, transcript, `sttWaitSeconds` bound | `openwa/tools.integration.test.ts:289` "renders mentions as array plus @n tokens and quotes a trigger, marking it answered"; `openwa/round-trip.integration.test.ts:351` "quotes the trigger when replying to a group mention"; `openwa/media.integration.test.ts:204` "stores an image and a document as attachments on the inbound comment and records the result"; `:369` "parses location and contact-card messages into structured data without fetching a file"; `:277` "transcribes a voice note when speech-to-text is enabled and stores the transcript as a derivative"; `:336` "bounds the wake wait by sttWaitSeconds and delivers the late transcript through onTranscriptReady"; `:297` "keeps the audio and records transcript_unavailable when speech-to-text fails"; `openwa/round-trip.integration.test.ts:395` "carries a voice note transcript from the fake speech-to-text service into the wake payload" | Mentions, quotes, inbound image, outbound media live; other inbound kinds and STT not yet |
| AC12 | Tools: catalog lists 202 operations (OpenWA 0.23.7); admin hidden at `off`; owner lists sessions at `full`; other run needs `gateway_admin`; `unavailable_on_engine` without retry; pacing `retry_after` | `openwa/catalog.integration.test.ts:375` "AC12: catalogs 202 operations with category and availability; hides gateway admin at off"; `:408` "AC12: at full with an admin key an owner run lists every session; an other run needs gateway_admin approval"; `:444` "AC12: never sends an engine-unavailable operation and learns a 501 without retrying it"; `:465` "AC12: pacing 429 returns retry_after with seconds and audits the pacing flag"; `:751` "refuses secret-issuing operations before any gateway call, for owner runs at full with an admin key"; `packages/shared/src/openwa-operations.test.ts:8` "covers every operation of the pinned gateway document exactly once" | Catalog live (203 operations, OpenWA 0.24.0); admin gating, engine refusal and pacing not yet |
| AC13 | WhatsApp config: owner denylists a number by chat, effective next event, audited; member gets `owner_only` | `openwa/config-tool.integration.test.ts:267` "lets an owner run denylist a number by chat, effective on the next event and audited (AC13)"; `:339` "refuses member and grant runs with owner_only and changes nothing"; `:395` "changes chat settings, approval toggles, reminders and custom instructions with before/after audit"; `openwa/admission.integration.test.ts:346` "rechecks owner membership at admission even when the cached policy still lists the owner" | Pass on 2026.1004.1 (2026-10-04): owner asked by chat to denylist a number; `openwa_endpoint_config` added the deny rule at 04:29:07Z, `config_changed` audit has before/after, activity actor `chat:<owner principal>`, policy revision bumped. The member `owner_only` refusal is fixture only (no second test contact). |
| AC14 | Audit: every §11 entry; owners see content; plain board user metadata only; purge after retention | Layer 1 producers: `openwa/audit.integration.test.ts:428` "logs openwa.endpoint_created and openwa.endpoint_updated from the endpoint service next to the generic rows"; `:448` "logs openwa.grant_consumed when a grant run consumes a one_action grant"; `:466` "expires live grants past expires_at in the scheduled job and logs one openwa.grant_expired per endpoint"; `openwa/approvals.integration.test.ts:628` "AC6/AC7: requester grants stay with their requester, Paperclip resolves through the generic route, owner loss revokes" (owner_added, approval_requested, approval_resolved, grant_created, owner_removed, grant_revoked); `:874` "spec 6.9: an owner cancels a pending request in Paperclip; non-owners and resolved requests are refused" (approval_cancelled); `openwa/config-tool.integration.test.ts:267` "lets an owner run denylist a number by chat, effective on the next event and audited (AC13)" (sender_rule_changed); `:395` "changes chat settings, approval toggles, reminders and custom instructions with before/after audit" (config_changed, chat_activation_changed); `openwa/catalog.integration.test.ts:408` "AC12: at full with an admin key an owner run lists every session; an other run needs gateway_admin approval" (gateway_admin_called). Layer 2 producers: `openwa/admission.integration.test.ts:279` "admits owner and allowlisted DMs and filters outside-allowlist and denylisted senders (AC3)" (trigger_admitted, trigger_filtered); `:402` "wakes the agent once when added to an inactive group" (group_added); `:417` "marks a group unavailable and audits group_left when the agent's number is removed from it" (group_left); `openwa/publication.integration.test.ts:416` "publishes the final output exactly once, redacted, and marks the run-class triggers answered" (message_sent); `:533` "suppresses and audits an other-class reply under ask_owner until a reply grant exists" (publication_suppressed); `openwa/catalog.integration.test.ts:329` "dispatches every manifest operation with schema-valid minimal args or refuses it with a typed reason (owner, full, admin key)" (tool_called); `openwa/approvals.integration.test.ts:466` "AC6: WhatsApp approval end to end with every negative control" (approval_requested, approval_resolved); `openwa/scheduled-wakes.integration.test.ts:613` "schedules, fires and cancels approval reminders through the exported API" (approval_reminded); `openwa/approvals.integration.test.ts:874` (approval_cancelled); `openwa/config-tool.integration.test.ts:395` (config_changed); `openwa/session-health.integration.test.ts:265` "wakes the owner conversation once per health transition with class other/read_only" (session_health). Access and retention: `openwa/audit.integration.test.ts:182` "shows content to company and endpoint owners, metadata only to plain board users, and 404 to another company"; `:309` "purges content after the endpoint retention and keeps metadata"; UI `ui/src/pages/apps/chat/OpenwaAuditTab.test.tsx:83` "explains metadata-only access and never renders returned content" | pending live window |
| AC15 | Owner-number mode: enabled chats only, `/ai`, prefix, self-chat approval, restart echo, crash before 201, approval without enabled chat | `openwa/policy.test.ts:147` "treats the agent number's own phone-typed messages by number mode"; `openwa/publication.integration.test.ts:467` "quotes the oldest pending trigger of the run class in groups and prefixes owner_number output once"; `openwa/approvals.integration.test.ts:754` "AC15: owner_number self-chat approval and replies from a chat that is not enabled"; `openwa/ingress.integration.test.ts:266` "ignores the echo of a registered send and classifies other own-number messages as phone-typed"; `:381` "hands the lease to a second runtime without duplicate processing and still recognizes pre-restart sends"; `:288` "reconciles a send that crashed before its 201 and never classifies it as phone-typed" | Not run: endpoint is `agent_number` |
| AC16 | Recovery: socket kill mid-burst exactly once; restart rebuilds timers within 2 s | `openwa/ingress.integration.test.ts:222` "delivers live and caught-up messages exactly once across a socket kill"; `openwa/receiver.test.ts:89` "processes every message exactly once across a mid-stream socket kill, including stored rows without a waMessageId"; `openwa/scheduled-wakes.integration.test.ts:548` "rebuilds after a restart and fires within 2 s of fireAt, including overdue rows on the rebuild pass (AC16)"; `:575` "fires exactly once when two lease holders overlap during failover" | pending live window |
| AC17 | Performance: §15 budgets met with recorded numbers and the S0 negative control | Harness `scripts/bench/openwa-ingest.mjs` → `openwa/ingest-bench.ts`; zero-query assertions `openwa/ingress.integration.test.ts:243` "performs zero database queries while classifying non-trigger traffic", `openwa/admission.integration.test.ts:470` "performs zero database queries for non-trigger traffic once the policy is warm"; context budget `packages/shared/src/openwa-tools.test.ts:6` "keeps every tool schema within the context budget". Numbers: see [Benchmark](#benchmark): every budget met, negative control fails as required. | fixture only (benchmark uses the fake gateway by design) |
| AC18 | Isolation: another company cannot read audit, grants, chats or tools | `openwa/audit.integration.test.ts:182` (404 to another company), `:228` "scopes the service to the caller's company"; `server/src/__tests__/openwa-authority.test.ts:666` "never lets another company's run read or consume this endpoint's grants"; `openwa/media.integration.test.ts:419` "refuses to attach media to an issue in another company"; `openwa/tools.integration.test.ts:611` "exposes the tools over HTTP to the bound agent run only" (no fixture has a foreign company's run read this endpoint's chats) | pending live window |
| AC19 | Fail-closed seams: `read_only` mention wakes no one; context-less runs `read_only`; persistent key cannot mutate; GitHub export denied | `server/src/__tests__/openwa-authority.test.ts:597` "suppresses mention wakes fail-closed by run profile"; `:377` "is read_only without a server-written wake record for agent, system, retry or missing wakes"; `:621` "fails closed for a run on an OpenWA issue whose context has no profile"; `:727` "fails closed for an OpenWA conversation run without OpenWA context"; `:831` "denies every non-safe method for an agent bound to a live OpenWA endpoint"; `:891` "allows keys of agents without a live OpenWA endpoint, including other companies"; `:911` "denies GitHub credential export in a read_only run and reaches the resolver in a full run" | pending live window |

## Benchmark

Run with `node scripts/bench/openwa-ingest.mjs` (fake gateway, default 20 ms per
REST call) and once with `--negative-control`, which injects one DB query into
the S0 path and must fail. Recorded 2026-10-03T22:42Z on commit `334d2ce5f`
(the class-separation and queue-drain fix, merged into `cc6a8a8e9`), host load
average below 2, `nice -n 19`, full run, no `--skip`: exit 0, `partial: false`.

| Seam | Interval | Budget (spec §15) | Result | Status |
| --- | --- | --- | --- | --- |
| S0 non-trigger | socket event without trigger features → discard | p99 < 1 ms, 0 DB queries | p99 0.127 ms, 0 queries | pass |
| S0b candidate check | quoted id outside the 7-day index | p95 <= 10 ms, at most 1 query | p95 0.997 ms, 1 query | pass |
| S0b pending-timer cancel | owner message against an armed absence timer | p95 <= 10 ms, at most 1 query | p95 2.368 ms, 1 query | pass |
| S1 admission | socket event → admission transaction committed | p95 <= 50 ms and <= 1.2x Telegram baseline | p95 44.841 ms; ratio 0.164 | pass |
| S2 dispatch | admission committed → run start requested | p95 <= 200 ms | p95 27.374 ms | pass |
| S3 tool overhead | tool call wall time minus fake gateway latency | p95 <= 30 ms | p95 11.695 ms | pass |
| S4 media | 1 MiB trigger image ingested, transfer excluded | p95 <= 300 ms | p95 15.122 ms | pass |
| S5 LID miss | resolution | <= 2 s timeout; hit ratio reported | max 6.369 ms; owner LID 20/20; unknown LID fail-closed 20/20 | pass |
| Burst | 50 msg/s for 60 s, 10% triggers | no loss or duplicate; wakes <= distinct (conversation, class) per window; RSS growth < 50 MB | lost/dup 0 / 0; >1 run windows 0; starved pairs 0; RSS -106.5 MB; non-trigger with queries 0/3375 | pass |
| Reconnect | socket killed at 30 s for 10 s during burst | every trigger admitted exactly once | not exactly once: 0 | pass |
| Context | tool schemas; results | <= ~3k tokens; <= 16 KB | 2710 tokens; read_chat max 15416 bytes | pass |
| Negative control | one DB query injected into S0 | benchmark fails | commit `cc6a8a8e9`, `--negative-control`: exit 1; S0 1 query (fail), S0b 2 and 3 queries (fail) | pass |

Raw JSON is kept outside the repository (bench scratch directory); the table
above is copied from it. Earlier runs on a loaded host (load average above 10)
showed S1 p95 from 60 to 480 ms with no product cause in the traces; budgets were
not loosened.

## Gates run

| Gate | Commit | Result |
| --- | --- | --- |
| Documentation name check: every route, tool name, setting key and file:line in `OPENWA.md` resolved against the code (throwaway script, deleted) | T19 docs commit | recorded in the T19 report |
| `go.sh -r typecheck` | pending | pending |
| Targeted `go.sh vitest run server/src/__tests__/openwa ...` | pending | pending |
| `go.sh check:token-gates` | pending | pending |
| `go.sh --filter @tickernelz/paperclip-pro-db run check:migrations` | pending | pending |
| GitHub CI on the PR head | pending | pending |
| Broad suite against a `main` baseline (checkpoint E) | pending | pending |
| Comment gate on the staged diff | pending | pending |

## Live qualification

Record the tested commit, gateway version, engine, adapter, masked numbers and
UTC timestamps for each journey. Screenshots of Settings, Approvals, Audit and
the health card belong here after the live window.

### Journey 1: setup and owner test DM (AC1)

- Commit: 2026.1004.0 (`d27bb187c`) for the first attempt, 2026.1004.1
  (`e98605480`) for completion. Gateway 0.23.7, engine `whatsapp-web.js`.
- 03:20Z: inspect returned version 0.23.7, operator key role, one `ready`
  session; configure moved the endpoint to `verifying`, step `test`; owner
  identity link confirmed by the owner.
- 03:21:49Z: owner DM admitted (`trigger_class` owner, role owner); the run
  resolved owner/full and succeeded in 34 s.
- 03:22:09Z: the agent replied with `openwa_send` (outbound `tool`, `sent`);
  the trigger was marked answered, so run-end publication was suppressed
  (`no_pending_trigger`), as designed.
- Defect found: setup only accepted a final publication, so the test step kept
  returning 409 `chat_test_round_trip_incomplete`. Fixed in `bddbd74fe`
  (accept the run's own sent reply to the test chat) and released in 2026.1004.1.
- 04:17:01Z: `POST /test` returned `active`, health `Connected`, setup
  `complete`.
- 03:42:14Z: a DM from an unlisted number (+62xxx...8008) was audited as
  `trigger_filtered` (`outside_allowlist`) and woke nobody. It is unrelated to
  the owner DM and matches AC3's unlisted-DM rule.

### Journey 2: owner work, steering and WhatsApp config (AC2, AC13)

- 04:26:52Z: owner asked the agent to summarise open ZHA issues; the run
  resolved owner/full.
- 04:27:43Z: a second owner message arrived mid-run and was steered into the
  same run: both delivery ids sit on that run, both triggers are answered, no
  extra run started. The agent replied with `openwa_send` (04:28:10Z and
  04:28:11Z).
- 04:28:55Z: owner asked by chat to denylist +62xxx...0001; the owner run called
  `openwa_endpoint_config` (04:29:07Z). The deny rule exists, the
  `config_changed` audit row holds before (none) and after (the rule), the
  activity row `openwa.sender_rule_changed` names `chat:<owner principal>`, and
  the policy revision moved to 4.
- Defect found: each message started a new conversation issue, because the
  agent marked the conversation issue done after replying and the generic chat
  rule rotates on a done issue. Fixed in `4f03f7f63`: for OpenWA a done issue
  is reopened by the next message; rotation needs idle time, `/new`, `/close`
  or a cancelled issue. Guidance and the skill now tell the agent to keep the
  conversation issue open.

### Journey 3: outbound media (AC11, partial)

- Release 2026.1004.3 (`0e7e5f05c`), which tells the agent how to upload its
  own files as task attachments before sending them.
- 05:38:11Z-05:38:15Z: on an owner request the agent sent an image, a
  document, a location and a poll; each `openwa_send` has a `tool_called`
  and a `message_sent` audit row with the matching kind, and the owner
  confirmed all four arrived on the phone.
- Not covered live: video, audio, voice note, sticker, contact card, inbound
  media and transcripts. Template and button messages are Baileys-only and this
  gateway runs whatsapp-web.js.

### Journey 4: member DM, approval and owner-only config (AC3, AC5, AC6, AC13)

- Release 2026.1004.4. Member B is a second phone number.
- 07:32:04Z-07:32:17Z: three DMs from B (+62xxx...4657) were audited as
  `trigger_filtered`, reason `outside_allowlist`; no run started.
- 07:33:20Z: the owner asked by DM to allow B; the owner run (full) called
  `openwa_endpoint_config` and the `config_changed` row records one added
  sender rule.
- 07:34:18Z: B's next DM was admitted as `allowed`, trigger class `other`;
  the run resolved `read_only` and replied.
- 07:35:21Z: B asked for a new task. The read-only run requested a one-action
  `create_task` approval (07:35:48Z). A bare "setuju" from the owner was not
  taken as approval; the owner's quoted reply (07:36:57Z) resolved it
  (`approval_resolved`, via whatsapp, 07:37:20Z) and the grant run (still
  `read_only`, class `grant`) created ZHA-381 "Cek stok gudang" as a child of
  the conversation issue ZHA-380.
- 07:38:53Z: B asked to denylist a number; `openwa_endpoint_config` returned
  `owner_only` (07:39:09Z) and the agent declined.

### Journey 5: group mention by LID (AC4, AC9)

- Release 2026.1004.4. Group "Test Assistant" with the owner, B and the agent
  was discovered at 07:31:40Z and enabled (owner present).
- 07:41:57Z: B wrote "@<agent> apa itu Paperclip?". WhatsApp addressed the
  mention to the agent's LID, which admission did not know (it only matched
  the phone JID), so the message was discarded with no audit row and no reply.
- Fixed in `c4a104564`, released as 2026.1004.5: admission resolves the
  agent's own LID once through `contacts/check` and matches it in mentions,
  body text and group joins. The group journey is to be rerun on this build.

### Journey 6: owner absent (AC8, in progress)

- 09:29:20Z (2026.1004.6): a member mentioned the owner by LID; the timer armed
  and fired at 09:31:20Z with both messages, but the agent stayed silent
  because the mention was meant for the owner. The flow changed to brief the
  owner by DM (`8d40a44c2`, `30959384e`, `53b249e24`).
- 13:54:12Z (2026.1004.10, gateway upgraded to OpenWA 0.24.0): the timer armed
  and fired at 13:56:11Z, the run received the owner DM targets, yet stayed
  silent again: the generic wake reason read as a plain message and the
  mention showed only as a masked LID. Fixed in `7f3e04865`: an
  `owner_absent` headline names the owner, owner mentions render as
  `owner:"<name>"`, and `openwa_find` marks owners. The same commit pins
  OpenWA 0.24.0. The journey is to be rerun on that build.
- 14:55:48Z (2026.1004.11): the timer fired at 14:57:47Z. The agent asked the
  owner through a `reply` approval with a summary and a suggested reply, and
  posted a holding reply in the group that mentioned the owner (14:59:04Z).
  The owner's quoted "ok" (15:00:53Z) woke `approval_reply`, but the agent
  read it as a plain acknowledgement and stayed silent. At 15:42Z the owner
  replied "ok" again and approved in Paperclip; both the `approval_reply` run
  and the `approval_resolved` run posted the reply (15:43:11Z and 15:43:18Z).
- Fixed in `f162248c3` and `b9f9efd63` (2026.1004.12): the reply approval is
  the documented owner_absent route, `approval_reply` wakes open with a
  headline to resolve, and an `approval_reply` run's send to the request's
  chat fails with `approval_action_pending`, so only the `approval_resolved`
  run posts. The journey is to be rerun on that build.

### Journey 7: linked read-only numbers (production readiness)

- Released in 2026.1004.13 (`430437e9a`): migration 0289 applied
  (`chat_openwa_linked_sessions` exists, the audit kind check allows
  `linked_read`). `GET .../openwa/linked-sessions` returns `[]`;
  `GET .../openwa/linkable-sessions` returns 422 `openwa_admin_key_required`
  because this endpoint has no admin key yet, as specified.
- Fixture coverage: `openwa/linked.integration.test.ts` (13 tests) with negative
  controls for the owner-only gate, the chat allowlist and endpoint-removal
  cleanup; independent review findings (key lifecycle) fixed in `a97948939`.
- Live journey pending: add an admin key, connect the owner's second session on
  the gateway, link it, select chats, and ask the agent from an owner DM.

### Live evidence 2026-10-04..06

Source: read-only queries against the production database (`chat_audit_entries`,
`chat_deliveries`, `chat_owner_approval_requests`, `chat_owner_grants`,
`chat_scheduled_wakes`, `heartbeat_runs`, `activity_log`) and the agent's run
logs, for real traffic between 2026-10-04T03:19Z and 2026-10-06T01:07Z on releases
2026.1004.0 through 2026.1005.10. Times are UTC; runs are cited by the first eight
characters of their id. Chats: owner DM `…6444@lid`, member B DM `…2310@lid`,
"Test Assistant" `…2078@g.us`, "Hashy Geulis" `…3168@g.us`, "Dev Dcm upgrade"
`…7973@g.us`. The endpoint runs in `agent_number` mode with `replyPolicy`
`allowed`, and gateway admin tools at `full` since 2026-10-04T23:31Z. Volume: 78
OpenWA runs (32 owner `full`, 35 member `read_only`, 10 `grant`, 1
system-woken), 88 deliveries, 12 approval requests, 14 grants, 11 absence timers.
"Not yet" rows name the real-world action that would produce the evidence.

| AC | Clause | Status | Evidence, or the action that produces it |
| --- | --- | --- | --- |
| AC3 | Unlisted DM: no wake, `trigger_filtered` | Live | `trigger_filtered` `outside_allowlist` DM from +62xxx...8008 at 10-04 03:42:14 and three from +62xxx...4657 at 07:32:04-07:32:17; no run started |
| AC3 | Denylisted sender ignored in DMs and groups | Not yet | A deny rule exists (+62xxx...0001, 10-04 04:29:07) but that number never wrote. The denylisted number sends the agent a DM and mentions it in an active group |
| AC3 | Outside-allowlist group mention wakes with role `outside_allowlist`; agent may answer in an active group | Live | 37 `trigger_admitted` with `principalRole` `outside_allowlist` in `…3168@g.us` and `…7973@g.us`; from 10-05 09:28 the agent answered addressed members directly without a grant (`e97ae05a`, `7adab6cb`, `3f16c69a`, `64cfbb60`, `1e60da31` and others) |
| AC3 | Outside-allowlist trigger: `reply_denied` until an owner grants it | Live | `openwa_send` `reply_denied` (`reply_outside_allowlist`) in `3b2d3958` (10-05 06:42:21), `46866fde` (07:10), `42d80baa` (07:26), `d41345e3` (09:23:19); each led to an approval, a grant and a delivered reply by the `grant` run (`b035349d` 06:55:12, `c0418889` 07:17:02, `db678fa7` 07:29:56, `c6adf9ef` 09:26:28) |
| AC4 | Added to a group with an owner: active | Live | `group_added` `active: true`, `ownerPresent: true` for `…3168@g.us` at 10-05 02:25:48 and `…7973@g.us` at 09:52:23; the owner's first mention was answered by `18bd7f66` (02:26:01) |
| AC4 | Added without an owner: inactive plus a `group_added` wake | Not yet | A member adds the agent's number to a group in which no endpoint owner is a participant |
| AC4 | Invite-link join from an `other` run: `approval_required(wa_admin)` | Not yet | A member asks the agent, in a group or DM, to join another group through an invite link |
| AC5 | `read_only` run reads and answers | Live | 35 member runs at `read_only`, e.g. `90fea52a` (10-04 09:27, `…2078@g.us`), `4a1408f1` (10-05 11:12, five DCM questions answered in `…7973@g.us`), `3f16c69a` (09:54) |
| AC5 | Runtime write tool unavailable (OMP) | Not yet | No `read_only` run attempted a write: their `omp.bash` calls were reads and no log contains the tool-guard refusal. A member asks the agent to change a file or save a note, so the `read_only` run tries `edit`/`write` and is refused |
| AC5 | Creating an issue: `approval_required(create_task)` | Partial | The approval path is live: `b1434331` requested `create_task` (10-04 07:35:48) and `4a1408f1` (10-05 11:13:43) before creating anything. The server refusal was never hit because the agent never tried first; it needs a member request that makes a `read_only` run call issue creation directly |
| AC5 | Connector write: `approval_required(external_tools)` | Not yet | A member asks the agent to act in an external service, e.g. create a calendar event or send an email |
| AC5 | Non-allowlisted REST mutation: 403 | Not yet | No 403 in any `read_only` run log. A member asks for a Paperclip change outside the run's own issue, e.g. "reassign ZHA-xxx to me" |
| AC6 | Agent-written request reaches owner DMs; owner quotes it; `approval_reply` run resolves; grant; `grant` run creates the child; requester informed | Live | Member B DM: request `61c34ba0` (10-04 07:35:48), owner quoted reply 07:36:57, `544977e0` resolved 07:37:20, grant consumed by `42d36a24`, which created ZHA-381 at 07:37:40 (it did not message B). Group: request `ef2b0a68` (10-05 11:13:43), owner reply with a condition recorded as `agent_conditions`, resolved 11:15:48, `7501968b` created the child at 11:21:34 and told the group (11:20:46, 11:21:58) |
| AC6 | Member quotes the bubble | Not yet | A non-owner forwards or quotes an approval bubble to the agent with "ok" |
| AC6 | Owner reply without a quote | Not yet | All 12 owner `approval_reply` deliveries quoted a bubble. The owner sends "ok" in the agent DM without quoting while a request is pending |
| AC6 | `openwa_approval_resolve` from an `other` or `grant` run | Not yet | All 13 resolve calls came from owner runs. A member asks the agent to approve its own pending request |
| AC6 | Quoting one request's bubble resolves only that request | Live | `3db5856f` (09:23:39) and `baea7db9` (09:25:15) were pending together; the owner's quote resolved `3db5856f` at 09:24:55 (`f49e7720`) while `baea7db9` stayed pending until its own quote at 09:26:38 (`eb458777`) |
| AC6 | Already-resolved reply gives no second grant | Partial | Second resolves returned `already_resolved` with no extra grant: `b0964937` 10-05 02:35:12, `51655e57` 02:42:49, `16a997cd` 11:16:02, `9e442af1` 16:05:55. Catch-up replay was not seen: it needs the gateway to reconnect and replay an owner's approval reply that was already handled |
| AC6 | Member B cannot use member A's grant | Not yet | Two outside-allowlist members each trigger a reply approval in the same group; the owner approves only A's request; B's run must still get `reply_denied` |
| AC7 | Owner resolves in Paperclip: same grant | Live | `8f4c5321` resolved `via: paperclip` 10-04 15:42:23, grant consumed and reply sent by `09f362b1` 15:43:11; `41cfffc3` and `6c227950` resolved in Paperclip 10-05 06:54:51/55 |
| AC7 | Simultaneous WhatsApp and Paperclip resolution: one winner | Not yet | On 10-04 15:42 the WhatsApp reply was read as an acknowledgement and never called resolve. The owner approves one request in Paperclip Approvals and quotes its bubble with "ok" within the same few seconds |
| AC7 | Non-owner board user: 403 | Not yet | A board member who is not an endpoint owner presses Approve on an OpenWA request in Paperclip |
| AC8 | Owner silent 120 s: `owner_absent` wake | Live | Nine wakes fired 119-120 s after arming, e.g. 10-04 09:29:20 to 09:31:20, 14:55:48 to 14:57:47, 10-05 09:22:42 to 09:24:42 |
| AC8 | Agent asks the owner through a `reply` approval with a suggested reply, posts a holding reply, posts the reply on approval | Live | `9541c1b3`: approval `8f4c5321` 10-04 14:58:46, quoted holding reply 14:59:04, reply posted by `09f362b1` 15:43:11. `62b90ec4`: approval `baea7db9` 10-05 09:25:15, holding reply 09:25:28, reply by `74a84b96` 09:28:06 |
| AC8 | Owner message at 60 s cancels | Live | Timers armed 10-05 02:38:26 and 06:38:13 in `…3168@g.us` were cancelled at 02:39:08 and 06:38:28 and never fired. Owner chat activity is the only path that cancels an `owner_absent` timer; the owner's non-trigger group message has no audit row of its own |
| AC8 | Owner reaction only does not cancel | Not yet | A member mentions the owner, the owner only reacts with an emoji within 120 s, and the wake still fires |
| AC8 | Message mentioning owner and agent: immediate wake, no timer | Not yet | No delivery mentioned both. A member writes one group message that tags the owner and the agent |
| AC9 | Member trigger during an owner run: queued | Live | Owner run `18bd7f66` (10-05 02:26:01-02:28:37) while members mentioned the agent from 02:26:23; their run `a662070a` started at 02:28:38. Owner run `b00e2ca0` (07:19:20-07:22:57) and member trigger 07:19:44, handled by `42d80baa` from 07:22:57 |
| AC9 | Owner message during a member `read_only` run: steered, profile stays `read_only` | Not yet | Messages steered into member runs were all from members (`a662070a` 02:29:11, `42d80baa` 07:23:22, `f822aa82` 10:22:26). The owner writes in the group while a member's run there is still working |
| AC9 | Request needing writes produces a follow-up owner run | Not yet | Same moment as above, with the owner asking for a change, e.g. "tolong buat issue-nya" |
| AC9 | Class-rule negative control | Fixture only | Removing the class rule is a code change; it has no live form |
| AC10 | Final output published once | Live | 18 publication sends with 18 distinct publication ids, e.g. 10-04 07:37:48, 10-05 06:58:16 |
| AC10 | Tool reply quoting the trigger: no duplicate | Live | 39 `publication_suppressed` `no_pending_trigger` after a quoted tool reply, e.g. `e97ae05a` 10-05 09:28, `3f16c69a` 09:54 |
| AC10 | `openwa_stay_silent`: nothing sent | Live | 8 calls; `b40bb4c1` 10-04 09:31:39 and `0573ed26` 10-05 07:05:17 sent nothing |
| AC10 | `ask_owner` policy: suppressed and audited | Not yet | Every chat used `replyPolicy` `allowed`. The owner sets one group's reply policy to "ask owner" and a member mentions the agent there. The analogous `outside_allowlist` suppression is live: six rows, e.g. `a662070a` 02:36:46 |
| AC11 | Mentions render as tags | Live | Owner tagged in holding replies (`9541c1b3` 10-04 14:59:04, `b0d360ac` 10-05 00:04) |
| AC11 | Replies show the quote bubble | Live | 44 tool sends and 2 publications carried a quoted message id |
| AC11 | Image readable | Live | Inbound `image/jpeg` mentions 10-05 02:29:11, 06:56:27 and 07:19:44; fetched with `openwa_get_media` by `a662070a` (02:31:15) and `42d80baa` (07:24:39) and stored as an attachment |
| AC11 | Document, location, contact card, voice note readable | Not yet | No inbound message of these kinds. A member sends the agent a PDF, a shared location, a contact card and a voice note |
| AC11 | Transcript with STT; wake bounded by `sttWaitSeconds` | Not yet | Speech-to-text is not configured on this endpoint. Configure it, then send the agent a voice note |
| AC11 | Outbound media (beyond the AC text) | Live | Image, document, location, poll 10-04 05:38:11-05:38:15 (`9184a36e`); two documents to `…7973@g.us` 10-05 18:05:55-58 (`01c4d0e3`) |
| AC12 | Catalog lists every operation with category and availability | Live | `a3c42235` 10-05 00:14:48-00:34:48: `total: 203`, engine `whatsapp-web.js`, each operation with category, gate and availability. The gateway was OpenWA 0.24.0 by then, so 203 replaces 202 |
| AC12 | Gateway admin hidden at `off` | Not yet | The owner sets gateway admin tools to `off` and asks the agent to list the catalog |
| AC12 | At `full` with an admin key, an owner run lists sessions | Not yet | The catalog showed `gateway_admin` operations as available, but no session listing was called. The owner asks the agent in DM to list the gateway sessions |
| AC12 | `other` run: `approval_required(gateway_admin)` | Not yet | A member asks the agent for a gateway admin action, e.g. listing sessions |
| AC12 | Baileys-only operation: `unavailable_on_engine` without retry | Partial | The catalog marks such operations `unavailable_on_engine` (e.g. `CallController_reject`, `CatalogController_getCatalog`); none was called. The owner asks the agent to read the WhatsApp Business catalog |
| AC12 | Pacing 429: `retry_after` honoured | Not yet | No 429 occurred. The owner asks the agent to send a burst of messages to the owner's own DM until the gateway paces it |
| AC15 | Every clause | Not yet | This endpoint is `agent_number`. Connect an `owner_number` endpoint on the owner's phone; enable one chat; send `/ai ...` from the phone in it and in a chat that is not enabled; check the prefix on replies; approve a request from the self-chat; restart Paperclip right after an approval bubble is sent; reply to a bubble in a chat that is not enabled |

Defects and oddities seen in the same window:

- `activity_log` holds two `openwa.grant_consumed` rows for one `create_task`
  grant (`ddbc8b52`, 10-05 11:20:46 and 11:21:33), while `chat_owner_grants`
  records a single consumption at 11:21:33.
- The 10-04 `grant` run `42d36a24` created ZHA-381 but sent nothing to the
  requester; the 10-05 `grant` run `7501968b` did inform the group.

### Remaining journeys

- AC15 (owner-number mode): not run; this endpoint uses `agent_number`.
- AC3-AC12: partly live from member and group traffic on 2026-10-04..06; the
  "Not yet" rows in [Live evidence 2026-10-04..06](#live-evidence-2026-10-0406)
  list what is still fixture-only and the action that would prove each one.
