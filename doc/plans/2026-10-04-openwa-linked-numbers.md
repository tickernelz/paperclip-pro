# OpenWA linked read-only numbers — 2026-10-04

## Goal
An OpenWA chat endpoint keeps its agent number (unchanged). The board can link
extra OpenWA sessions on the same gateway (for example the owner's personal
WhatsApp). The assigned agent can read selected chats of a linked session on
demand in owner-triggered runs only. A linked session is never used to send,
never wakes the agent, and its content is never copied into Paperclip.

## Decisions (owner-confirmed)
1. Access: only runs whose trigger class is owner (profile full). Every other
   run gets 403 owner_only. No approval category.
2. Mode: on demand only. No socket subscription, no wake, no admission.
3. Scope: allowlist. A linked number exposes no chat until the board selects
   chats/groups in the UI; reads outside the list fail 403 linked_chat_not_allowed.
4. Key: Paperclip creates a dedicated OpenWA API key per linked session with the
   endpoint's stored admin key (credentials.adminApiKey): role viewer,
   allowedSessions [linkedSessionId], name "paperclip-linked-<short id>".
   Stored as a Paperclip-managed company secret; never returned to any client or
   agent. Unlink revokes the key (AuthController_revoke/delete) and deletes the
   secret. When the endpoint has no admin key, linking fails 422
   openwa_admin_key_required with a message telling the board to add one.
5. Live test waits for the owner; ship with fake-gateway coverage.

## Gateway facts (OpenWA 0.24.0, verified in container source)
- Read routes used: GET /api/sessions/{id} (status/phone/pushName),
  GET /api/sessions/{id}/chats, GET /api/sessions/{id}/groups,
  GET /api/messages/{sessionId}/{chatId}/history (or the stored-messages
  equivalent already used by openwa_read_chat). All are viewer-reachable.
- Every send/write route requires RequireRole(OPERATOR), so a viewer key is
  refused by the gateway itself (defense in depth).
- POST /api/auth/keys (AuthController_create): body {name, role, allowedSessions};
  response ApiKeyCreatedResponseDto includes apiKey once.

## Data model (migration 0289)
Table chat_openwa_linked_sessions:
- id uuid pk, company_id fk companies cascade, endpoint_id uuid not null
- session_id text not null (OpenWA session uuid)
- label text not null (display, e.g. "Zhafron pribadi")
- phone_masked text null, push_name text null (cached from gateway)
- secret_id uuid not null (company_secrets id of the viewer key)
- gateway_key_id text not null (OpenWA key id for revoke)
- allowed_chats jsonb not null default '[]' (array of {chatId, label, isGroup})
- status text not null default 'active' ('active' | 'unavailable')
- created_by_user_id text, created_at, updated_at
- unique (endpoint_id, session_id); the endpoint's own session may not be linked
  (422 openwa_linked_is_agent_session).

## Server
- Service openwa/linked.ts: list, link(sessionId,label), updateAllowedChats,
  unlink, gatewayChats(linkedId) for the picker (names + ids, no message
  bodies), and read helpers for tools. Company-scoped, activity log rows
  openwa.linked_session_added / _chats_changed / _removed, chat_audit_entries
  kind linked_read on every agent read (chat key + count, no content).
- Routes under /api/chat-endpoints/:endpointId/openwa/linked-sessions:
  GET list (endpoint access), POST link, PUT /:linkedId/chats, DELETE /:linkedId,
  GET /:linkedId/gateway-chats (management access, like existing
  /openwa/gateway-chats). Follow skill add-paperclip-pro-server-route (openapi,
  route prefix map, mcp tools regen, guard classification).
- Gateway sessions available to link: GET .../openwa/linkable-sessions lists
  gateway sessions (admin key) excluding the agent session and already linked.

## Agent tools (shared openwa-tools.ts + server tools.ts)
- openwa_linked_list({}) -> [{linkedRef, label, phoneMasked, chats:[{chatRef,label,isGroup}]}]
- openwa_linked_read({linkedRef, chat, limit?, cursor?}) -> messages in the same
  shape as openwa_read_chat (sender masked unless owner, media metadata only).
Both: category read, owner runs only (reuse assertOpenwaConfigOwnerRun-style
gate: ctx.openwa.triggerClass === "owner" and profile full), audited.
Guidance (owner runs only) lists linked numbers by label; skill documents the
tools and the owner-only rule. Never offer send on linked sessions.

## UI
OpenwaSettings: new "Linked numbers" section after Owners: list, link dialog
(pick gateway session + label), per-number chat picker (search, checkboxes,
groups and contacts), unlink with confirm. Token-only styles; pnpm
check:token-gates must pass.

## Tests
- Integration (fake gateway): link creates viewer key scoped to session and
  stores secret; agent session refused; no admin key -> 422; owner run reads an
  allowed chat; non-owner run 403; chat outside allowlist 403; unlink revokes key
  and later reads fail; audit + activity rows; key never in responses.
- Shared schema tests for the two tools; UI test for the section.
