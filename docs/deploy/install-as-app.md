---
title: Install as an App
summary: Add the Paperclip board to an Android, iOS, iPadOS, or desktop home screen as a standalone app
---

Paperclip ships a web app manifest and service worker, so any HTTPS deployment (or `localhost`) can be installed as an app. The installed app opens without browser chrome, has its own icon and task switcher entry, and offers shortcuts to Inbox, Tasks, and Dashboard.

## Requirements

- The board must be served over `https://` (a Cloudflare tunnel, Tailscale Serve, or a reverse proxy with TLS). Plain `http://` on a LAN address is not installable; `http://localhost` is.
- Sign in once in the browser before installing so the app opens straight into your board.

## Android (Chrome, Edge, Samsung Internet)

1. Open the board in the browser.
2. Open the account menu (bottom-left avatar) and tap **Install app**, or use the browser menu's **Install app** / **Add to Home screen**.
3. Confirm. The app appears in the launcher; long-press its icon for the Inbox, Tasks, and Dashboard shortcuts.

## iPhone and iPad (Safari)

1. Open the board in Safari.
2. Open the account menu and tap **Install app** for the steps, or directly: tap **Share**, then **Add to Home Screen**.
3. Keep **Open as Web App** on and tap **Add**.

## Desktop (Chrome, Edge, Safari on macOS)

Use **Install app** in the account menu, the install icon in the address bar, or Safari's **File → Add to Dock**.

## Using the installed app

- A slim toolbar at the top provides **Back**, **Refresh**, **Share**, and **Open in Browser**, since the app has no browser address bar. Back returns to the Dashboard when there is no earlier page in the app.
- When the server is unreachable, the app shows an offline page and reloads automatically once the connection returns. Paperclip does not cache board data for offline use.
- Updates arrive automatically: the service worker picks up each deploy and reloads the app the next time it is backgrounded.

## Troubleshooting

- **No Install option:** confirm the page is on HTTPS and that `/site.webmanifest` and `/sw.js` load without a login redirect. Authenticating proxies must allow credentialed requests to the manifest.
- **Opens in the browser instead of an app on iOS:** remove the icon and add it again with **Open as Web App** turned on.
