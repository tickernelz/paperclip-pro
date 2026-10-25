# Firefox client

WebExtension (Manifest V2) that pairs a Firefox profile with Paperclip and answers
`local_browser_*` calls from the bridge. No build step: the folder is the add-on.

## Temporary load (development)

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** and pick `firefox/manifest.json`.
3. The add-on appears as *Paperclip Local Browser Bridge* with the internal UUID
   `moz-extension://<uuid>`. A temporary add-on disappears when Firefox restarts, and its
   `browser.storage.local` data survives, so pairing is not lost.
4. In Paperclip start pairing for a Firefox browser, copy the 8 character code, then open the
   toolbar popup and fill in origin, code and label.

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

`lib/budget.js` maps a tool to the wall-clock budget the bridge arms around it:

| tool | budget |
| --- | --- |
| `navigate`, `wait` | the call's own `timeoutMs`, capped at 120 s |
| `act`, `evaluate` | the call's own `timeoutMs`, capped at 60 s |
| `network`, `upload`, `download` | 60 s |
| everything else | 30 s |

Every row gets a 5 s grace so the extension answers before the caller gives up. Defaults are
read from `LB.protocol.DEFAULTS`, never duplicated.

`upload` and `download` get 60 s here on purpose: both decode or fetch file bytes on top of
the page round trip, so a 30 s cap truncates a real transfer. The Chromium client has no row
for them and falls back to 30 s, which is why its own client cuts a long upload off early. Do
not "restore parity" by dropping this branch — that would inherit the defect.

**The server agrees.** `server/src/services/local-browser/timeouts.ts`
(`localBrowserCallBudget`) implements this same table and `dispatch()` arms it per call, so the
two budgets are equal for every tool: the server never times out a call the extension is still
working on, and the extension always answers before the server gives up. Cross-checked over all
14 tools × 9 `timeoutMs` shapes (126 combinations): zero mismatches, server never shorter.

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
   UUID* field. The popup prints the exact command to copy once the agent is not reachable.
2. Verify the endpoint answers: `curl http://127.0.0.1:9222/session` returns
   `{"webSocketUrl": "ws://127.0.0.1:9222/session"}`.
3. Open the popup: *Trusted input* reads **WebDriver BiDi ready**. While it reads **synthetic
   events**, the viewer still works, it just cannot produce trusted events.

`--remote-allow-origins` is mandatory. Firefox's remote agent rejects a WebSocket handshake
whose `Origin` is not on that list, and a page inside an extension always sends
`moz-extension://<uuid>`. The port is stored in `browser.storage.local` under `lb.bidi`;
edit that value to use a different port. Trusted input is never required for
`local_browser_act`: that path uses DOM events on purpose so it works in every profile.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | List, open, navigate, activate and close the user's tabs, and read their title and URL for `sessions` and snapshots. |
| `activeTab` | Script the focused tab when the agent acts on it without a prior navigation by the add-on. |
| `<all_urls>` | The agent drives whatever site the user is on. Scoping is the server's job: the `refine` tier checks `allowedOrigins` before a call is dispatched. |
| `scripting` | `local_browser_evaluate` through `browser.scripting.executeScript` in the MAIN or ISOLATED world (Firefox 128+ for MAIN). |
| `webRequest`, `webRequestBlocking` | `local_browser_network` reads response bodies with `filterResponseData`, which only exists for blocking listeners. |
| `cookies` | `local_browser_storage` with `kind: "cookies"`: url, domain or whole-jar scope, cookie stores, httpOnly cookies, site-level attributes and store on writes, and a refusal to wipe the whole jar without `name` or `confirmAll`. The jar-wide scopes need the `cookies.v2` capability, which this build advertises. First-party and partitioned cookies are only reached when Firefox reports them for the same scope. |
| `storage` | Persist the pairing token, label and the BiDi port. |
| `downloads` | `local_browser_download` lists the tab's downloads and reads one for `save`. |

Nothing is sent anywhere except the paired origin. The add-on never writes page content,
cookie values or the session token to the console, and the popup shows only label, tier,
origin, connection time and client version.

## Parity with the Chromium client

