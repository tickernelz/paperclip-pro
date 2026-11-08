---
title: Install as an App
summary: Add the Wardmote board to an Android, iOS, iPadOS, or desktop home screen as a standalone app
---

Wardmote ships a web app manifest and service worker, so any HTTPS deployment (or `localhost`) can be installed as an app. The installed app opens without browser chrome, has its own icon and task switcher entry, and offers shortcuts to Inbox, Decisions, Tasks, and New task.

Apps installed under the earlier Wardmote name keep working: the manifest `id`, `scope`, and `start_url` are unchanged, so the browser updates the name and icon in place and existing push subscriptions stay registered.

## Requirements

- The board must be served over `https://` (a Cloudflare tunnel, Tailscale Serve, or a reverse proxy with TLS). Plain `http://` on a LAN address is not installable; `http://localhost` is.
- Sign in once in the browser before installing so the app opens straight into your board.

## Android (Chrome, Edge, Samsung Internet)

1. Open the board in the browser. From the third visit, Home shows an **Install Wardmote** card (never during onboarding); **Not now** hides it for 30 days.
2. Tap **Install**, use **Install app** in the account menu, or the browser menu's **Install app** / **Add to Home screen**.
3. Confirm. The app appears in the launcher; long-press its icon for the Inbox, Decisions, Tasks, and New task shortcuts.

## iPhone and iPad (Safari)

1. Open the board in Safari.
2. Tap **Install** on the Home card or **Install app** in the account menu for the steps, or directly: tap **Share**, then **Add to Home Screen**.
3. Keep **Open as Web App** on and tap **Add**.

## Desktop (Chrome, Edge, Safari on macOS)

Use **Install app** in the account menu, the install icon in the address bar, or Safari's **File → Add to Dock**. Chrome and Edge draw the Wardmote name and Inbox count in the window title bar (window controls overlay); a Wardmote link opened elsewhere reuses the open window.

## Using the installed app

- A slim toolbar at the top provides **Back**, **Refresh**, **Share**, and **Open in Browser**, since the app has no browser address bar. Android's back button and the iOS back gesture follow the in-app history; the breadcrumb is always a way back.
- Notification permission is offered after your first decision (approve, decline, or answer), not on the first visit.
- Updates never reload the app on their own: when a new version is ready, a **Reload** toast appears and the new version loads when you press it.

## Offline

- The last pages you opened, and what they showed, stay readable offline. A banner says when the data was loaded.
- Approve, Decline, Reject, and reply stay disabled until the connection returns. Nothing is queued for later.
- When the connection returns, the board reloads its data once.
- What is stored: the app shell (HTML, scripts, styles, fonts) and the last response of a fixed list of read-only board routes (organizations, tasks, comments, approvals, inbox, dashboard), kept per signed-in account and refreshed at most every 30 seconds per route. Secrets, keys, tokens, invites, agent configuration, instance settings, and any response marked `no-store` are never stored.
- Signing out, a session that ends (401), losing access to the session (403), or another account signing in on the same device deletes the stored board data. Losing access to one route (403) deletes only that route's copy.

## Troubleshooting

- **No Install option:** confirm the page is on HTTPS and that `/site.webmanifest` and `/sw.js` load without a login redirect. Authenticating proxies must allow credentialed requests to the manifest.
- **Opens in the browser instead of an app on iOS:** remove the icon and add it again with **Open as Web App** turned on.
