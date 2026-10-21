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

Requires Chrome 116 or newer (WebSocket activity keeps the MV3 service worker alive).

## Pairing

1. In Paperclip, open the browser connector for `local-browser` and start a pairing. The
   server answers with a code and one or more connect URLs
   (`wss://<host>/api/local-browser/bridge?code=XXXXXXXX`).
2. Click the extension icon. Paste either the full connect URL or just the server origin
   (`https://paperclip.example.com`) into **Server or connect URL**, and the 8-character
   code into **Pairing code**. Set a label such as `Chrome on my laptop`.
3. Press **Pair**. The popup turns green when the bridge answers `hello_ack`; from then on
   the extension reconnects with `?session=<token>` and keeps the token across restarts.
4. Pairing codes expire after 10 minutes. If the code expired, start a new pairing.

**Disconnect** forgets the token on this device. The browser stays signed in to every site;
only the Paperclip link is removed. **Reconnect** re-opens the socket with the stored token.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `tabs` | List tabs for `local_browser_sessions`, report titles and URLs, react to open/close/navigate events, and focus the tab before a screenshot. |
| `scripting` | Inject the content script into tabs that were already open before the extension was installed, run `local_browser_evaluate`, and attach files in the page's main world. |
| `activeTab` | Touch the tab the user is looking at without waiting for a full-page grant. |
| `storage` | Keep the pairing entry (origin, label, session token, tier, allowed origins) in `chrome.storage.local`. |
| `cookies` | Read, write and clear cookies for `local_browser_storage` (full tier only). |
| `downloads` | List the tab's downloads and read a saved file's bytes for `local_browser_download` (full tier only). |
| `debugger` | Trusted input for `local_browser_input`, full-page screenshots, and the `Network` domain for `local_browser_network`. Attached only for the duration of the call, or 30 s after the last takeover input. |
| `alarms` | A 30-second heartbeat that re-opens the socket after the service worker is suspended. |
| `<all_urls>` (host) | The bridge drives whatever site the task needs; `captureVisibleTab` and `chrome.cookies` also require host access. The server still refuses `refine`-tier tabs whose origin is not in `allowedOrigins`. |

The extension never logs page content, cookie values or the session token to the console.

## What each tool does

| Tool | Implementation |
| --- | --- |
| `local_browser_sessions` | `chrome.tabs.query`; returns `{tabId, windowId, title, url, active, status}` per tab, plus a one-entry `sessions` array with the session id, label and tier. |
| `local_browser_open` | `chrome.tabs.create` or `chrome.tabs.update`, waits for `status === "complete"`, returns the tab and a first-page snapshot. |
| `local_browser_navigate` | `chrome.tabs.update` / `goBack` / `goForward` / `reload`, then waits for load, DOMContentLoaded or network idle. |
| `local_browser_snapshot` | Content script walks the DOM and returns the accessibility-style node list below, paged by a decimal `cursor` offset. |
| `local_browser_act` | Content script scrolls the target into view, then hit-tests its centre, then dispatches real pointer, keyboard and input events; reports `changed` after watching for 300 ms, measured from a mutation baseline taken *after* the scroll so scroll-triggered DOM churn is not misreported as the action's effect. A null hit outside the viewport means "scroll and retry"; if the target is still outside the visible page area after that, the call is refused with `local_browser_element_missing` rather than firing an event no trusted click could reach (off-canvas drawers, `left:-9999px` hiders, transform carousels). `scroll` moves the element's own scroll container when it has one. |
| `local_browser_read` | A visibility-aware text walk, a small markdown converter, or `innerHTML`, capped at `maxChars`. |
| `local_browser_screenshot` | `chrome.tabs.captureVisibleTab`, cropped in an `OffscreenCanvas` for an element (the crop is clamped in offset **and** extent, and an element outside the viewport returns the full frame with `cropped:false` rather than a blank 1x1); `Page.captureScreenshot` with a content-size clip for `fullPage`, which falls back to the viewport with a `note` when the debugger is unavailable. |
| `local_browser_wait` | Content script polls selector, text, URL fragment or idle state. |
| `local_browser_evaluate` | `chrome.scripting.executeScript` in the main or isolated world, result JSON-cloned in the page. |
| `local_browser_storage` | `chrome.cookies` for cookies (domain, path, secure, httpOnly, sameSite and expiry are honoured on write; clear removes per-cookie domain+path and reports what actually went), `localStorage`/`sessionStorage` in the content script. |
| `local_browser_network` | `chrome.debugger` with `Network.enable` for a 1.2 s collection window, bodies on request. Reuses an already-attached takeover session instead of failing, and only detaches what it attached. The per-tab ring buffer is dropped when the tab closes. |
| `local_browser_upload` | `File` + `DataTransfer` in the page's main world, then `input` and `change`. Accepts `{name, mimeType, base64}` and the older `{name, mime, dataBase64}`. 60 s budget. |
| `local_browser_download` | `chrome.downloads.search`; `save` fetches the file and returns `{id, name, mimeType, sizeBytes, base64}`. 60 s budget. |
| `local_browser_close` | `chrome.tabs.remove`, or `{ok:true, closed:"session"}` when `closeSession` is set. The result is sent before the socket closes, so the server sees it. |
| `local_browser_viewer` | Internal: `captureVisibleTab` every `intervalMs` (default 1000) as `frame` events in CSS pixels, plus `state` events on start, stop and agent activity. |
| `local_browser_input` | Internal: consumes `localBrowserInputSchema` exactly; trusted `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` through `chrome.debugger`, synthetic DOM fallback. |

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

