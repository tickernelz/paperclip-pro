# Public issue share links

Status: draft for owner approval (2026-10-07)
Owner: Zhafron

## Problem

External requesters (for example client members of a WhatsApp group served by the Wira agent) ask for work over chat and then have to ask again over chat to learn its progress. They have no Paperclip account and should not get one. They need a read-only view of the issue that tracks their request.

## Outcome

Any agent or board user can create a short public link for an issue. Anyone holding the link sees, without logging in, a read-only, mobile-friendly view of that issue and of the issues one hop away from it, with internal detail removed. The link works until it is revoked.

## Decisions (owner interview, 2026-10-07)

| # | Decision |
|---|----------|
| D1 | Read-only. External viewers cannot send follow-ups, comments, or files. |
| D2 | URL is `<publicBaseUrl>/s/<token>`; token is 10 random base62 characters (about 59.5 bits). No issue identifier in the URL. |
| D3 | One active link per issue. Creating a link for an issue that already has an active one returns the existing link. Valid until revoked; no automatic expiry. |
| D4 | Any agent may create a link through an agent tool, without owner approval. Board users create and revoke from the issue page. Create and revoke are written to the activity log. |
| D5 | The agent decides when to share (tool plus instructions); the server never appends links to replies on its own. |
| D6 | The page looks like the internal issue view, read-only. Run transcripts, tool calls, thinking and progress output are replaced by a static indicator such as "Wira is working…". |
| D7 | Agent comments are shown in full. Human internal comments are shown as a placeholder (author and time visible, body hidden) unless a board user marks that comment as public. System and automation comments are hidden. |
| D8 | Internal panels are not exposed: costs, budget, agent configuration, run ids, adapter overrides, execution policy, approvals, interactions, document annotations. |
| D9 | Related issues one hop from the shared issue (parent, children, blocked-by, blocks) are clickable, read-only, with the same rules. Navigation stops there: a related issue's own relations are listed without links. |
| D10 | Attachments, issue documents and file work products of visible content can be viewed and downloaded through token-scoped URLs. Revoking the link revokes those URLs. |

## Behaviour

### Token and link lifecycle

- Token: 10 characters from `[0-9A-Za-z]`, generated with `crypto.randomBytes` and rejection sampling. Stored in plaintext because board users must be able to copy the link again at any time; database read access already exposes the shared data itself.
- Resolution: `token` must exist, `revoked_at` must be null, the issue must exist, belong to the link's company, and not be hidden (`hidden_at` null). Any failure returns the same 404 body, with no hint of which check failed.
- Revoke sets `revoked_at` and the revoker. Creating again after a revoke issues a new token; the old one stays dead.
- Entropy note: `server/src/routes/access.ts` warns that short invite suffixes are online-enumerable. 59.5 bits with a per-IP rate limit (reusing the invite limiter pattern) keeps a guess-success probability negligible for the expected number of active links; the trade-off is accepted for a short URL.

### Public projection

A single public read endpoint returns a whitelisted projection; it never reuses an internal handler's response.

Issue fields: identifier, title, description (markdown), status, priority, created/updated/completed timestamps, assignee display name and avatar (agent or user), project name, parent/children/blocked-by/blocks summaries (identifier, title, status, and whether it is navigable), company name and logo, and `activeRun: { agentName, startedAt } | null`.

Comments, in timeline order:

| Comment | Public form |
|---------|-------------|
| `authorType = "agent"`, or a `user` comment with `derivedAuthorAgentId` (board key used by an agent run) | full body, author agent name and avatar, attachments |
| `authorType = "user"` with `public_share_visible = true` | full body, author name, attachments |
| `authorType = "user"` otherwise | placeholder: author name, timestamp, "internal update" label; no body, no attachments |
| `authorType = "system"`, `presentation.kind = "system_notice"`, soft-deleted | omitted |

Documents: key, title, latest body (markdown), updated time; annotations omitted.
Attachments: issue-level attachments plus those bound to shown comments; those bound to placeholder or omitted comments are excluded.
Work products: title, type, status, and an `http(s)` URL when present; file artifacts backed by an asset get a token-scoped download URL; workspace-file references and metadata are omitted.

### Run indicator

While the issue has an active run, the page shows a static pill "<agent name> is working…". No transcript data leaves the server. The page refetches every 15 s while the tab is visible and a run is active, otherwise on focus.

### Related issues

The one-hop set is computed from the shared issue: `parentId`, children by `parentId`, and `issue_relations` (`blocks`) in both directions, same company, not hidden. A related issue is requested by id under the token; ids outside the set return 404.

### Downloads

Token-scoped attachment, asset and document-PDF routes resolve the file only when it belongs to the shared issue or a one-hop issue and is visible under the comment rules above. They reuse the existing any-type serving headers verbatim: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` for non-inline-safe types, RFC 5987 `Content-Disposition`, range support.

### Response hardening

All public responses send `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and `Cache-Control: private, no-store` (downloads: `private, max-age=60`). The SPA page sets `<meta name="robots" content="noindex">`. Public routes are rate limited per IP like `/invites/:token`.

