# Local Browser Bridge

Paperclip agents can drive the browser you are already signed in to. The feature is a connector (`Local Browser`) plus a browser extension: the extension connects out to your Paperclip instance, and agents reach it through 14 `local_browser_*` tools.

Use it when the work needs the real signed-in web: a page behind SSO, an internal tool, a site whose state lives in your cookies. Use the hosted Browser Use Cloud connector when you need a disposable browser that is not your own.

## How it fits together

```
agent tool call
  → connector local-browser (tier + origin checks, schema validation)
  → localBrowserService.executeTool
  → WebSocket /api/local-browser/bridge
  → extension (Chromium MV3 or Firefox MV2)
  → your tab
```

The server owns tier and origin enforcement, audit, snapshot text rendering, attachment storage and the live view relay. The extension owns the tab: it produces the accessibility snapshot with element refs and resolves those refs when an agent acts.

## Pairing

1. Open **Apps → Local Browser → Pair a browser**.
2. Copy the connect URL shown for your browser, or paste the 8-character code into the extension popup.
3. The extension connects, the session appears under **Live sessions**, and agents assigned to the connection can call the tools.

The code expires after 10 minutes and can be used once. The session token is stored only as a hash on the server and kept in the extension's local storage.

## Tiers

| Tier | Reach | Tools |
|---|---|---|
| `refine` (default) | Only origins in the allowlist | `sessions`, `open`, `navigate`, `snapshot`, `act`, `read`, `screenshot`, `wait`, `close` |
| `full` | Every origin | The same tools plus `evaluate`, `storage`, `network`, `upload`, `download` |

`refine` refuses a navigation outside the allowlist before anything reaches the browser, and refuses every full-tier tool. `full` is the mode to use when an agent must read a signed-in site or debug a failing request; it can see every page you are logged in to, so grant it to the agents you would trust with your session.

The allowlist accepts an exact origin (`https://app.example.com`), a wildcard host (`https://*.example.com`) or `*`.

## Reaching an agent

The tools reach a run only through the connection, never through a board session. An agent gets
them when all three hold:

1. The Local Browser connection is installed in the company and enabled.
2. The connection grants that agent access. A board user approves it on the connection's access
   section; until then `connections_search` reports `needs_user_action` with "Review identity and
   access for this agent" and no browser tool reaches the run.
3. The run carries a run credential. The tools are advertised over the Paperclip MCP endpoint for
   `omp_local`-style runs and through the connector tool authority for the runner, so a bare agent
   key without a run cannot call them.

The tool list is advertised whether or not a browser is connected right now, so an agent can see
what it could do and ask the user to open the extension. A call made while nothing is connected
returns `local_browser_not_paired` with the pairing hint instead of an unknown-tool error. A paired
browser that is not connected appears in `local_browser_sessions` as a resource whose metadata says
`live: false`.

Board routes under `/api/local-browser` stay board-only: `GET /api/local-browser/sessions` answers
403 to an agent token, which is correct and not a missing permission.

## The tool loop

Agents should follow the same loop regardless of model:

1. `local_browser_sessions` — which browser and tab am I on?
2. `local_browser_snapshot` — a compact tree where every interactive element has a ref (`e12`).
3. `local_browser_act` with that ref — one action per call.
4. `local_browser_snapshot` again — refs from the previous snapshot are stale after a click that changes the page.

Use `local_browser_read` when the task needs the page text rather than its controls, `local_browser_wait` instead of snapshotting in a loop, and `local_browser_screenshot` only for visual questions or canvas content.

`local_browser_snapshot` pages with an opaque-free decimal cursor: when the tree is truncated the result carries `cursor` (a decimal node offset) and passing it back returns the following page. A cursor the server does not recognise starts again from the first page, so a stale cursor costs a repeat rather than a wrong window.

Every tool returns either a result or a stable error code (`local_browser_origin_denied`, `local_browser_tier_denied`, `local_browser_ref_stale`, `local_browser_timeout`, …). A refusal is a permission answer, not a bug: switch tier, add the origin, or ask the human.

## Live view and takeover