`lib/budget.js` mirrors the server's per-tool table
(`server/src/services/local-browser/timeouts.ts`) exactly, so a call is never killed by the
client while the server would still be waiting:

| Tool | Budget |
| --- | --- |
| `navigate` | `clamp(timeoutMs, 15000, 100, 120000) + 5000` |
| `wait` | `clamp(timeoutMs, 10000, 100, 120000) + 5000` |
| `act`, `evaluate` | `clamp(timeoutMs, 30000, 100, 60000) + 5000` |
| `network`, `upload`, `download` | `60000` |
| everything else | `30000` |

`local_browser_upload` and `local_browser_download` need the long budget: upload decodes
base64 into `DataTransfer` files and `download op:save` fetches a file of up to 2 MiB and
base64-encodes it, both on top of the page round trip.

The table exists in three places (the server module, this client, and the Firefox client) and
nothing in `packages/shared` owns it yet. Equality is held by behaviour, not by a text
comparison: `server/src/__tests__/local-browser-budget-parity.test.ts` imports the real
`localBrowserCallBudget`, loads both extensions' budget modules in a vm, and compares every
contract tool across ten `timeoutMs` shapes. A source-text parser was tried and retired: it
turns red on a harmless rename and green on a real behaviour change that keeps the same text.

This client also pins the invariant the parity test cannot see. `lib/defaults-parity.test.mjs`
asserts that `protocol.js` `DEFAULTS` (`callTimeoutMs`, `navigateTimeoutMs`,
`waitTimeoutMs`) equal the `lib/budget.js` literals, and that across six `timeoutMs` shapes
each inner operation wait stays strictly inside the call budget that wraps it, with the gap
equal to the grace window. Those are different numbers used by different layers: an inner load
wait of 26 s inside a 20 s call budget would surface as a bare `local_browser_timeout` instead
of the navigation reporting its own timeout.

Both files hold their own opinion rather than importing one. `lib/budget.test.mjs` and
`lib/defaults-parity.test.mjs` declare the expected numbers as literals (`GRACE_LITERAL`,
`CALL_LITERAL`, `NAVIGATE_LITERAL`, `WAIT_LITERAL`, `LONG_CALL_MS` and friends) and assert the
module exports equal them, instead of writing `15000 + CALL_GRACE_MS` with the constant read
from the module under test. An assertion whose expected value comes from the subject moves
both sides together and stays green while the value drifts: mutating `CALL_GRACE_MS` from 5000
to 8000 left the whole of the earlier `budget.test.mjs` passing. Every drift of
`CALL_GRACE_MS`, `LONG_CALL_MS`, `DEFAULT_CALL_MS`, `DEFAULT_NAVIGATE_MS` and
`DEFAULTS.navigateTimeoutMs` now turns its file red.

When `packages/shared` opens for this feature, moving the row set there removes all three
copies.

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

The pure helpers in `lib/` run without a browser, and `lib/load.test.mjs` loads the real
manifest script list into a `vm` sandbox to prove the content script actually installs: it
asserts `lib/protocol.js` is present and ordered before `content.js` in both
`manifest.json` and `background.js` `CONTENT_FILES`, that the listener registers and answers
a snapshot RPC, and that cursor paging, ref resets, hit-testing and scroll containers behave
through the real message seam.

```sh
node --test apps/local-browser/chromium/lib/*.test.mjs
```

They cover the snapshot walker (invisible-node skipping, ref order, depth, text collapsing,
name capping, truncation and cursors), the markdown converter, and the ref map. The tests use
a fake DOM adapter (`lib/test-dom.mjs`) with the same interface as `lib/dom-adapter.js`.

Every JavaScript file parses on its own:

```sh
for f in $(find apps/local-browser/chromium -name '*.js' -o -name '*.mjs'); do node --check "$f"; done
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
- `local_browser_network` collects for 1.2 s after enabling `Network`, keeps a 400-row ring
  buffer per tab, and only fetches response bodies when `includeBodies` is set.
- `local_browser_download` filters by origin because `chrome.downloads` items carry no tab
  id: a download belongs to the tab when its `referrer` or URL origin matches the tab's.
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
  popup shows `Not paired` with the reason, and no reconnect is attempted. Any other close code
  is treated as a network drop and reconnects with backoff.
- The popup never decides anything: `lib/popup-state.js` turns a status into display and
  enablement decisions (`stateLabel`, `dotClass`, `detail`, `origins`, `showPairForm`,
  `reconnectEnabled`, `disconnectEnabled`, `prefilledOrigin`, `prefilledLabel`) and
  `popup.js` only applies them. The pair form stays visible in every state including retired,
  so a user whose session ended can always re-pair with the origin still prefilled; Reconnect
  and Disconnect are enabled only for a live pairing.
- Retirement survives a service-worker restart. The retired record carries `retiredAt` and
  `retiredReason` in `chrome.storage.local`, so a worker that wakes later finds no token, does
  not connect, and still shows the reason in the popup. Only `pair`, `Reconnect`, startup and
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
  only stores what `hello_ack` reports so the popup can show it.
- Trusted `Input.dispatchKeyEvent` sends `char` with the key's own text for single-character
  keys, so takeover typing works without a separate text argument.