The deployment must expose the public hostname: with `exposure: private` the private-hostname guard blocks hosts outside `allowedHostnames` (prod already allows `paperclip.zhafron.my.id`).

## Interfaces

### Database (`packages/db`)

- New table `issue_share_links`: `id uuid pk`, `company_id fk`, `issue_id fk`, `token text unique`, `created_by_agent_id`, `created_by_user_id`, `created_by_run_id`, `created_at`, `revoked_at`, `revoked_by_agent_id`, `revoked_by_user_id`. Partial unique index on `(issue_id) where revoked_at is null`.
- New column `issue_comments.public_share_visible boolean not null default false`.
- One migration, numbered after the fork's current last migration.

### Shared (`packages/shared`)

Types and validators: `IssueShareLink`, `PublicIssueShareView`, `PublicIssueComment`, `PublicIssueRelatedIssue`, and the comment visibility update body.

### Server routes

| Method and path | Actor | Purpose |
|-----------------|-------|---------|
| `GET /api/issues/:id/share-link` | board or agent with issue read | current active link or null |
| `POST /api/issues/:id/share-link` | board, or agent allowed to mutate the issue | create or return the active link; `{ url, token, createdAt }` |
| `DELETE /api/issues/:id/share-link` | board, or agent allowed to mutate the issue | revoke |
| `PATCH /api/issues/:id/comments/:commentId/public-share` | board only | set `public_share_visible` on a user comment |
| `GET /api/public/share/:token` | none | projection of the shared issue |
| `GET /api/public/share/:token/issues/:issueId` | none | projection of a one-hop issue (relations not navigable) |
| `GET /api/public/share/:token/attachments/:attachmentId/content` | none | download |
| `GET /api/public/share/:token/assets/:assetId/content` | none | work-product file download |
| `GET /api/public/share/:token/issues/:issueId/documents/:key/pdf` | none | document PDF |

Mutations follow the `POST /issues/:id/work-products` pattern (validate, company access, `assertAgentIssueMutationAllowed`, actor info) and write `issue.share_link_created`, `issue.share_link_revoked`, `issue.comment_public_share_updated` to the activity log. Routes are registered in `server/src/routes/openapi.ts`; `packages/mcp-server/src/generated/api-tools.json` is regenerated so agents get `create/get/revoke share link` tools.

### UI

- Route `s/:token` in the gate-free block of `ui/src/App.tsx`, page `PublicIssueSharePage` fed only by the public endpoint. It reuses the leaf presentational components of the issue view (markdown body, status and priority badges, comment bubble, attachment list, document view) rather than `IssueDetail.tsx`, whose ~70 self-fetching queries would otherwise all need a read-only data seam. Mobile-first layout. Token-only design rules from `DESIGN.md` apply.
- Issue page header: Share control (create, copy link, revoke) for board users.
- Comment menu on user comments: "Show on public link" toggle for board users; a badge marks public comments.

### Agent instructions

- `skills/paperclip/SKILL.md`: share-link tools in Hot Routes; rule: share a link when an external requester asked for work tracked in an issue; anything written in a shared issue's agent comments is public.
- OpenWA conversation instructions: after creating an issue for a chat request, the agent may send its share link to the requester.

## Acceptance criteria

1. An agent call to create a share link returns `<publicBaseUrl>/s/<10 base62 chars>`; a second call returns the same URL; both create an activity entry only on the first call.
2. Opening the URL in a logged-out browser shows the issue title, status, description, agent comments, placeholders for human comments, documents, and attachments; system comments and transcripts are absent from both the page and the JSON response.
3. A board user toggling "Show on public link" on a human comment makes its body and attachments appear on reload; toggling off hides them again.
4. While a run is active the page shows "<agent> is working…" and no transcript content; it disappears after the run ends without a manual reload.
5. Parent, children, blocked-by and blocks issues are clickable; a two-hop issue id requested under the token returns 404.
6. Downloads of visible attachments work; attachments of placeholder comments return 404; active content types are served as attachments with `nosniff` and the sandbox CSP.
7. After revoke, the page, related issues, and every download URL return 404; a new link has a different token.
8. Hidden issues, unknown tokens, and revoked tokens return the same 404 body.
9. Public responses carry `noindex`, `no-referrer`, `no-store`; the per-IP rate limit returns 429 when exceeded.
10. No internal field listed in D8 appears in any public JSON response.
11. Live: Wira shares a link for a real chat-requested issue, and the link opens on a phone without login.

## Verification

- Targeted server tests: projection rules (each comment row of the table), one-hop enforcement, revoke and hidden 404s, download visibility and headers, create idempotency and activity log, board-only comment toggle, rate limit.
- UI component test for the placeholder and run indicator.
- Full suite, recursive typecheck, build and Playwright run on GitHub CI only.
- Smoke on a throwaway instance: create a link with an agent key, open it in a logged-out mobile-viewport browser, screenshot, revoke, confirm 404.
- Live on prod after owner go: AC 11.

## Not doing

- External follow-ups, comments, approvals or uploads (D1).
- Per-viewer links, viewer identity, view analytics.
- Expiring links, password-protected links.
- Sharing projects, goals, or whole companies.
- Search-engine indexing or link previews with issue content.
