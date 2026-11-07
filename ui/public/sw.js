const BUILD_ID = "__PAPERCLIP_BUILD_ID__";
const SHELL_CACHE = `wardmote-shell-${BUILD_ID}`;
const DATA_CACHE_PREFIX = "wardmote-data-";
const LEGACY_CACHE_PREFIX = "paperclip-public-assets-";
const SHELL_KEY = "/__wardmote_shell__";
const CACHED_AT_HEADER = "x-wardmote-cached-at";
const MAX_DATA_ENTRIES = 400;
const SKIP_WAITING_MESSAGE = "wardmote.skip-waiting";
const CLEAR_OFFLINE_DATA_MESSAGE = "wardmote.clear-offline-data";
const SESSION_PATH = "/api/auth/get-session";
const privateRequests = new Set();
const privateCacheControl = /(?:^|,)\s*(?:no-store|private)(?:\s*(?:,|=)|\s*$)/i;
const noStoreCacheControl = /(?:^|,)\s*no-store(?:\s*(?:,|=)|\s*$)/i;
const ID = "[^/]+";
const OFFLINE_READABLE_API = [
  "/api/health",
  SESSION_PATH,
  "/api/companies",
  "/api/sidebar-preferences/me",
  "/api/instance/settings/experimental",
  `/api/companies/${ID}/(?:agents|approvals|attention|dashboard|decision-queues|inbox-dismissals|issues|labels|live-runs|projects|sidebar-badges|sidebar-preferences/me|primary-agent/me|resource-memberships/me|user-directory|routines)`,
  `/api/issues/${ID}`,
  `/api/issues/${ID}/(?:comments|activity|documents|documents/plan|interactions|attachments|work-products|runs|live-runs|agent-todo|tree-control/state|tree-holds)`,
  `/api/approvals/${ID}`,
  `/api/approvals/${ID}/(?:comments|issues)`,
].map((pattern) => new RegExp(`^${pattern}$`));
const NEVER_CACHED_API = /(?:secret|token|key|credential|password|oauth|invite|cli-auth|env|login|sign-)/i;

