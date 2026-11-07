// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://example.test";

class FakeCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === "string" ? new URL(request, ORIGIN).href : request.url, response);
  }
  async match(request: Request | string) {
    const hit = this.entries.get(typeof request === "string" ? new URL(request, ORIGIN).href : request.url);
    return hit?.clone();
  }
  async delete(request: Request | string) {
    return this.entries.delete(typeof request === "string" ? new URL(request, ORIGIN).href : request.url);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async keys() {
    return [...this.stores.keys()];
  }
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

function json(body: unknown, init: ResponseInit & { cacheControl?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": init.cacheControl ?? "private, must-revalidate" },
  });
}

function session(userId: string, id = "paperclip:session:" + userId) {
  return { session: { id, userId }, user: { id: userId, email: null, name: userId, image: null }, sentryDsn: null };
}

function worker(initialCaches: string[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const storage = new FakeCacheStorage();
  for (const name of initialCaches) void storage.open(name);
  const fetch = vi.fn<(request: Request) => Promise<Response>>();
  const skipWaiting = vi.fn(async () => undefined);
  const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8").replace("__PAPERCLIP_BUILD_ID__", "fixture-production");
  vm.runInNewContext(source, {
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
      skipWaiting,
      clients: { claim: vi.fn() },
    },
    URL, Request, Response, Headers, TextEncoder, crypto, fetch, caches: storage,
  });

  async function get(pathname: string, init: RequestInit & { mode?: RequestMode } = {}) {
    const pending: Promise<unknown>[] = [];
    let responded: Promise<Response> | Response | undefined;
    const { mode, ...requestInit } = init;
    const request = new Request(ORIGIN + pathname, requestInit);
    if (mode === "navigate") Object.defineProperty(request, "mode", { value: "navigate" });
    handlers.get("fetch")!({
      request,
      respondWith: (value: Promise<Response> | Response) => {
        responded = value;
      },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    const response = responded ? await responded : undefined;
    while (pending.length) await pending.shift();
    return response;
  }

  async function message(type: string) {
    const pending: Promise<unknown>[] = [];
    handlers.get("message")!({ data: { type }, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  async function dataEntries() {
    const names = (await storage.keys()).filter((name) => name.startsWith("wardmote-data-"));
    const result: Record<string, string[]> = {};
    for (const name of names) result[name] = [...(await storage.open(name)).entries.keys()].map((url) => new URL(url).pathname + new URL(url).search);
    return result;
  }

  return { handlers, storage, fetch, skipWaiting, get, message, dataEntries };
}

async function signedIn(userId = "user-a") {
  const w = worker();
  w.fetch.mockResolvedValueOnce(json(session(userId)));
  await w.get("/api/auth/get-session");
  return w;
}

describe("service worker offline data (per-session cache)", () => {
  it("keeps the last allowlisted GET of the signed-in user and serves it when the network is gone", async () => {
    const w = await signedIn();
    w.fetch.mockResolvedValueOnce(json([{ id: "issue-1", title: "Plan" }]));
    await w.get("/api/companies/c1/issues?status=todo");
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const offline = await w.get("/api/companies/c1/issues?status=todo");
    expect(offline?.status).toBe(200);
    expect(await offline?.json()).toEqual([{ id: "issue-1", title: "Plan" }]);
    expect(offline?.headers.get("x-wardmote-cached-at")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stores nothing before the session response names the user", async () => {
    const w = worker();
    w.fetch.mockResolvedValueOnce(json([{ id: "issue-1" }]));
    await w.get("/api/companies/c1/issues");
    expect(await w.dataEntries()).toEqual({});
  });

  it.each([
    "/api/companies/c1/secrets",
    "/api/companies/c1/secret-proposals",
    "/api/agents/a1/keys",
    "/api/agents/a1",
    "/api/agents/a1/runtime-env",
    "/api/cli-auth/me",
    "/api/auth/profile",
    "/api/instance/settings/general",
    "/api/companies/c1/invites",
    "/api/companies/c1/oauth/connections",
    "/api/issues/i1/browsers",
    "/api/plugins/ui-contributions",
    "/api/companies/c1/agents/a1/api-keys",
  ])("never stores or serves %s offline", async (pathname) => {
    const w = await signedIn();
    w.fetch.mockResolvedValueOnce(json({ token: "secret-value" }));
    const response = await w.get(pathname);
    expect(Object.values(await w.dataEntries()).flat()).not.toContain(pathname);
    if (response) expect(await response.json()).toEqual({ token: "secret-value" });
    w.fetch.mockRejectedValue(new TypeError("offline"));
    expect(await w.get(pathname)).toBeUndefined();
  });

  it("never stores an allowlisted response marked no-store, or a no-store request", async () => {
    const w = await signedIn();
    w.fetch.mockResolvedValueOnce(json([{ id: "a" }], { cacheControl: "no-store, private" }));
    await w.get("/api/companies/c1/agents");
    w.fetch.mockResolvedValueOnce(json([{ id: "b" }]));
    expect(await w.get("/api/companies/c1/projects", { cache: "no-store" })).toBeUndefined();
    expect(Object.values(await w.dataEntries()).flat()).toEqual(["/api/auth/get-session"]);
  });

  it("never stores live streams", async () => {
    const w = await signedIn();
    expect(await w.get("/api/companies/c1/live-runs", { headers: { accept: "text/event-stream" } })).toBeUndefined();
    expect(w.fetch).toHaveBeenCalledTimes(1);
  });

  it("drops every offline copy when the session ends with 401", async () => {
    const w = await signedIn();
    w.fetch.mockResolvedValueOnce(json([{ id: "issue-1" }]));
    await w.get("/api/companies/c1/issues");
    w.fetch.mockResolvedValueOnce(json({ error: "unauthorized" }, { status: 401 }));
    await w.get("/api/companies/c1/issues");
    expect(await w.dataEntries()).toEqual({});
    w.fetch.mockRejectedValue(new TypeError("offline"));
    expect((await w.get("/api/companies/c1/issues"))?.type).toBe("error");
  });

  it("drops the previous user's copies when another user signs in on the same device", async () => {
    const w = await signedIn("user-a");
    w.fetch.mockResolvedValueOnce(json([{ id: "issue-of-a" }]));
    await w.get("/api/companies/c1/issues");
    w.fetch.mockResolvedValueOnce(json(session("user-b")));
    await w.get("/api/auth/get-session");
    const entries = await w.dataEntries();
    expect(Object.keys(entries)).toHaveLength(1);
    expect(Object.values(entries).flat()).toEqual(["/api/auth/get-session"]);
    w.fetch.mockRejectedValue(new TypeError("offline"));
    expect((await w.get("/api/companies/c1/issues"))?.type).toBe("error");
  });

  it("clears offline copies on the sign-out message but keeps the app shell", async () => {
    const w = await signedIn();
    w.fetch.mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "content-type": "text/html", "cache-control": "no-cache" } }));
    await w.get("/WAR/inbox", { mode: "navigate" });
    await w.message("wardmote.clear-offline-data");
    expect(await w.dataEntries()).toEqual({});
    expect(await w.storage.keys()).toEqual(["wardmote-shell-fixture-production"]);
  });

  it("boots the cached app shell for an offline navigation, and never a private page", async () => {
    const w = worker();
    w.fetch.mockResolvedValueOnce(new Response("<!doctype html><title>shell</title>", { headers: { "content-type": "text/html", "cache-control": "no-cache" } }));
    await w.get("/WAR/issues/WAR-1", { mode: "navigate" });
    w.fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(await (await w.get("/WAR/dashboard", { mode: "navigate" }))?.text()).toContain("<title>shell</title>");

    const fresh = worker();
    fresh.fetch.mockResolvedValueOnce(new Response("<p>private</p>", { headers: { "content-type": "text/html", "cache-control": "private" } }));
    await fresh.get("/WAR/inbox", { mode: "navigate" });
    fresh.fetch.mockRejectedValueOnce(new TypeError("offline"));
    const offline = await fresh.get("/WAR/inbox", { mode: "navigate" });
    expect(offline?.status).toBe(503);
    expect(await offline?.text()).not.toContain("private");
  });
});

describe("service worker update hand-off", () => {
  async function install(w: ReturnType<typeof worker>) {
    const pending: Promise<unknown>[] = [];
    w.handlers.get("install")!({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  it("waits for the user instead of taking over open tabs", async () => {
    const w = worker(["wardmote-shell-old"]);
    await install(w);
    expect(w.skipWaiting).not.toHaveBeenCalled();
    await w.message("wardmote.skip-waiting");
    expect(w.skipWaiting).toHaveBeenCalledOnce();
  });

  it("takes over at once from a legacy Paperclip worker whose tabs cannot show the update toast", async () => {
    const w = worker(["paperclip-public-assets-old"]);
    await install(w);
    expect(w.skipWaiting).toHaveBeenCalledOnce();
  });
});
