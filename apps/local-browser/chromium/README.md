# Paperclip Local Browser Bridge — Chromium extension

Manifest V3 extension for Chrome, Edge and Brave. It connects out to a paired Paperclip
server over a WebSocket and lets an agent read and drive the user's real tabs. There is no
build step and no bundler: the folder is loaded unpacked exactly as it sits in this repo.

## Load unpacked

Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder: `apps/local-browser/chromium`.
4. Pin the extension from the puzzle-piece menu so the popup is one click away.

Edge:

1. Open `edge://extensions`.
2. Turn on **Developer mode** (left sidebar).
3. Click **Load unpacked** and pick `apps/local-browser/chromium`.

Brave:

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick `apps/local-browser/chromium`.

After an update to the files, press the reload arrow on the extension card. Reloading the
extension keeps the pairing: the session token lives in `chrome.storage.local`.

Requires Chrome 116 or newer (WebSocket activity keeps the MV3 service worker alive). Tabs report `frozen` from Chrome 132.

## Pairing

1. In Paperclip, open the Local Browser page and start a pairing. The page shows a pairing
   link that carries the server address and an 8-character code.
2. Click the extension icon. The popup offers the link it finds on the active Paperclip tab;
   otherwise paste the link (or just the code when the server is already known) and press
   **Pair**. The popup turns green when the bridge answers `hello_ack`; from then on the
   extension reconnects with `?session=<token>` and keeps the token across restarts.
3. Pairing codes expire after 10 minutes. If the code expired, start a new pairing.

**Disconnect** forgets the token on this device. The browser stays signed in to every site;
only the Paperclip link is removed. **Reconnect** re-opens the socket with the stored token.

The popup (`ui/popup.html`) and the control center (`ui/control.html`, also the options page)
are shared with Firefox and live in `apps/local-browser/shared/ui`. They talk to the service
worker over `runtime.sendMessage({channel: "lb-control", op})` with the ops `status`, `pair`,
`detect`, `reconnect`, `disconnect`, `guards.set` and `pending.clear`; the worker broadcasts
`{channel: "lb-status", status}` on every connection, permission or guard change. The
control center opens on install, and again after an update while site access is not "all".

## Permissions

The user decides what agents may do. Only what Chrome cannot make optional is required;
everything else is requested from the control center, one by one or with **Allow all**,
which asks for every optional permission plus site access in one browser prompt.

| Permission | Kind | Why it is needed |
| --- | --- | --- |
| `debugger` | required | Trusted input, background-tab and full-page screenshots, the network window fallback and response bodies. Chrome cannot make it optional. |
| `storage` | required | The pairing entry, agent guards and the pending permission list in `chrome.storage.local`. |
| `alarms` | required | A 30-second heartbeat that re-opens the socket after the service worker is suspended. |
| `activeTab` | required | Touch the tab the user is looking at without a site grant. |
| `webRequest` | required | Continuous network capture. Chrome only delivers `webRequest` events to listeners registered when the service worker starts, so a runtime grant could never start capture. It sees nothing until the user grants site access. |
| `<all_urls>` | optional host | Read and drive any site; `captureVisibleTab`, content scripts and cookie access need it. |
| `scripting`, `tabs`, `cookies`, `downloads`, `downloads.open`, `webNavigation`, `history`, `bookmarks`, `browsingData`, `sessions`, `topSites`, `clipboardRead`, `clipboardWrite`, `notifications`, `management`, `privacy`, `search`, `pageCapture`, `tabGroups`, `contentSettings` | optional | Exactly the catalog's `chromium: optional` ids (`LOCAL_BROWSER_PERMISSIONS`); `background/manifest.test.mjs` fails when the manifest drifts from the catalog. |

