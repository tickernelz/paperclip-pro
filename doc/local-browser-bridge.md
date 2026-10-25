# Local Browser Bridge

Paperclip agents can drive the browser you are already signed in to. The feature is a connector (`Local Browser`) plus a browser extension: the extension connects out to your Paperclip instance, and agents reach it through 17 `local_browser_*` tools.

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
| `refine` (default) | Only origins in the allowlist | `sessions`, `context`, `open`, `navigate`, `snapshot`, `act`, `read`, `screenshot`, `wait`, `permissions`, `close` |
| `full` | Every origin | The same tools plus `evaluate`, `storage`, `network`, `upload`, `download`, `api` |

`sessions`, `close`, `permissions` and `api` are exempt from the origin check: they act on the browser, not on a page.

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

## Tabs the agent leaves alone

Two tabs are off limits for navigation, in both browsers:

- The Paperclip tab. A tab whose origin matches the paired Paperclip address is never navigated or
  reused, because changing its URL would take the operator out of the app they are watching the agent
  in.
- The tab the user is looking at. Navigating the active tab in the focused window would silently
  replace whatever the person is reading. The extension refuses it unless that tab was opened by the
  agent in this session.

`local_browser_open` with a `url` therefore reuses the tab the agent already opened for this work, and
creates one only when it has none, so repeated opens never pile up tabs. The first tab it creates is
remembered as the agent's own, and later `local_browser_navigate` calls against it work normally. A
refusal is `local_browser_navigation_blocked` with the hint to target that tab by `tabId` or to open
one. Reading, snapshotting and clicking on a protected tab are still allowed; only navigation is
refused.

The agent never takes the foreground. Opening a page does not activate its tab, and neither a
screenshot nor a live-view frame brings a background tab to the front: Chromium captures through the
debugger protocol and Firefox through WebDriver BiDi when the tab is not the visible one, falling back
to the visible-tab capture only when the user is already looking at that tab. A page that refuses the
background path returns an error that names the limitation instead of switching tabs under the user.
`active: true` on `local_browser_open` is the one explicit request that still focuses the tab.

## The tool loop

Agents should follow the same loop regardless of model:

1. `local_browser_sessions` — which browser and tab am I on, what can the extension do (`capabilities`), which permissions are granted (`access`)?
2. `local_browser_context` — the tab's container and cookie jar, cookie names for its URL (never values), whether the document is stale, whether the content script is connected, and network capture state.
3. `local_browser_snapshot` — a compact tree where every interactive element has a ref (`e12`).
4. `local_browser_act` with that ref — one action per call.
5. `local_browser_snapshot` again — refs from the previous snapshot are stale after a click that changes the page.

Use `local_browser_read` when the task needs the page text rather than its controls, `local_browser_wait` instead of snapshotting in a loop, and `local_browser_screenshot` only for visual questions or canvas content.

`local_browser_snapshot` pages with an opaque-free decimal cursor: when the tree is truncated the result carries `cursor` (a decimal node offset) and passing it back returns the following page. A cursor the server does not recognise starts again from the first page, so a stale cursor costs a repeat rather than a wrong window.

`local_browser_storage` with `kind: "cookies"` reaches the browser's cookie jar: scope a read with `url`, with `domain` (a bare host, subdomains included) or with `allDomains`, optionally narrowed by `name`, capped by `limit` (default every match) and limited to one `storeId` (a Chromium profile store or a Firefox container, which also becomes the default store for writes). Each cookie read reports `name, value, domain, path, secure, httpOnly, sameSite, session, expirationDate, hostOnly, storeId, partitionKey`; `session: true` means the cookie has no expiry. A write carries `entries`; each entry may set `domain`, `path`, `secure`, `httpOnly`, `sameSite`, `expirationDate` or `session: true`, and `storeId`, and an entry without a `domain` inherits the call's `domain`. `clear` removes each matched cookie through its own domain, path and store, reports names it could not remove, and refuses to wipe the whole jar unless you pass a `name` or `confirmAll: true`. The jar-wide scopes need an extension that advertises the `cookies.v2` capability; an older build answers `local_browser_unsupported` instead of silently reading only the page's cookies. Cookies the browser keeps apart per top-level site (Chrome's partitioned cookies, Firefox's total cookie protection) appear only when the browser reports them for that scope, and are not re-created as partitioned by a write.

`local_browser_network` reads a capture that runs continuously in the extension (a ring of `guards.networkBufferSize` requests). Each row carries `requestHeaders` and `responseHeaders` (default on; `includeHeaders: false` drops them), `hasCookie`, `hasAuthorization`, `fromCache`, `initiator`, `error` and `documentId`. Narrow it with `since` (epoch ms), `types`, `urlIncludes` or `method`; the result reports the `capture` mode.