Both clients answer the same 14 tools, plus the internal `local_browser_viewer` and
`local_browser_input`, with the same result shapes. Snapshot, cursor handling, ref assignment,
text collapsing, markdown conversion and the DOM adapter are the same code, byte identical
between `chromium/lib` and `firefox/lib`. `lib/protocol.js`, `keys.js`, `input.js`,
`frames.js`, `ring.js` and `backoff.js` are Firefox only.

| Area | Chromium (MV3) | Firefox (MV2) |
| --- | --- | --- |
| Background | Service worker, woken per event | Persistent background page (MV2), so the socket survives idle |
| Pairing, frames, backoff | Same | Same |
| Snapshot / refs / read / markdown | Same modules | Same modules, byte identical |
| Click, type, select, check | `Input.dispatch*` through the debugger domain where possible | DOM events with the native value setter, `input` + `change` |
| `evaluate` | MAIN world through the debugger domain | `browser.scripting.executeScript` MAIN world (Firefox 128+), then `tabs.executeScript` fallback |
| Network bodies | CDP `Network.getResponseBody` | `webRequest.filterResponseData`, 64 KiB per body, ring buffer 50 shown / 200 kept |
| Screenshot | `captureVisibleTab`, element crop on canvas | `captureVisibleTab`, element crop on canvas; `fullPage` stitches up to 8 viewport frames |
| Viewer frames | `captureVisibleTab` per tick | `captureVisibleTab` per tick, minimum interval 500 ms, reported in CSS pixels |
| Viewer input | CDP input, trusted | Frozen `localBrowserInputSchema`; BiDi `input.performActions` when the remote agent runs, else synthetic with `synthetic: true` |
| Viewer state | CDP session state | `localBrowserViewerStateEventSchema` payloads: `connected`, `viewer_unavailable`, `agent_streaming`, `agent_idle`, `disconnected` |
| Upload | `DataTransfer` + `File` from base64 sent by the server | Same |
| Downloads | `chrome.downloads` + `fetch` for `save` | `browser.downloads.search` + `fetch`, 2 MiB cap |
| Cookies | `chrome.cookies` | `browser.cookies` |
| localStorage / sessionStorage | Content script | Content script |
| Restricted pages | `chrome://`, the Web Store | `about:`, `addons.mozilla.org`, PDF viewer — reported as `local_browser_unsupported` |
| Call budget | Per tool: `navigate`/`wait` honour `timeoutMs` up to 120 s, `act`/`evaluate` up to 60 s, network 60 s, `upload`/`download` 30 s | Same table, plus 60 s for `upload`/`download` (deliberate, see below) |
| Frame targeting | Content script in all frames, RPC always to frame 0 | Content script in all frames, RPC always to frame 0 |
| Tab close | Releases the tab's network buffer and stops the viewer | Same |
| Error detail | `{code, message, hint?, retryable?}` | Same, every thrown error carries the hint and retry flag |

## Files

```
firefox/
  manifest.json          MV2, persistent background, gecko id, min Firefox 128
  icons/icon.svg
  popup/                 pairing state, label, tier, BiDi hint, Disconnect
  content/agent.js       page side: snapshot, act, read, wait, storage, upload, crop, synthetic input
  background/
    index.js             entry: network capture, message routing, startup reconnect, badge
    bridge.js            socket, pairing storage, hello/hello_ack, call/result, viewer loop, heartbeat
    tools.js             the 14 tools + viewer + input, tier gate, timeouts
    tabs.js              tab list/resolve, content injection, load waiting, capture
    network.js           webRequest capture, filterResponseData bodies, per-tab ring buffers
    bidi.js              remote agent probe, browsingContext resolution, input.performActions
    downloads.js         download listing and fetch+base64 save
  lib/                   pure modules with node --test suites: snapshot, cursor, refmap, text,
                         markdown and dom-adapter are byte identical to the Chromium client's copies;
                         protocol, keys, input, frames, budget, ring and backoff are Firefox
                         specific
```

## Tests

```sh
node --check apps/local-browser/firefox/background/*.js
node --check apps/local-browser/firefox/content/agent.js
node --check apps/local-browser/firefox/popup/popup.js
node --check apps/local-browser/firefox/lib/*.js
node --test apps/local-browser/firefox/lib/*.test.mjs
```