Every tool checks what it needs with `LB.access.ensure` before touching the browser: page tools
need `<all_urls>` and `scripting`, cookies need `cookies` (plus `<all_urls>` for `domain` or
`allDomains`), downloads need `downloads`. A missing permission fails the call with
`local_browser_permission_required` (retryable, `permissions` lists the ids), queues the request
in `lb.pending`, paints the badge with the pending count and, when `notifications` is granted,
shows a notification that opens the control center. Agents can also queue requests themselves
with `local_browser_permissions op:"request"`.

Agent guards are the user's own switches, kept in `lb.guards` and edited in the control center:
`protectPaperclipTab` (never navigate the Paperclip tab), `protectFocusedTab` (never navigate the
tab the user is looking at unless the agent opened it) and `networkBufferSize` (the continuous
network ring, 50 to 20000 requests). Changes are sent to the server as `guards` events.

The extension never logs page content, cookie values or the session token to the console.

## What each tool does

The service worker is `background/index.js`, a module worker that imports the shared layer
(`lib/contract.js`, `ext-api`, `access`, `guards`, `headers`, `api-call`, `pairing`) and then
the browser modules in `background/`: `core` (errors, helpers, content-script list), `cdp`
(one debugger attachment per tab shared by input, captures and network), `tabs`, `network`,
`cookies`, `input`, `screenshot`, `viewer`, `downloads`, `tools` (tool registry and permission
requirements), `bridge` (socket, pairing, `lb-control`, events) and `boot` (listeners).