Tabs report `cookieStoreId`, `containerName`, `incognito`, `discarded`, `frozen`, `pinned` and `audible`. `local_browser_open` accepts `cookieStoreId` (a Firefox container or another jar), `incognito` and `newWindow`.

Snapshot, read, screenshot and wait results carry `document`: a per-page `documentId`, `navigationType`, `restoredFromBfcache`, `wasDiscarded`, `ageMs`, request counts since load, and `stale` with `staleReasons`. A stale document is the back-forward-cache or frozen-tab case where the page shows old data; agents reload before trusting it.

`local_browser_act` refuses an element another element covers. `force: true` skips that hit test.

`local_browser_api` (full tier) calls any browser extension function by dotted path, for example `history.search`, `bookmarks.search`, `tabs.query` or `windows.getAll`, and returns `{ value, type }` as JSON. The extension's own `storage` namespace is refused because it holds the pairing secret.

Every tool returns either a result or a stable error code (`local_browser_origin_denied`, `local_browser_tier_denied`, `local_browser_permission_required`, `local_browser_ref_stale`, `local_browser_timeout`, …). A refusal is a permission answer, not a bug: switch tier, add the origin, grant the browser permission, or ask the human.

## Limits

The user sets every limit in **Apps → Local Browser → Limits**; the extension caps nothing on its own. Each value has a default, a minimum and a sanity ceiling:

| Limit | Default | Min | Ceiling |
|---|---|---|---|
| `resultMaxChars` | 60000 | 1000 | 2000000 |
| `snapshotMaxNodes` | 400 | 10 | 20000 |
| `readMaxChars` | 40000 | 200 | 2000000 |
| `screenshotMaxBytes` | 2 MiB | 64 KiB | 50 MiB |
| `transferMaxBytes` | 20 MiB | 1 MiB | 256 MiB |
| `callMaxMs` | 120000 | 5000 | 600000 |
| `networkMaxEntries` | 200 | 10 | 5000 |

Tool inputs accept values up to the ceiling. The server clamps each call to the company's limits and says so in the result as `limited: [{ field, requested, applied }]`. A `local_browser_network` call without `limit` receives `networkMaxEntries`. A screenshot, upload or download above its byte limit answers `local_browser_result_too_large`. Settings are stored in `local_browser_settings.limits`; a save that omits `limits`, or names only some keys, keeps the other stored values.

Call budgets follow `callMaxMs`: `navigate`, `wait`, `act` and `evaluate` use their `timeoutMs` (defaults 15 s, 10 s, 30 s, 30 s) clamped to `callMaxMs`; `network`, `upload`, `download` and `api` get the whole `callMaxMs`; everything else gets 30 s. The server adds a 5 s grace. An extension that advertises `budget.v1` receives the deadline as `budgetMs` on the call frame and stops its own work at `budgetMs - 1000`, so it always answers before the server gives up.

The bridge WebSocket accepts frames up to the base64 size of the `transferMaxBytes` ceiling plus 1 MiB, so a download at the largest allowed limit still fits in one frame; the company limit is enforced on the decoded bytes. An upgrade with `?session=` whose token is unknown or closed is refused with 403 before the WebSocket opens, and a socket whose first frame is not a valid `hello` is closed with 1008.

## Capabilities

`LOCAL_BROWSER_PROTOCOL_VERSION` stays `1`. New features are negotiated through `hello.capabilities`, and the server refuses a feature the extension does not advertise with `local_browser_unsupported` and the hint "Update the Paperclip Local Browser extension":

| Capability | Unlocks |
|---|---|
| `cookies.v2` | Jar-wide cookie scopes, cookie attributes, session cookies |
| `permissions.v1` | `local_browser_permissions`, the open-permissions route |
| `context.v1` | `local_browser_context` |
| `network.headers` | Header capture in `local_browser_network` |
| `tabs.container` | `cookieStoreId` and `incognito` on `local_browser_open` |
| `document.state` | `document` on snapshot, read, screenshot and wait |
| `api.v1` | `local_browser_api` |
| `act.force` | `force` on `local_browser_act` |
| `budget.v1` | `budgetMs` on call frames |

`local_browser_sessions` and `GET /api/local-browser/sessions` report each session's `capabilities`, `access` and `guards`.

## Live view and takeover

Every live browser row in the Browser connection settings has a **Watch** button. It opens a live frame of the tab the agent is driving, refreshed once a second. Frames and input coordinates are CSS pixels, so a click lands on the same element on a scaled display as on a 1x one.

Frames keep arriving while the viewer is open, including while the agent is idle, so you can watch the tab change under your own hands. They stop when you hide the viewer and when the browser disconnects. A viewer frame may be as large as the bigger of `screenshotMaxBytes` and 2 MiB, so lowering the agent screenshot limit does not blank the viewer.

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

