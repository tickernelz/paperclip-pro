# Firefox client

WebExtension (Manifest V2) that pairs a Firefox profile with Paperclip and answers
`local_browser_*` calls from the bridge. No build step: the folder is the add-on.

## Temporary load (development)

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** and pick `firefox/manifest.json`.
3. The add-on appears as *Paperclip Local Browser Bridge* with the internal UUID
   `moz-extension://<uuid>`. A temporary add-on disappears when Firefox restarts, and its
   `browser.storage.local` data survives, so pairing is not lost.
4. The control center (`ui/control.html`) opens on first install. Grant the permissions you
   want agents to have (**Allow all** asks for every optional permission and every website in
   one prompt), then paste the pairing link from Paperclip's Local Browser page. The toolbar
   popup offers the same pairing form and the pending permission requests.

## Permanent install

Firefox only installs unsigned add-ons in Developer Edition, Nightly and ESR with
`xpinstall.signatures.required` set to `false` in `about:config`. For regular Firefox, sign
it:

```sh
npx web-ext lint --source-dir apps/local-browser/firefox
npx web-ext build --source-dir apps/local-browser/firefox --artifacts-dir dist
npx web-ext sign --source-dir apps/local-browser/firefox --channel unlisted \
  --api-key "$WEB_EXT_API_KEY" --api-secret "$WEB_EXT_API_SECRET"
```

The signing keys come from https://addons.mozilla.org/developers/addon/api/key/. The signed
`.xpi` installs with a normal click in any Firefox. The manifest pins the id
`local-browser@paperclip.app`, so a re-signed build replaces the previous one and keeps its
storage.

The repository ships the signed artifact at `ui/public/downloads/local-browser-firefox.xpi`,
so an operator downloads it from the Local Browser connection page instead of signing. Rebuild
both download artifacts with `pnpm build:local-browser-extensions`, and pass `--sign` with
`WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in the environment when the manifest version
changed:

```sh
WEB_EXT_API_KEY=user:... WEB_EXT_API_SECRET=... node apps/local-browser/build-artifacts.mjs --sign
```

CI runs the same script without `--sign` and fails when the committed zip does not match the
source, so the download cannot drift from the code.

## Pairing and reconnect

- First pairing connects to `ws(s)://<origin>/api/local-browser/bridge?code=<code>`, sends
  `hello` with `client: "firefox"`, the add-on version, the label, the profile name and the
  open tabs, then stores `{origin, sessionToken, label}` from `hello_ack` in
  `browser.storage.local`.
- Later connects use `?session=<token>` and reconnect on browser start, on add-on install and
  after every drop, with exponential backoff (1 s doubling to 30 s, ±25 % jitter).
- A 25 s heartbeat sends `ping`; a socket that misses `pong` for 75 s is closed and
  reconnected.
- **Disconnect** in the popup clears the stored token. The server then answers
  `local_browser_not_paired` for that browser until it is paired again.

### When a pairing ends

A pairing is retired, not retried, when the server says the credential can never
work:

| signal | cause |
| --- | --- |
| close code `1008` | dead or already-claimed session token, protocol mismatch, missing credential, hello timeout |
| three failed connects with a pairing code | the code was rejected at the upgrade: unknown, expired, already used, or claimed by another window |

Retiring clears the token, session id, tier and origin allowlist, keeps the origin and
label, records `retiredAt` and `retiredReason` in storage, stops the viewer, and stops
reconnecting. The popup then shows the pair form again with the reason, **Disconnect**
stays available, and **Reconnect** is disabled because there is no credential to dial.
The reason survives a browser restart, so a user who comes back later still learns why.

Transient closes (`1006` network drop, `1001` server going away) keep reconnecting with
exponential backoff and never retire.

## Call budgets

With capability `budget.v1` the server sends `budgetMs` on every `call` frame: its own deadline
for that call, already clamped to the company's `callMaxMs` limit. The bridge arms
`budgetMs - 1000` (`callDefaults.extensionBudgetMarginMs`) around the tool, so the extension
always answers before the server gives up, and inner waits follow the same budget:

- `navigate` and `open` wait for the load for `timeoutMs` (default 15 s), never longer than the
  budget minus 500 ms.
- `wait` polls for `timeoutMs` (default 10 s) with the same bound and returns
  `{matched: false, note}` when nothing matched, like the Chromium client, instead of failing.
- `screenshot` with `fullPage` captures viewport after viewport until the bottom of the page,
  the budget, or the 32767 device pixel canvas limit; a partial capture says so with
  `truncated`, `capturedHeight`, `pageHeight` and `note`.

