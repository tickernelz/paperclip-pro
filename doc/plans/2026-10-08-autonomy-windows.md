# Autonomy windows

Status: draft for owner approval (2026-10-08)
Owner: Zhafron

## Problem

Zhafron tells Wira on WhatsApp "full otonom, aku approve commit, push, deploy" before sleeping. Agents working in the named trees still open `request_confirmation` cards (2026-10-08: ZHA-745, ZHA-749, ZHA-754, ZHA-758, all answered only at 06:16), because "full otonom" exists only as an AGENTS.md text convention that each agent must find on its issue or an ancestor. Nothing in the server knows about it.

## Outcome

The owner opens an autonomy window for named issue trees, through Wira or the board UI. While it is open, every plain `request_confirmation` card created inside those trees is accepted automatically by the server, audited as accepted by the window, and the agent continues. The window closes when the owner says so or when it expires.

## Decisions

| # | Decision |
|---|----------|
| D1 | Scope is what the owner asks for: one or more root issues; descendants are included. Wira asks once when the owner's words do not name the work. |
| D2 | Only plain `request_confirmation` cards are auto-accepted. Never: `ask_user_questions`, item verdicts, checkbox confirmations, suggested tasks, connection intents, `approvals` rows, confirmations carrying `toolAction`, `secretProposal`, or `openwaApprovalRequestId`, and review verdict interactions. |
| D3 | A window has an expiry (required, default 12 h, max 24 h) and an optional cap on accepts. It can be closed early. Expired or closed windows are inert. |
| D4 | The window does not make destructive actions allowed: agents' existing rules for force-push, history rewrite, data loss and secrets still apply; the auto-accept only removes the wait for owner confirmation of non-destructive steps that the agent already asks for with a card. Only a card the agent explicitly declares non-destructive (payload `destructive: false`) is auto-accepted; `destructive: true` or a missing field stays pending (fail closed). |
| D5 | Only the endpoint's verified owner (owner-class OpenWA run) or a board user can open or close a window. |
| D6 | The AGENTS.md `Mode: full otonom` marker stays as a behaviour signal; the window is the enforcement. Wira writes both. |

## Interfaces

### Database

`issue_autonomy_windows`: `id`, `company_id`, `root_issue_id` (FK issues, cascade), `granted_by_user_id`, `granted_via` (`whatsapp` or `paperclip`), `status` (`live`, `revoked`, `expired`), `expires_at` not null, `max_accepts` null, `accept_count` default 0, `note`, `created_at`, `updated_at`, `closed_at`, `closed_by_user_id`. Indexes `(company_id, status, expires_at)` and `(company_id, root_issue_id, status)`.

### Server

- `issueThreadInteractionService.autoAcceptWithinAutonomyWindow(issue, interaction)` runs after a `request_confirmation` is created, with the guard chain from D2/D4, a live unexpired window whose root equals the issue or is an ancestor (`issueIdIsDescendantOf`), and the cap. It accepts through `acceptRequestConfirmation` with actor `{ systemId: "system:autonomy-window", resolutionDetails: { source: "autonomy_window", windowId, rootIssueId, grantedByUserId, expiresAt } }`, including the existing wake path, and increments `accept_count` in the same transaction.
- Lazy expiry: `status='expired'` for `live` rows past `expires_at` at lookup time.
- Board routes: `GET/POST /companies/:companyId/autonomy-windows`, `DELETE /autonomy-windows/:id` (board users), activity log `autonomy_window.opened` / `autonomy_window.closed`.
- OpenWA owner tool `openwa_autonomy_window` `{ operation: open|close|list, issues: [identifier...], hours?, maxAccepts?, idempotencyKey }`, owner-run only (`assertOpenwaConfigOwnerRun`), attributed to the owner's user.
- Request confirmation payload gains optional `destructive: boolean` in `packages/shared` validators; only `false` makes a card eligible. The paperclip skill tells agents to declare it on every confirmation.

### UI

- Issue page header: badge "Autonomy window until HH:MM" on issues inside a live window, with Close for board users.
- An accepted-by-window card shows "Accepted by autonomy window (Zhafron, until HH:MM)" instead of a user name.

### Agents

- Wira AGENTS.md: on "full otonom", call `openwa_autonomy_window open` for the named roots (and write the marker); on "udah bangun", close it.
- Paperclip skill: declare `destructive` on every confirmation; inside a window `destructive: false` cards come back accepted.

## Acceptance criteria

1. With a live window on root R, a confirmation with `destructive: false` created on a descendant of R is accepted within the create request, audited with the window id, and the agent is woken when the card's continuation policy asks for it.
2. The same card on an issue outside R stays pending.
3. Questions, verdicts, checkbox confirmations, suggested tasks, tool-action, secret-proposal, OpenWA approval cards, review verdicts, and confirmations with `destructive: true` or without `destructive: false` stay pending inside R.
4. After expiry or close, new cards stay pending; the cap stops auto-accepts after N.
5. Only an owner-class OpenWA run or a board user can open or close a window; a member-triggered run gets `owner_only`.
6. Activity log shows open, close, and every auto-accept with the window id.

## Not doing

Company-wide autonomy, auto-answering questions, auto-approving `approvals` rows, changing deploy/destructive rules in AGENTS.md.