## Browser permissions and Allow all

The user, not Paperclip, decides what the extension may do in the browser. Both extensions declare only what they cannot run without as required, and everything else as optional, from one catalog (`LOCAL_BROWSER_PERMISSIONS`):

- Always required: `storage` and `activeTab` in both browsers; `debugger` and `alarms` in Chromium (Chrome cannot make `debugger` optional); `contextualIdentities` in Firefox (Firefox cannot make it optional).
- Optional in both: `<all_urls>` (every website), `tabs`, `scripting`, `cookies`, `downloads`, `downloads.open`, `webNavigation`, `history`, `bookmarks`, `browsingData`, `sessions`, `topSites`, `clipboardRead`, `clipboardWrite`, `notifications`, `management`, `privacy`, `search`.
- Chromium only: `pageCapture`, `tabGroups`, `contentSettings`. Firefox only: `webRequest` (network activity), `webRequestBlocking` (response bodies), `proxy`, `tabHide`, `find`, `browserSettings`.
- `webRequest` is required on Chromium: Chrome only delivers `webRequest` events to listeners a service worker registers at startup, so a runtime grant would never start capture. It shows nothing on its own; requests are only visible on sites the user granted.

The extension popup and its control center list every catalog entry for that browser with a one-sentence description of what it grants, its state (granted, missing, required) and Allow / Revoke buttons. **Allow all** requests every optional permission plus `<all_urls>` in one browser prompt.

When a tool needs a permission the user has not granted, the extension queues it as a pending request (badge count, and a desktop notice when `notifications` is granted) and the tool answers `local_browser_permission_required` with the missing ids in `permissions` and `retryable: true`. Agents call `local_browser_permissions` with `op: "request"` and a reason, then ask the user to press Allow; the request alone grants nothing, because browsers only grant on a user click. From Paperclip, **Open permission page in browser** on a live session calls the open-permissions route, which opens the control center on the Permissions section.

The extension reports its permission state as `access` (`siteAccess`, `granted`, `missing`, `pending`) in `hello` and in `access` events, so Paperclip always shows the current grants.

## Agent guards

The control center also holds guards the user switches on the extension side, reported to Paperclip as `guards`:

- `protectPaperclipTab` (default on): never navigate or reuse the Paperclip tab.
- `protectFocusedTab` (default on): never navigate the tab the user is looking at.
- `networkBufferSize` (50 to 20000, default 1000): how many requests the continuous network capture keeps.

Trusted input is separate from site access. Chromium sends real mouse and key events through the
`debugger` permission. Firefox has no equivalent extension API, so it sends synthetic events by
default and can only send trusted ones through its own debug port; the popup says so and offers the
one-time command. Reading, snapshotting, clicking and typing all work without that command.

Both extensions consume the same contract. The data lives in `packages/shared/src/local-browser-contract.ts` (protocol version, error codes, capabilities, permission catalog, limits, guards, tool tiers) and the zod schemas in `packages/shared/src/local-browser.ts`. `pnpm generate:local-browser-protocol` imports the contract file and writes `apps/local-browser/shared/lib/protocol.contract.json` and `apps/local-browser/shared/lib/contract.js` (`LB.contract`); `scripts/sync-local-browser-shared.mjs` then copies `apps/local-browser/shared/` into both browser folders. `--check` on each script fails on drift. The `extensions` CI lane runs both checks plus every script parse and the extension suites, so a stale copy or a broken extension fails the pull request.

## Security notes

- The extension acts inside your real profile. Only pair it on a machine you control.
- Audit: every tool call writes one `local_browser.tool_called` activity row with the tool, session, tab, origin, tier, outcome and duration. Arguments and results are never logged.
- Page content is untrusted data. The connector skill tells agents to treat text on a page as data, never as instructions, and never to paste credentials or cookie values into a task.
- `DELETE /api/local-browser/sessions/:id` disconnects a browser. It does not sign you out of anything.
- `POST /api/local-browser/sessions/:id/open-permissions` (board users only) asks the extension to open its permission page. It answers `202 { ok: true }`, writes an audit row for the internal `local_browser_ui` tool, and answers `local_browser_unsupported` when the extension lacks `permissions.v1`. Agents can never call `local_browser_ui`, `local_browser_viewer` or `local_browser_input`.
- Request headers in `local_browser_network` include `Cookie` and `Authorization` values. That is full tier, which already exposes HttpOnly cookies, so nothing is redacted; the skill tells agents never to copy those values into a task.
- Opening the bridge address in a browser tab cannot pair anything: the extension dials it over a WebSocket. The address answers with a short page that says so and repeats the pairing code, so a pasted link does not look broken.