| Tool | Implementation |
| --- | --- |
| `local_browser_sessions` | `chrome.tabs.query`; each tab carries `cookieStoreId` (from `chrome.cookies.getAllCookieStores`, else `0`/`1` by incognito), `incognito`, `discarded`, `pinned`, `audible` and `frozen` (Chrome 132+), plus a one-entry `sessions` array. |
| `local_browser_open` | Reuses the agent's own tab or creates one, waits for load, returns the tab and a first-page snapshot. `newWindow` opens `chrome.windows.create`; `incognito` (or `cookieStoreId: "1"`) opens in a private window and fails with `local_browser_unsupported` and a hint to turn on **Allow in Incognito** when the extension is not allowed there. Any store other than `0`/`1` is unsupported on Chromium. |
| `local_browser_navigate` | `chrome.tabs.update` / `goBack` / `goForward` / `reload`, then waits for load, DOMContentLoaded or network idle. Refused by the agent guards above. |
| `local_browser_snapshot` | Content script walks the DOM and returns the accessibility-style node list below, paged by a decimal `cursor` offset, plus `document`. |
| `local_browser_act` | Content op `actPrepare` scrolls the target into view, hit-tests its centre and returns it in CSS pixels; the background then sends trusted input through the shared debugger attachment: `Input.dispatchMouseEvent` move/press/release (click count 2 for `dblclick`, move only for `hover`), `type` clicks, selects all (`rawKeyDown` `a` with Ctrl, Cmd on macOS, and the `selectAll` command) and calls `Input.insertText`, `press` sends `Input.dispatchKeyEvent` with modifiers from the key string (`Shift+Tab`). `actSettle` reports `changed` after watching for 300 ms from the baseline `actPrepare` took. The result carries `input: "trusted" \| "synthetic"` and a `note` on fallback. `input` `auto` (default) falls back to DOM events when Chrome refuses the debugger (DevTools open, policy); `trusted` fails with `local_browser_unsupported`; `synthetic` always runs DOM events. A covered or off-screen target is refused with `local_browser_element_missing` unless `force: true`; a forced act on a covered target runs DOM events on the target. Scroll, select, focus and scroll_into_view are DOM events; `scroll` moves the element's own scroll container when it has one. |
| `local_browser_read` | A visibility-aware text walk, a small markdown converter, or `innerHTML`, cut at the forwarded `maxChars` (default 8000, no extension-side maximum), plus `document`. |
| `local_browser_screenshot` | `captureVisibleTab` for the focused tab, `Page.captureScreenshot` through the debugger for background tabs and `fullPage`, an `OffscreenCanvas` crop for a selector, plus `document`. |
| `local_browser_wait` | Content script polls selector, text, URL fragment or idle state, plus `document`. |
| `local_browser_evaluate` | `chrome.scripting.executeScript` in the main or isolated world, result JSON-cloned in the page. |
| `local_browser_storage` | `chrome.cookies` by `url`, `domain` or `allDomains`, narrowed by `name`, pinned to a `storeId`; `limit` is honoured and absent means every cookie. Cookies report `name, value, domain, path, secure, httpOnly, sameSite, session, expirationDate?, hostOnly, storeId, partitionKey?`. A `session: true` entry writes a cookie without expiry. Clear removes per cookie and refuses a whole-jar wipe without `name` or `confirmAll`. `localStorage`/`sessionStorage` live in the content script. |
| `local_browser_network` | Continuous `chrome.webRequest` capture (`onBeforeRequest`, `onBeforeSendHeaders` with `extraHeaders`, `onHeadersReceived` with `extraHeaders`, `onCompleted`, `onErrorOccurred`) into one ring of `networkBufferSize` rows. Rows carry full request and response headers, `hasCookie`, `hasAuthorization`, `fromCache`, `ip`, `initiator`, `documentId`, `frameId` and `error`. `list` filters by tab (default the current tab), `since`, `urlIncludes`, `method`, `types` and `limit`; `includeHeaders: false` drops the headers. `includeBodies` attaches the debugger on demand and keeps it for 5 idle minutes so later bodies come from `Network.getResponseBody`. Without site access the call falls back to a 1.2 s debugger window. `capture` reports `{mode, since, windowMs?}`. |
| `local_browser_upload` | `File` + `DataTransfer` in the page's main world, then `input` and `change`. Accepts `{name, mimeType, base64}` and the older `{name, mime, dataBase64}`. |
| `local_browser_download` | `chrome.downloads.search` over every download; `save` fetches the file and returns `{id, name, mimeType, sizeBytes, base64}` with no size cap. |
| `local_browser_close` | `chrome.tabs.remove`, or `{ok:true, closed:"session"}` when `closeSession` is set. The result is sent before the socket closes. |
| `local_browser_context` | One probe: the tab with its container, the tab URL's cookies in its store without values, the content script's document state (`connected`, `missing` or `blocked`), network capture state with `lastRequestAt` and `requestsSinceLoad`, and the access snapshot. |
| `local_browser_permissions` | `status` returns the access snapshot; `request` queues ids for the user and answers with `requested`, `alreadyGranted` and a note to ask the user to press Allow. |
| `local_browser_api` | Calls `chrome.<path>(...args)` through the shared `LB.apiCall` and returns `{value, type}`. `storage.*` is refused; a namespace missing for lack of permission answers `local_browser_permission_required`. |
| `local_browser_viewer` | Internal: `captureVisibleTab` or a debugger capture every `intervalMs` (default 1000) as `frame` events in CSS pixels, plus `state` events. |
| `local_browser_input` | Internal: `localBrowserInputSchema` shapes through `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`, synthetic DOM fallback. |
| `local_browser_ui` | Internal: opens the control center on `#permissions` or `#overview`. |

## Snapshot node shape

```json
{
  "url": "https://example.test/checkout",
  "title": "Checkout",
  "truncated": false,
  "total": 42,
  "nodes": [
    { "role": "heading", "name": "Checkout", "depth": 0 },
    { "role": "textbox", "name": "Email", "value": "a@b.test", "depth": 1, "ref": "e1" },
    { "role": "checkbox", "name": "Save this card", "depth": 1, "checked": false, "ref": "e2" },
    { "role": "button", "name": "Pay now", "depth": 1, "disabled": true, "ref": "e3" },
    { "role": "text", "name": "Prices include tax", "depth": 2 }
  ]
}
```

- `ref` exists only on interactive roles: link, button, textbox, searchbox, checkbox, radio,
  switch, combobox, listbox, option, menuitem, menuitemcheckbox, menuitemradio, tab, slider,
  spinbutton. Refs are `e1..eN` in document order.