Every live browser row in the Browser connection settings has a **Watch** button. It opens a live frame of the tab the agent is driving, refreshed once a second. Frames and input coordinates are CSS pixels, so a click lands on the same element on a scaled display as on a 1x one.

Frames keep arriving while the viewer is open, including while the agent is idle, so you can watch the tab change under your own hands. They stop when you hide the viewer and when the browser disconnects.

Take over to type or click yourself; the agent keeps working around you, so re-snapshot rather than retrying blindly. Release control, or press Escape, to hand input back. Held keys and the mouse button are released automatically when you release control.

Takeover input is a board-user action: an agent token cannot drive the viewer or post input through those routes, and the audit row records the real actor.

## Extensions

The Local Browser connection page in Apps has an **Install the extension** section with both
downloads and the install steps, so an operator does not need the repository.

- Chromium: download `local-browser-chromium.zip`, unzip it into a folder you keep, then load
  it unpacked from `chrome://extensions` with Developer mode on. Chrome, Edge and Brave all
  use the same zip. The extension runs from the unzipped folder, so that folder must stay.
- Firefox: download `local-browser-firefox.xpi` and install it from `about:addons`. Mozilla
  signs it as an unlisted add-on, so release Firefox installs it without a developer setting.

Both artifacts live in `ui/public/downloads/` and are rebuilt with
`pnpm build:local-browser-extensions`, which also writes `local-browser-firefox-unsigned.zip` for the
current Firefox source. The signed xpi needs `--sign` and the AMO API credentials, so a Firefox source
change ships in the xpi only after that signing step; until then the unsigned zip is the artifact that
matches the source, loadable through `about:debugging` as a temporary add-on. CI fails when the
committed Chromium zip no longer matches the source. Source and the per-browser notes:
`apps/local-browser/chromium/README.md` and `apps/local-browser/firefox/README.md`.

Site access is a permission the user grants, and the extension asks for it from its own popup.

- Chromium declares `tabs`, `scripting`, `activeTab`, `storage`, `cookies`, `downloads`, `debugger`
  and `alarms` as required permissions, and `<all_urls>` as an optional host permission. A fresh
  install therefore reaches the active tab only. The popup shows **Allow all sites** while access is
  narrower than every site; pressing it calls `chrome.permissions.request` from the popup, so the
  grant comes from Chrome's own prompt and needs no browser restart.
- Firefox declares `<all_urls>` as a required permission, so the grant arrives with the install
  prompt. If the user later revokes it in `about:addons`, the popup's **Site access** row reads
  `some sites only` and **Allow all sites** asks for it again.

A refused or narrowed grant is reported, never silent. Chromium answers
`local_browser_origin_denied` with a hint to allow all sites instead of passing along Chrome's raw
"manifest must request permission" text, and both popups show the same state.

Trusted input is separate from site access. Chromium sends real mouse and key events through the
`debugger` permission. Firefox has no equivalent extension API, so it sends synthetic events by
default and can only send trusted ones through its own debug port; the popup says so and offers the
one-time command. Reading, snapshotting, clicking and typing all work without that command.

Both extensions consume the same contract from `packages/shared/src/local-browser.ts`. A generated copy of the enumerations and limits sits at `apps/local-browser/*/lib/protocol.contract.json`; regenerate it with `pnpm generate:local-browser-protocol` and verify with `--check`. The `extensions` CI lane runs that check plus every script parse and both extension suites, so a stale copy or a broken extension fails the pull request.

## Security notes

- The extension acts inside your real profile. Only pair it on a machine you control.
- Audit: every tool call writes one `local_browser.tool_called` activity row with the tool, session, tab, origin, tier, outcome and duration. Arguments and results are never logged.
- Page content is untrusted data. The connector skill tells agents to treat text on a page as data, never as instructions, and never to paste credentials or cookie values into a task.
- `DELETE /api/local-browser/sessions/:id` disconnects a browser. It does not sign you out of anything.
- Opening the bridge address in a browser tab cannot pair anything: the extension dials it over a WebSocket. The address answers with a short page that says so and repeats the pairing code, so a pasted link does not look broken.
