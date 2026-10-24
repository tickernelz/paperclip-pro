# Activity redesign and web terminal

Date: 2026-10-24. Status: planned, awaiting approval. Both features ship in one release.

## Decisions (from the interview)

| Topic | Decision |
|---|---|
| Activity unit | The three newest activity rows inside the active run |
| Open depth | Full: thought text, tool code, and tool output, with no click |
| Older rows | One "+N earlier" button above the open rows; clicking it shows the existing one-line list |
| Finished runs | Collapse to the summary and final reply automatically |
| Shell backend | Both: local shell on the paperclip-pro host by default, SSH to a registered environment as a choice |
| Access | Human board session only; agent API keys refused, including company-owner agents |
| Exposure | Available in private and public deployments, login only |
| Features (v1) | Inline images, persistent sessions, multi-tab and split, clickable links with copy/paste and search, WebGL rendering, file upload and download |
| Drawer cwd | Opens in the task's execution workspace |
| Session life | Lives until closed; killed after 24 hours with no attached client; dies on service restart |
| Order | Built in parallel, released together |

## Recorded risk

Public exposure with login-only access means any valid board session is a shell as the service user on this host. The user accepted this explicitly on 2026-10-24 after the risk was stated, and chose no extra safeguards. Every open and close is still written to the activity log, because the repo requires an activity entry for every mutating action.

## Part A: Activity redesign

### Current behaviour (mapped)

- Group disclosure and row disclosure are two `useTaskChatExpansion` calls sharing one `Map` in a `useRef` at `ui/src/components/TaskChatThread.tsx:2893`. The map is not keyed by issue, so state leaks across issue switches.
- `TaskChatRunnerActivityGroup` (`ui/src/components/task-chat/TaskChatRunnerActivityGroup.tsx:308-405`) is always rendered with `defaultExpanded` omitted, so it starts collapsed.
- The row detail unmounts on collapse (`:296-303`), losing scroll and inner state.
- Phase keys embed the anchor row (`transcript-adapter.ts:1771`); a mid-turn phase split mints a new key and silently collapses the group again. This is the most likely source of the reported "buggy" behaviour.

### Change

1. Render the active run's phase as: a "+N earlier" control, then the three newest rows fully expanded.
2. Drive open state from position, not from the expansion map: a row is open when it is one of the newest three in a running turn. A click still overrides it, keyed by the row's stable activity id rather than the phase anchor, so a phase split cannot collapse it.
3. Keep open detail panels mounted and hidden instead of unmounting them, so long output keeps its scroll.
4. On run completion, collapse to summary and final reply.
5. Key the expansion memory by issue id so state does not leak between issues.
6. Remove the second convention in `TaskChatActivityPhase.tsx` only if nothing else renders it; otherwise leave it.

### Verification

- Unit: a running turn with 18 rows renders exactly three expanded rows and a "+15 earlier" control.
- Unit: a phase split mid-turn keeps the three newest rows open.
- Unit: a finished run renders collapsed.
- Browser proof on a live run in the instance.

## Part B: Web terminal

### Reuse (mapped)

- xterm v6 client pattern: `ui/src/pages/CompanyEnvironments.tsx:474-712`.
- Token-mint then auth-over-socket handshake: `server/src/routes/environments.ts:825-888`, store `server/src/services/environment-custom-image-terminal-sessions.ts`.
- SSH shell: `server/src/realtime/environment-custom-image-terminal-ws.ts:364-481` (`ssh2`).
- Cooperative upgrade chain via `req.paperclipWebSocketHandled`, registered in `server/src/index.ts:998-1010`.
- Strict board gate: `assertCanAccessInstanceEnvironments` pattern at `environments.ts:353-357`.
- Task cwd: `execution_workspaces.providerRef ?? cwd` (`execution-workspaces.ts:535`), never `row.cwd` alone for `git_worktree`.

### Backend

1. PTY: `@lydell/node-pty` (ships linux-x64/arm64 binaries as optional dependencies, no install script). `node-pty` 1.1.0 has no Linux prebuild and needs a script that npm 12 blocks.
2. Session manager (server-scoped, in-memory): create, attach, detach, resize, write, kill. Each session keeps a bounded scrollback ring buffer so a reattach replays the screen. Idle reaper kills sessions with no attached client for 24 hours. All sessions die with the process.
3. Routes, all behind the strict board gate plus company access and an activity-log entry:
   - `POST /api/companies/:companyId/terminal/sessions` (kind `local` | `ssh`, optional `issueId` for workspace cwd, optional `environmentId` for SSH)
   - `GET /api/companies/:companyId/terminal/sessions`
   - `DELETE /api/companies/:companyId/terminal/sessions/:id`
   - `POST /api/companies/:companyId/terminal/sessions/:id/token` (short-lived attach token)
   - `POST /api/companies/:companyId/terminal/sessions/:id/upload` and `GET .../download?path=`
4. WebSocket `/api/terminal/ws`: path match, then `{type:"auth", token}` within 10 s, then `input` / `resize` / `output` frames. Honour `paperclipWebSocketHandled`.
5. Add the new token path to the runner/agent metadata denylist (`runner-api-policy.ts:19`).
6. Contracts: shared types and validators in `packages/shared`, OpenAPI regenerated, server routes, UI client, per AGENTS.md.

### Frontend

1. Reusable `TerminalView` component: xterm v6 plus addons fit, webgl (with canvas fallback), web-links, search, clipboard, and image (Sixel and iTerm2 inline images).
2. Page `/terminal` with a tab bar and split panes; sidebar entry next to Workspaces.
3. Task drawer: a `terminal` payload kind in `task-side-panel-state.ts` (union, factory, `parsePayload`), a launcher entry in `TaskSidePanel.tsx:574-660`, and a `TaskTerminalPanel` kept mounted-hidden like browser tabs (`:846-850`).
4. Upload by drag-and-drop onto the terminal; download by path.
5. Reconnect with backoff; on reattach the server replays the ring buffer.

### Verification

- Server: board session can create, attach, write, resize, and kill; an agent API key and a company-owner agent get 403; a cross-company session id gets 404; idle reaper kills after the window (fake clock); token reuse after expiry fails.
- Real pty smoke: echo round trip, resize reflected by `stty size`, Sixel image rendered in the browser.
- Browser proof: open from sidebar and from a task drawer (cwd equals the task workspace), split, reload and reattach to the same screen.

## Release

Both parts land on one branch, pass `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`, and `pnpm check:token-gates`, then release through `scripts/release.sh` and install.