A server without `budget.v1` sends no `budgetMs`; then `lib/budget.js` falls back to the old
table (`navigate`/`wait` take `timeoutMs` + 5 s, `act`/`evaluate` take `timeoutMs` + 5 s,
`network`/`upload`/`download` 60 s, everything else 30 s) without the old 60 s and 120 s caps.

## Snapshot paging

`local_browser_snapshot` returns a payload the server renders itself, so the payload carries
the absolute `offset` of its first node — the same contract the Chromium client sends:

```json
{"url":"…","title":"…","nodes":[…],"truncated":true,"total":14,"offset":10,"cursor":"14"}
```

`offset` is what stops double slicing. `renderSnapshot` uses `payload.offset` as the absolute
start of the node array and only falls back to the requested cursor when `offset` is missing; a
client that pre-slices its own page and omits `offset` gets its page sliced twice and renders
empty. `cursor` is the decimal offset for the next page and is omitted once the walk is
complete.

A cursor the client cannot honour is reported rather than silently dropped:
`cursorIgnored: true` when it was malformed or the page navigated since, and `cursorReset:
true` with a fresh first page when the offset is at or past the end of the current document
(the page shrank). Refs reset on both paths, matching Chromium.

## Viewer input and viewer events

The viewer payloads are frozen in `packages/shared/src/local-browser.ts`; this client sends
them as-is and never invents fields.

```json
{"kind":"mouse","action":"move|down|up","x":0,"y":0,"button":"left|middle|right","clickCount":1}
{"kind":"wheel","deltaX":0,"deltaY":0,"x":0,"y":0}
{"kind":"key","action":"down|up","key":"Enter","code":"Enter","text":"","alt":false,"ctrl":false,"meta":false,"shift":false}
```

- `action: "move"` only moves the pointer: it never clicks, and it never changes a latch.
- `down` latches the button; the matching `up` produces exactly one `click` (and a
  `dblclick` when `clickCount` is 2). An `up` with no preceding `down` still releases, and
  reports `clicked: false`.
- Modifiers are flat booleans. A `key` `down` of `Shift`, `Control`, `Alt` or `Meta` latches
  it; the matching `up` clears it, and any other key `up` or any mouse `up` releases every
  latched modifier so nothing stays stuck.
- `text` is inserted after the `keydown`, which is how a composition or a multi character
  insert reaches the page.
- Every result reports `mode: "trusted"` (WebDriver BiDi performed the action) or
  `mode: "synthetic"` with `synthetic: true` and a `note`. Both paths run the same planner,
  so the latch semantics are identical; switching path resets both latches rather than
  leaving a half-finished gesture behind.

Frame `width`/`height` and input `x`/`y` are **CSS pixels** of the page viewport
(`LOCAL_BROWSER_VIEWER_COORDINATE_SPACE`), never device pixels. `captureVisibleTab` returns a
device-pixel bitmap, so every frame decodes the capture, re-reads `window.devicePixelRatio`
through the `viewport` RPC and reports `round(bitmapWidth / dpr)`. Nothing is cached for the
lifetime of the viewer: a window resize, a zoom change or a monitor switch is picked up on the
next frame, and when the decoded bitmap does not match the viewport the reported size falls back
to `window.innerWidth`/`innerHeight` rather than doubling the human's click targets.

Viewer state reaches the extension socket as `{type:"event", event:"state",
data:{state, tabId?, message?}}` where `state` is one of `connected`, `viewer_unavailable`,
`agent_streaming`, `agent_idle`, `disconnected` — the frozen
`localBrowserViewerStateEventSchema` payload, ready to be relayed as a `{type:"state"}`
frame. Frames stay `{type:"event", event:"frame", data:{dataUrl, width, height, tabId}}`.

## Trusted input through WebDriver BiDi

The viewer sends pointer and keyboard events through WebDriver BiDi when it can, so the page
sees `isTrusted` events. Otherwise the add-on dispatches synthetic DOM events and reports
`{synthetic: true, mode: "synthetic"}` in the result.

1. Quit Firefox and start it with the remote agent:

   ```sh
   firefox --remote-debugging-port 9222 --remote-allow-origins moz-extension://<uuid>
   ```

   `<uuid>` is the add-on's own origin: `about:debugging` shows it in the add-on's *Internal
   UUID* field. The control center's *Trusted input* section prints the exact command to copy while the agent is not reachable.
2. Verify the endpoint answers: `curl http://127.0.0.1:9222/session` returns
   `{"webSocketUrl": "ws://127.0.0.1:9222/session"}`.
3. Open the control center: *Trusted input* reads **WebDriver BiDi** ready. While it reads
   **synthetic events**, the viewer still works, it just cannot produce trusted events.