- Text runs (`role: "text"`) carry no ref.
- `depth` counts element levels below the snapshot root; the root element itself is not
  emitted, so its children start at `0`.
- Names come from `aria-label`, `aria-labelledby`, an associated `<label>`, `alt`,
  `placeholder`, a submit button's `value`, `title`, then text content for content-bearing
  roles only (link, button, heading, img, cell, listitem, label, tab, option, menuitem,
  alert, tooltip), then `name`. They are collapsed and capped at 160 characters.
- Structural nodes with an empty name (`form`, `navigation`, `region` without a label) are
  dropped; interactive nodes are kept even when unnamed so an unlabelled input still gets a ref.
- Password fields never report a `value`.
- Nodes whose computed `display` is `none`, `visibility` is `hidden`/`collapse`, `opacity` is
  `0`, box is empty, or that are `hidden`/`aria-hidden="true"` are skipped. `<option>` is
  exempt from the empty-box rule because closed selects give options no box.
- `cursor` is the node offset to continue from; pass it back to get the next page without
  changing the ref numbering.

## Call timeouts

The server sends `budgetMs` with each call. With it, the extension uses
`budgetMs - callDefaults.extensionBudgetMarginMs` (1000 ms) as the whole call budget and fits
inner waits (page load, `wait`, content RPCs) inside it, so a long company `callMaxMs` really
reaches the browser and nothing is clamped to 120 s.

An older server sends no `budgetMs`; `lib/budget.js` then keeps the legacy table that mirrors
`server/src/services/local-browser/timeouts.ts`:

| Tool | Budget |
| --- | --- |
| `navigate` | `clamp(timeoutMs, 15000, 100, 120000) + 5000` |
| `wait` | `clamp(timeoutMs, 10000, 100, 120000) + 5000` |
| `act`, `evaluate` | `clamp(timeoutMs, 30000, 100, 60000) + 5000` |
| `network`, `upload`, `download` | `60000` |
| everything else | `30000` |

`server/src/__tests__/local-browser-budget-parity.test.ts` keeps a literal copy of this legacy
table and asserts the server's `budgetMs` never undercuts it and always leaves the margin. `lib/budget.test.mjs` declares its expected
numbers as literals instead of reading them from the module under test, so a drift turns it red.

## Cursors and paging

`cursor` is the decimal node offset returned by the previous snapshot
(`LOCAL_BROWSER_CURSOR_PATTERN` = `/^\d+$/`). Page one comes back with `cursor: "120"`; passing
`cursor:"120"` returns nodes from offset 120 onward and a cursor for the page after that.

- A cursor that is not decimal digits is ignored, `cursorIgnored: true` is returned, and refs
  restart at `e1`.
- A cursor at or past the end of the walk returns a fresh first page with `cursorReset: true`
  and a note, because the page changed underneath it.
- `offset` echoes the resolved offset so a caller can see where the page started.

## Ref lifetime

Each tab keeps one `Map<ref, Element>` in its content script. A snapshot without `cursor`
resets it and re-assigns `e1..eN` in document order for that page; a snapshot with `cursor`
extends it. A ref is rejected as `local_browser_ref_stale` once its element is detached from
the document. Refs are also dropped whenever the document URL changes without a reload, so an
SPA route change cannot leave an old ref pointing at a recycled node.

## Tests

```sh
node --test apps/local-browser/chromium/lib/*.test.mjs apps/local-browser/chromium/background/*.test.mjs
```

`background/harness.test.mjs` loads the real service-worker module list (parsed from
`background/index.js`) into a `vm` sandbox with a fake `chrome` built on the shared
`createFakeApi`, a fake WebSocket and stateful tabs, debugger, cookies, downloads and
`webRequest`. The suites cover the bridge (`hello` capabilities, access and guards events, the
`lb-control` ops, broadcasts, first run, `budgetMs`), the tools (permission refusals, context,
api, permissions, ui, incognito and stores, guards, `force`, tab fields), network capture,
cookies, the viewer and pairing lifecycle (`wiring.test.mjs`), the manifest against the
permission catalog with every referenced file, and `load.test.mjs`, which loads the manifest's
content scripts into a sandbox and drives them through the real message seam. Shared modules
are tested in `apps/local-browser/shared/lib`.

