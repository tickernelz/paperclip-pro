# Local Browser Bridge

Client extensions that let a Paperclip agent read and drive the user's real browser. The
server side of the feature lives in `server/src/services/connectors` and the connector
runtime; the wire contract is `packages/shared/src/local-browser.ts`.

```
apps/local-browser/
  chromium/   Manifest V3 extension for Chrome, Edge and Brave (no build step)
  firefox/    WebExtension client for Firefox
```

Both clients speak the same protocol: they connect out to
`/api/local-browser/bridge`, send `hello` with `protocol: 1` and their client name, receive
`hello_ack` with a session token and the current tier, then answer `call` frames with
`result` frames and push `tabs` events. The server renders the human and model-facing text,
so a snapshot reads the same whichever browser produced it.

Load instructions, the permission rationale and the pairing walkthrough are per client:

- `chromium/README.md`
- `firefox/README.md`

## Firefox

`firefox/` is a Manifest V2 add-on with no build step: load the folder with
**Load Temporary Add-on…** in `about:debugging`, or sign it with `web-ext sign` for a
permanent install. MV2 is deliberate — it keeps `webRequestBlocking` and
`filterResponseData`, which is the only way to read response bodies from an extension, and a
persistent background page keeps the bridge socket alive without wake-up gymnastics.

Two behaviours differ from Chromium and are worth knowing before filing a bug:

- **Trusted input** for the live viewer needs Firefox started with `--remote-debugging-port`
  plus `--remote-allow-origins moz-extension://<uuid>`. Without it the viewer still drives the
  page with synthetic DOM events, and the result says `synthetic: true`. The popup prints the
  exact command to copy.
- **`local_browser_evaluate`** runs through `browser.scripting.executeScript` in the MAIN
  world (Firefox 128+), falling back to `tabs.executeScript`. Pages whose CSP blocks `eval`
  return a note instead of a value.

The snapshot walker, markdown converter, ref map and text helpers are pure modules with
`node --test` suites that need no browser:

```sh
node --test apps/local-browser/chromium/lib/*.test.mjs
node --test apps/local-browser/firefox/lib/*.test.mjs
```