`--remote-allow-origins` is mandatory. Firefox's remote agent rejects a WebSocket handshake
whose `Origin` is not on that list, and a page inside an extension always sends
`moz-extension://<uuid>`. The port is stored in `browser.storage.local` under `lb.bidi`;
change it in the control center (control op `bidi.set`). Trusted input is never required for
`local_browser_act`: that path uses DOM events on purpose so it works in every profile.

## Permissions

The user decides what agents may do. The manifest asks only for what the extension cannot run
without, and declares every other permission of the shared catalog
(`LB.contract.permissions`, firefox column) as optional:

| Kind | Ids | Why |
| --- | --- | --- |
| required | `storage`, `activeTab`, `contextualIdentities` | Pairing token, guards and pending requests; scripting the focused tab; container names. Firefox cannot make `contextualIdentities` optional. |
| optional | `<all_urls>` | Open, read and act on websites; cookies and network capture need it too. |
| optional | `scripting` | Page tools and `evaluate` (MAIN world on Firefox 128+). |
| optional | `cookies` | `local_browser_storage` with `kind: "cookies"` and the cookie list of `local_browser_context`. |
| optional | `webRequest`, `webRequestBlocking` | Continuous network capture; response bodies through `filterResponseData`. |
| optional | `downloads`, `downloads.open` | `local_browser_download`. |
| optional | `tabs`, `webNavigation`, `history`, `bookmarks`, `browsingData`, `sessions`, `topSites`, `clipboardRead`, `clipboardWrite`, `notifications`, `management`, `privacy`, `search`, `proxy`, `tabHide`, `find`, `browserSettings` | Reached through `local_browser_api`. `notifications` also lets the extension announce new permission requests. |

Every tool calls `LB.access.ensure` before it touches the browser:

| Tool | Asks for |
| --- | --- |
| `open`, `navigate`, `snapshot`, `act`, `read`, `screenshot`, `wait`, `evaluate`, `upload`, `storage` (local/session) | `<all_urls>`, `scripting` |
| `storage` (cookies) | `cookies`, `<all_urls>` |
| `network` | `webRequest`, `<all_urls>`, plus `webRequestBlocking` with `includeBodies` |
| `download` | `downloads` |
| `context` | `cookies` unless `cookies: false` |
| `api` | the catalog id behind the path, for example `history` for `history.search` |

A missing permission fails the call with `local_browser_permission_required`, `retryable: true`
and `permissions: [ids]`, queues the ids with the tool and reason in `lb.pending`, and paints
the toolbar badge with the pending count. Only a click in the popup or control center can grant
(browsers require a user gesture); `local_browser_permissions` with `op: "request"` queues ids
without granting. The extension keeps no tier gate: the server checks the tier and the origin
allowlist before a call is dispatched.

## Agent guards

User switches stored under `lb.guards` and edited in the control center:
`protectPaperclipTab` (never navigate the Paperclip tab), `protectFocusedTab` (never navigate
the tab the user is looking at unless the agent opened it) and `networkBufferSize` (requests
kept per tab, 50 to 20000, default 1000). The server receives them in `hello` and as `guards`
events.

## Network capture

The webRequest listeners exist only while `webRequest` is granted: they are added on
`permissions.onAdded` and removed on `permissions.onRemoved`. Capture is continuous for every
resource type into a per-tab ring of `networkBufferSize` rows. Each row carries the request
headers from `onBeforeSendHeaders` and every response header (lowercased, duplicates joined,
`set-cookie` joined by newlines), `hasCookie`, `hasAuthorization`, `initiator` (the
`originUrl`), `fromCache`, `ip`, `error` and timing. Firefox has no `documentId`, so rows omit
it. `types` accepts Firefox types plus the aliases `fetch`/`xhr` (`xmlhttprequest`) and
`document` (`main_frame`, `sub_frame`); `since` filters by start time; the result carries
`capture: {mode: "continuous", since}`. Bodies are tapped only while `webRequestBlocking` is
granted, for documents, frames, XHR/fetch and `other`, up to 1 MiB per body (`bodyTruncated`
beyond that; a memory guard for the ring, not a user limit).

## Containers, private windows and the context probe

Tab summaries carry `cookieStoreId`, `containerName`, `incognito`, `discarded`, `pinned` and
`audible`. `local_browser_open` honours `cookieStoreId` (`tabs.create({cookieStoreId})`, and
reuses the agent's own tab only inside the same store), `incognito` (a tab in an existing
private window, else `windows.create({incognito: true})`; refused with a hint when the
extension is not allowed in private windows) and `newWindow`.

`local_browser_context` returns the tab, its container (`isDefault` for `firefox-default`), the
tab's cookies without values, the content script state (`connected`, `missing` when the page has
no agent yet, `blocked` when the extension cannot script it), the page's document state, the
tab's network capture state and the access snapshot.