Every JavaScript file parses on its own:

```sh
for f in $(find apps/local-browser/chromium -name '*.js' ! -path '*/background/index.js'); do node --check "$f"; done
node --input-type=module --check < apps/local-browser/chromium/background/index.js
```

## Protocol notes and deviations

The wire protocol follows `packages/shared/src/local-browser.ts` (`protocol: 1`). Where the
contract leaves a choice, this client does the following:

- `hello` sends `profileName: null`. Extension APIs cannot read the Chrome profile name, and
  inventing one would be a lie in the session list.
- `local_browser_sessions` returns the tab list plus a `sessions` array holding one entry, so
  the server can render either shape.
- `local_browser_upload` needs the server to send `files: [{name, mimeType, base64}]`
  with the call (the older `{name, mime, dataBase64}` is accepted too). `attachmentIds` alone
  cannot cross the bridge; the call fails with `local_browser_unsupported` and a hint saying so.
- `local_browser_network` captures continuously through `chrome.webRequest` once site access
  is granted; without it it falls back to a 1.2 s debugger window
  (`capture.mode: "window"`) and queues the missing permissions.
- `local_browser_download` lists every download, newest first; rows carry `referrer` so the
  agent can tell which site started each one.
- `local_browser_evaluate` defaults to the main world. Sites whose CSP blocks `eval` fail
  with `local_browser_unsupported` and a hint to retry with `world: "isolated"`.
- `local_browser_input` takes the frozen `localBrowserInputSchema` shapes verbatim and
  rejects anything else with `local_browser_protocol_error`:
  - `{kind:"mouse", action:"move"|"down"|"up", x, y, button?, clickCount?}`. `move` sends
    only `mouseMoved`; it never clicks. A click is the UI's own `down` then `up`.
  - `{kind:"wheel", deltaX, deltaY, x, y}` sends `mouseWheel`.
  - `{kind:"key", action:"down"|"up", key, code?, text?, alt?, ctrl?, meta?, shift?}` with flat
    modifier booleans mapped to the CDP modifier bitmask (alt 1, ctrl 2, meta 4, shift 8).
    `down` sends `rawKeyDown` and, when text is present and no ctrl/meta is held, a `char`
    event carrying that text. `up` sends `keyUp`.
  - It returns `{ok, mode:"trusted"|"synthetic", kind, action, tabId}`; the synthetic path
    runs when another debugger already holds the tab and replays the same payload in the
    page. There, a `down` followed by an `up` on the same element within 700 ms also
    dispatches `click`, which is what a real browser does.
- Viewer state is relayed as `{type:"event", event:"state", data:{state, tabId?, message?}}`,
  matching `localBrowserStateEventSchema` exactly, where `state` is one of the frozen values:
  `connected` when the stream starts,
  `agent_streaming`/`agent_idle` while the agent runs a call with a viewer open,
  `viewer_unavailable` when capture fails but the tab is alive, `disconnected` on stop or
  when the watched tab closes. The server maps this to the frozen
  `localBrowserViewerStateEventSchema` frame. The extension never emits
  `{type:"state"}` on the bridge: that shape belongs to the viewer SSE stream.
- Tabs events are `{type:"event", event:"tabs", data:{tabs:[...]}}`, matching
  `localBrowserTabsEventSchema`: the array is wrapped in a `tabs` object, never sent bare.
- The socket lifecycle is generation-guarded: every handler checks that its socket is still
  the live one, so a stale socket's `close` cannot null the current socket or schedule a
  reconnect. `Disconnect` and `closeSession` set a closed flag that aborts an in-flight
  `connect()`; only `pair`, `Reconnect`, startup and install clear it.
