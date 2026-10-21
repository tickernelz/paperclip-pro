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

- Chromium: `apps/local-browser/chromium/README.md` (load unpacked in Chrome, Edge or Brave).
- Firefox: `apps/local-browser/firefox/README.md` (temporary load, signing, WebDriver BiDi for trusted input).

Both extensions consume the same contract from `packages/shared/src/local-browser.ts`. A generated copy of the enumerations and limits sits at `apps/local-browser/*/lib/protocol.contract.json`; regenerate it with `pnpm generate:local-browser-protocol` and verify with `--check`. The `extensions` CI lane runs that check plus every script parse and both extension suites, so a stale copy or a broken extension fails the pull request.

## Security notes

- The extension acts inside your real profile. Only pair it on a machine you control.
- Audit: every tool call writes one `local_browser.tool_called` activity row with the tool, session, tab, origin, tier, outcome and duration. Arguments and results are never logged.
- Page content is untrusted data. The connector skill tells agents to treat text on a page as data, never as instructions, and never to paste credentials or cookie values into a task.
- `DELETE /api/local-browser/sessions/:id` disconnects a browser. It does not sign you out of anything.
