# Performance, search and mobile round

Status: approved by owner (2026-10-08)
Owner: Zhafron

## Problems (measured on prod, 831 issues, 1,812 runs / 261 MB)

1. Issue pages feel heavy: comments 387 ms (secret-redaction lookup seq-scans every run snapshot), runs 701 ms polled every 5 s, cost-summary 200 ms, activity 591 KB for a busy issue, queued-comments polled every 1-3 s at ~350 ms each.
2. Every page pays the inbox badge: a full-view 500-row list (507 KB, 124 ms) plus heartbeat-runs 200 (318 KB, 261 ms).
3. Every issue activity event refetches every loaded issue list (Inbox 1.17 MB, Tasks all pages).
4. Tasks list: scrolling to the bottom loads a page and the view jumps up, because the render budget resets to 100 rows whenever the merged list order changes (IssuesList.tsx:1572-1586) - on next-page loads (server sorts by last activity, client by updatedAt) and on live refetches.
5. Search returns too much: every term may match title, description, any comment or any document; the system `continuation-summary` document (481 of 543 issues) contains Status/Priority/agent names; the UI re-sorts results by updated time and hides the server ranking. `internal status` returns 101 tasks.
6. Mobile: the pending approval/question card has no height cap on mobile (1,398 px with details open) and the composer dock overflows above the screen when the keyboard opens; touch sizing makes the card taller than needed.

## Decisions

| # | Decision |
|---|----------|
| D1 | Plain search terms match title, identifier and description (GitLab default). Comments and documents only through `comment:`, `doc:` or `text:` (all fields). Terms are ANDed; quoted values are phrases. |
| D2 | Field tokens: `title:`, `id:` (exact identifier), `desc:`, `comment:`, `doc:`, `text:`. Filter tokens: `status:`, `priority:`, `assignee:`, `label:`, `project:`, `author:`, `updated:`, `is:open`/`is:closed`. |
| D3 | System documents (`continuation-summary`) are never searched. |
| D4 | While a search is active and the user has not picked a sort, results keep the server's relevance order. |
| D5 | One shared `ScopedSearchInput` (field dropdown on focus, removable pills, debounced) on Tasks, Inbox, command palette, agent work panel and the Search page. Filters go to the server instead of filtering a capped page client-side. |
| D6 | Mobile: interaction card capped at about 45% of the visible viewport with its own scroll; header and actions stay visible; card collapses to a one-row summary while the composer is focused or the visible height is below 500 px; top bar, status island and nav reserve hide while the keyboard is open; denser card spacing (36 px actions, 13 px card text). Editable text stays 16 px (iOS focus zoom). |
| D7 | Run output blobs stay in `heartbeat_runs` this round (no data migration). |

## Work

- Server performance: index-friendly secret-redaction lookup; UNION rewrites of `runsForIssue` and `issueTreeSummary` with supporting indexes; heartbeat-runs summary without context snapshots; activity details without heavy referenced-issue payloads plus `limit`; compact issue view truncates `description` to 280 chars with `descriptionTruncated`; `live-runs` latency explained and fixed.
- Server search: field-scoped terms, default field set, system-document exclusion, exact identifier, list filters `priority`, multi `labelId`, `createdByAgentId`, `createdByUserId`.
- UI performance: render budget no longer collapses on page append or reorder; virtualized Tasks list; live events update or invalidate only what changed; cheaper inbox badge; slower or event-driven pollers on the issue page.
- UI search: parser extension, `ScopedSearchInput`, wiring on all search surfaces, Inbox debounce, bounded palette list.
- Mobile: card cap and scroll, compact summary row, keyboard-aware dock, density tokens, DESIGN.md note.

## Acceptance

1. ZHA-379 page: comments, runs and cost-summary each under 60 ms server time on prod data; no 1-3 s poll costing more than 20 ms.
2. Tasks: scrolling through all pages never moves the scroll position up; live updates while scrolled do not jump.
3. `internal status` on Tasks returns the title and description matches with ZHA-9 first; `title:"internal status"` returns one; `comment:` finds comment-only matches; `status:done` works server-side.
4. iPhone 390x844: a pending card with long details never exceeds ~45% of the visible height and Approve stays visible; with the keyboard open the card header and composer are both on screen.
5. Every list and page keeps its current data (no missing fields consumers rely on).