- `local_browser_viewer` streams JPEG frames (quality 70) because the stream is continuous;
  `local_browser_screenshot` returns PNG.
- Frame `width`/`height` are CSS pixels of the page viewport, per
  `LOCAL_BROWSER_VIEWER_COORDINATE_SPACE`, while `captureVisibleTab` returns device pixels.
  Every frame re-reads `window.devicePixelRatio` through a `viewport` content RPC and reports
  `round(bitmap / dpr)`, so a 1280x800 CSS viewport on a dpr 2 display reports 1280x800 and
  takeover clicks land where the human clicked. The ratio and size are never cached for the
  session; a resize or a monitor switch is picked up on the next frame.
- The viewer only captures the tab it was started on: it re-activates that tab, verifies it is
  the active tab in its window before each capture, and skips the frame with a
  `viewer_unavailable` state when the browser focused something else. Frames are never
  labelled with a tab id they did not come from.
- The viewport is never taken on trust. The `viewport` content RPC runs in the extension's
  isolated world and is authoritative. When it cannot answer, a fallback read is injected into
  the same isolated world and used only if it corroborates the bitmap within the same 1 px rule;
  an untrusted source claiming `dpr` 1 is rejected outright, because that is indistinguishable
  from advertising device pixels. If neither probe yields a trustworthy ratio, no frame is sent:
  the viewer emits `viewer_unavailable` with a short message and the last good frame stays on
  screen. A page must not be able to choose the coordinate space of the human's clicks.
- Frame size is cross-checked against the page viewport. `round(bitmap / dpr)` is used when it
  agrees with `window.innerWidth`/`innerHeight` within 1 px; otherwise the viewport size wins,
  because a wrong ratio would advertise device pixels as CSS pixels and takeover clicks would
  land at `dpr` times the intended position. The viewport comes from a `viewport` content RPC
  and falls back to an injected read of `window.devicePixelRatio` when that RPC cannot answer.
- A close code `1008` (policy violation, the server rejecting a dead token) retires the pairing:
  the token and session id are cleared, origin and label are kept so the user can re-pair, the
  popup shows `Pairing ended` with the reason, and no reconnect is attempted. Any other close code
  is treated as a network drop and reconnects with backoff.
- The popup and control center never decide anything: the shared `lib/ui-state.js` turns the
  `lb-control` status into display and enablement decisions and the pages only apply them.
  The pair form shows for unpaired and retired states, so a user whose session ended can
  always re-pair; Reconnect is refused for a retired pairing with the reason kept.
- Retirement survives a service-worker restart. The retired record carries `retiredAt` and
  `retiredReason` in `chrome.storage.local`, so a worker that wakes later finds no token, does
  not connect, and still shows the reason in the popup. Only `pair`, startup and
  install clear the retired state.
- The capture loop stops when the socket closes, when the watched tab closes, and on
  `{op:"stop"}`. A frame is skipped rather than sent with a null width or height, because
  `localBrowserViewerFrameEventSchema` requires positive integers.
- Content scripts run in every frame but only answer calls addressed to their own tab. Calls
  go to the main frame first and fall back to a tab-wide broadcast when no frame answers.
- A tab is targeted by `tabId`; without one, the active tab of the last focused window is
  used, then any active tab.
- `read` with `format: "text"` walks the DOM instead of calling `innerText`, so hidden
  subtrees are dropped and block elements separate lines the same way in every browser.
- The extension does not enforce tiers or origin allowlists: the server owns `tier` and
  `allowedOrigins`, refuses `refine` calls to unlisted origins, and answers full-tier tools
  in `refine` with `local_browser_tier_denied` before they reach the browser. The extension
  only stores what `hello_ack` reports so the popup can show it. The only extension-side
  gates are browser permissions (`local_browser_permission_required`) and the user's agent
  guards.
- Trusted `Input.dispatchKeyEvent` sends `char` with the key's own text for single-character
  keys, so takeover typing works without a separate text argument.