// Static recovery only: never cache or embed authenticated page content here.
const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d0e11">
<title>Wardmote is offline</title>
<style>
:root { color-scheme: dark light; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #0d0e11; color: #f1f2f5; padding: env(safe-area-inset-top) 24px env(safe-area-inset-bottom); }
@media (prefers-color-scheme: light) { body { background: #f6f7f9; color: #1f2229; } button { background: #1f2229; color: #f6f7f9; } }
main { max-width: 320px; text-align: center; }
h1 { font-size: 18px; margin: 16px 0 4px; }
p { margin: 0 0 20px; opacity: 0.75; }
button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 10px 20px; background: #f1f2f5; color: #0d0e11; }
</style>
</head>
<body>
<main>
<svg width="56" height="56" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><circle cx="256" cy="256" r="72.46"/><circle cx="256" cy="89.54" r="54.83"/><circle cx="400.16" cy="172.77" r="54.83" fill="#919dff"/><circle cx="400.16" cy="339.23" r="54.83"/><circle cx="256" cy="422.46" r="54.83"/><circle cx="111.84" cy="339.23" r="54.83"/><circle cx="111.84" cy="172.77" r="54.83"/></svg>
<h1>Wardmote is offline</h1>
<p>Wardmote needs a connection to your server. It will reload once you're back online.</p>
<button type="button" onclick="window.location.reload()">Reload page</button>
</main>
<script>addEventListener("online", () => location.reload());</script>
</body>
</html>`;

function offlineNavigationResponse() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isOfflineReadableApi(url) {
  if (url.origin !== self.location.origin || NEVER_CACHED_API.test(url.pathname)) return false;
  return OFFLINE_READABLE_API.some((pattern) => pattern.test(url.pathname));
}

async function evictRequest(request) {
  await Promise.all((await caches.keys()).map(async (key) => {
    const cache = await caches.open(key);
    await cache.delete(request, { ignoreVary: true });
  }));
}

async function currentDataCacheName() {
  return (await caches.keys()).find((key) => key.startsWith(DATA_CACHE_PREFIX)) ?? null;
}

async function clearOfflineData(keep = null) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(DATA_CACHE_PREFIX) && key !== keep).map((key) => caches.delete(key)));
}

async function sessionCacheName(response) {
  const payload = await response.clone().json().catch(() => null);
  const session = payload?.session ?? payload?.data?.session;
  if (typeof session?.id !== "string" || typeof session?.userId !== "string") return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.userId + "\n" + session.id));
  return DATA_CACHE_PREFIX + [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rememberOfflineReadable(request, url, response) {
  if (response.status === 401 || response.status === 403) {
    await clearOfflineData();
    return;
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || noStoreCacheControl.test(cacheControl) || !contentType.includes("application/json")) return;
  let cacheName;
  if (url.pathname === SESSION_PATH) {
    cacheName = await sessionCacheName(response);
    if (!cacheName) {
      await clearOfflineData();
      return;
    }
    await clearOfflineData(cacheName);
  } else {
    cacheName = await currentDataCacheName();
    if (!cacheName) return;
  }
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, new Date().toISOString());
  const stored = new Response(await response.blob(), { status: 200, headers });
  const cache = await caches.open(cacheName);
  await cache.put(request, stored);
  const keys = await cache.keys();
  if (keys.length > MAX_DATA_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - MAX_DATA_ENTRIES).map((key) => cache.delete(key)));
  }
}

async function offlineReadable(request) {
  const cacheName = await currentDataCacheName();
  if (!cacheName) return Response.error();
  const cached = await (await caches.open(cacheName)).match(request);
  return cached ?? Response.error();
}

function handleOfflineReadableApi(event, url) {
  const { request } = event;
  event.respondWith(
    fetch(request).then(
      (response) => {
        event.waitUntil(rememberOfflineReadable(request, url, response.clone()).catch(() => {}));
        return response;
      },
      () => offlineReadable(request).catch(() => Response.error()),
    ),
  );
}

function handleNavigation(event) {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const contentType = response.headers.get("content-type") ?? "";
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (response.ok && contentType.includes("text/html") && !privateCacheControl.test(cacheControl)) {
          const clone = response.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_KEY, clone)).catch(() => {}));
        }
        return response;
      })
      .catch(async () => {
        try {
          const shell = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY);
          if (shell) return shell;
        } catch {
          return offlineNavigationResponse();
        }
        return offlineNavigationResponse();
      }),
  );
}

const NOTIFICATION_MESSAGE = "paperclip.notification";
const NAVIGATE_MESSAGE = "paperclip.navigate";

function readPushNotification(event) {
  if (!event.data) return null;
  try {
    const notification = event.data.json()?.notification;
    if (!notification || typeof notification.key !== "string" || typeof notification.title !== "string") return null;
    return notification;
  } catch {
    return null;
  }
}

function sameOriginPath(url) {
  try {
    const target = new URL(typeof url === "string" ? url : "/", self.location.origin);
    return target.origin === self.location.origin ? target.pathname + target.search + target.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  const notification = readPushNotification(event);
  if (!notification) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: NOTIFICATION_MESSAGE, notification });
    const visible = windows.some((client) => client.visibilityState === "visible");
    await self.registration.showNotification(notification.title, {
      body: typeof notification.body === "string" ? notification.body : "",
      tag: notification.key,
      data: { url: sameOriginPath(notification.url) },
      icon: "/pwa-192x192.png",
      badge: "/pwa-monochrome-512x512.png",
      silent: visible,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOriginPath(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((candidate) => candidate.visibilityState === "visible") ?? windows[0];
    if (!client) {
      await self.clients.openWindow(url);
      return;
    }
    client.postMessage({ type: NAVIGATE_MESSAGE, url });
    await client.focus().catch(() => client);
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === SKIP_WAITING_MESSAGE) {
    self.skipWaiting();
  } else if (type === CLEAR_OFFLINE_DATA_MESSAGE) {
    event.waitUntil(clearOfflineData().catch(() => {}));
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      if (keys.some((key) => key.startsWith(LEGACY_CACHE_PREFIX))) return self.skipWaiting();
      return undefined;
    }).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE && !key.startsWith(DATA_CACHE_PREFIX)).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Vite owns development module revalidation and HMR. Passing that graph
  // through an offline worker can forward bodyless 304 responses on reload.
  // Only a stamped production build has an offline-cache contract.
  if (BUILD_ID.startsWith("__")) return;
  const { request } = event;
  const url = new URL(request.url);
  // Only immutable Vite build assets have a public offline-cache contract.
  // Never infer that application/extension responses are public from absent
  // headers, or from an in-memory classification lost when this worker restarts.
  const publicAsset = url.origin === self.location.origin && !url.search &&
    (/^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9.]+$/.test(url.pathname) || /^\/fonts\/[^/]+\.woff2$/.test(url.pathname));

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api")) {
    const eventStream = request.headers.get("accept")?.includes("text/event-stream") === true;
    if (request.cache !== "no-store" && !eventStream && isOfflineReadableApi(url)) handleOfflineReadableApi(event, url);
    return;
  }
  if (request.cache === "no-store") {
    privateRequests.add(request.url);
    event.waitUntil(evictRequest(request).catch(() => {}));
    return;
  }

  // Vite development modules use the browser's conditional-response cache.
  // Passing their requests through fetch/respondWith can return a bodyless 304
  // to the module loader on reload and leave the app root empty. They are not
  // build assets and have no offline contract, so leave them to the browser.
  if (url.origin === self.location.origin &&
      /^\/(?:@fs|@vite|@id|src|node_modules)\//.test(url.pathname)) {
    return;
  }

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    handleNavigation(event);
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (privateCacheControl.test(cacheControl)) {
          // Revoke earlier cacheable responses too. Keep an in-memory denylist
          // if storage is unavailable so offline fallback still fails closed.
          privateRequests.add(request.url);
          await evictRequest(request).catch(() => {});
        } else if (response.ok && publicAsset && !privateRequests.has(request.url)) {
          const clone = response.clone();
          await caches.open(SHELL_CACHE).then(async (cache) => {
            await cache.put(request, clone);
            // A concurrent response may have revoked this URL during put().
            if (privateRequests.has(request.url)) await cache.delete(request, { ignoreVary: true });
          }).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        if (privateRequests.has(request.url) || !publicAsset) return Response.error();
        try {
          const cached = await (await caches.open(SHELL_CACHE)).match(request);
          if (cached && !privateCacheControl.test(cached.headers.get("cache-control") ?? "")) return cached;
        } catch {
          return Response.error();
        }
        return Response.error();
      })
  );
});