Cookie output reports `session`, `expirationDate` (never on a session cookie), `hostOnly`,
`storeId` and `partitionKey`; reads ask every partition (`partitionKey: {}`), the store
defaults to the tab's `cookieStoreId`, a `get` without `limit` returns the whole match, and
`session: true` on a write omits the expiry.

## Document state

`lib/document-state.js` runs in every content script and answers the `documentState` op.
Snapshot, read, wait and screenshot results carry the same object as `document`
(`documentId`, `navigationType`, `restoredFromBfcache`, `stale`, `staleReasons`, request counts),
so an agent can tell a bfcache restore or a hidden page from a fresh load.

## Control protocol

The popup and control center talk to the background over `runtime.sendMessage` with
`channel: "lb-control"` and the ops `status`, `pair {input}`, `detect`, `reconnect`,
`disconnect`, `guards.set {patch}`, `pending.clear {permissions?}` and `bidi.set {port}`.
Every answer is `{ok: true, status, ...}` or `{ok: false, error, status}`; the background
broadcasts `{channel: "lb-status", status}` on every change. `status.state` is one of
`unpaired`, `connecting`, `connected`, `disconnected`, `retired`. On install the control center
opens on `#welcome`; on update it opens again while site access is not `all`.

Nothing is sent anywhere except the paired origin. The add-on never writes page content,
cookie values or the session token to the console.

## Parity with the Chromium client

Both clients answer the same 17 tools, plus the internal `local_browser_viewer`,
`local_browser_input` and `local_browser_ui`, with the same result shapes and the same
capabilities (`cookies.v2`, `permissions.v1`, `context.v1`, `network.headers`,
`tabs.container`, `document.state`, `api.v1`, `act.force`, `budget.v1`). The shared layer and
UI in `apps/local-browser/shared/` are copied byte for byte into both folders by
`node scripts/sync-local-browser-shared.mjs`; never edit the synced copies here.
`lib/protocol.js`, `keys.js`, `input.js`, `frames.js`, `ring.js`, `budget.js` and `backoff.js`
are Firefox only.

| Area | Chromium (MV3) | Firefox (MV2) |
| --- | --- | --- |
| Background | Service worker, woken per event | Persistent background page, so the socket survives idle |
| Click, type, select, check | `Input.dispatch*` through the debugger domain where possible | DOM events with the native value setter, `input` + `change` |
| `act.force` | Skips the hit-test refusal | Accepted; Firefox has no hit-test refusal to skip |
| `evaluate` | MAIN world through the debugger domain | `browser.scripting.executeScript` MAIN world, then `tabs.executeScript` fallback |
| Network | `chrome.webRequest` continuous capture, CDP bodies on demand | `browser.webRequest` continuous capture, `filterResponseData` bodies with `webRequestBlocking` |
| Screenshot | `captureVisibleTab`, element crop | `captureVisibleTab`, element crop; `fullPage` stitched up to the budget |
| Viewer input | CDP input, trusted | BiDi `input.performActions` when the remote agent runs, else synthetic with `synthetic: true` |
| Containers | none | `contextualIdentities`, `cookieStoreId` on tabs and open |
| Downloads | `chrome.downloads` + `fetch` for `save` | `browser.downloads.search` + `fetch`, no size cap (the server enforces `transferMaxBytes`) |
| Restricted pages | `chrome://`, the Web Store | `about:`, `addons.mozilla.org`, PDF viewer |

## Files

```
firefox/
  manifest.json          MV2, persistent background, gecko id, min Firefox 128, optional permissions
  icons/icon.svg
  ui/                    popup and control center (synced from shared/)
  content/agent.js       page side: snapshot, act, read, wait, documentState, storage, upload, crop, synthetic input
  background/
    index.js             entry: badge, first run, control routing, network install, startup reconnect
    bridge.js            socket, pairing, hello/hello_ack, call/result with budgetMs, access/guards events, control ops, viewer loop, heartbeat
    tools.js             the 17 tools + viewer, input and ui, permission checks, guards, open placement
    tabs.js              tab summaries with containers, resolve, content injection and probe, load waiting, capture
    network.js           permission-driven webRequest listeners, headers, bodies, per-tab rings
    cookies.js           cookie get/set/clear and the context cookie list
    bidi.js              remote agent probe, port setting, browsingContext resolution, input.performActions
    downloads.js         download listing and fetch+base64 save
  lib/                   shared modules (synced) and Firefox modules with node --test suites;
                         harness.test.mjs is the fake browser the background suites boot
```

## Tests

```sh
node scripts/sync-local-browser-shared.mjs --check
node --test apps/local-browser/firefox/lib/*.test.mjs
for f in apps/local-browser/firefox/{background,content,lib,ui}/*.js; do node --check "$f"; done
```
