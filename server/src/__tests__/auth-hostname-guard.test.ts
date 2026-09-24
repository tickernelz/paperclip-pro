import express from "express";
import request from "supertest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { describe, expect, it } from "vitest";
import { privateHostnameGuard } from "../middleware/private-hostname-guard.js";
import { applyTrustProxy, parseTrustProxyEnv } from "../middleware/trust-proxy.js";

const PUBLIC_BASE_URL = "http://paperclip.example.test";
const PUBLIC_HOSTNAME = "paperclip.example.test";
const EMAIL = "intruder@example.com";
const PASSWORD = "correct-horse-battery-staple";

type MemoryStore = Record<string, Record<string, unknown>[]>;

function buildApp(opts: { trustProxy?: string } = {}) {
  const store: MemoryStore = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    secret: "better-auth-secret-for-hostname-guard-tests",
    baseURL: PUBLIC_BASE_URL,
    trustedOrigins: [PUBLIC_BASE_URL],
    database: memoryAdapter(store),
    emailAndPassword: { enabled: true, disableSignUp: false },
    advanced: { useSecureCookies: false },
  });

  const app = express();
  applyTrustProxy(app, parseTrustProxyEnv(opts.trustProxy));
  app.use(express.json());
  app.use(
    privateHostnameGuard({
      enabled: true,
      allowedHostnames: [PUBLIC_HOSTNAME],
      bindHost: "127.0.0.1",
    }),
  );
  app.get("/api/agents", (_req, res) => {
    res.json({ reached: "agents" });
  });
  app.all("/api/auth/{*authPath}", (req, res, next) => {
    void Promise.resolve(toNodeHandler(auth)(req, res)).catch(next);
  });
  return { app, store };
}

function signUp(app: express.Express, headers: Record<string, string>) {
  const pending = request(app).post("/api/auth/sign-up/email");
  for (const [name, value] of Object.entries(headers)) pending.set(name, value);
  return pending.send({ email: EMAIL, password: PASSWORD, name: "Intruder" });
}

describe("private hostname guard over the Better Auth mount", () => {
  it("refuses sign-up from a disallowed host that forges an allowed X-Forwarded-Host", async () => {
    const { app, store } = buildApp();

    const res = await signUp(app, { Host: "evil.example", "X-Forwarded-Host": PUBLIC_HOSTNAME });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("This hostname is not allowed");
    expect(store.user).toEqual([]);
  });

  it("treats the Better Auth mount exactly like any other API route", async () => {
    const { app } = buildApp();
    const forged = { Host: "evil.example", "X-Forwarded-Host": "localhost" };

    const authRes = await signUp(app, forged);
    const apiRes = await request(app).get("/api/agents").set(forged);

    expect(authRes.status).toBe(403);
    expect(apiRes.status).toBe(403);
  });

  it("refuses sign-up from a plain disallowed host", async () => {
    const { app, store } = buildApp();

    const res = await signUp(app, { Host: "evil.example" });

    expect(res.status).toBe(403);
    expect(store.user).toEqual([]);
  });

  it("lets the configured public base URL host reach Better Auth", async () => {
    const { app, store } = buildApp();

    const res = await signUp(app, { Host: PUBLIC_HOSTNAME });

    expect(res.status).toBe(200);
    expect(store.user?.map((row) => row.email)).toEqual([EMAIL]);
  });

  it("lets loopback reach Better Auth", async () => {
    const { app, store } = buildApp();

    const res = await signUp(app, { Host: "127.0.0.1:3100" });

    expect(res.status).toBe(200);
    expect(store.user?.map((row) => row.email)).toEqual([EMAIL]);
  });

  it("honours X-Forwarded-Host only when the operator declared the proxy trusted", async () => {
    const { app, store } = buildApp({ trustProxy: "true" });

    const res = await signUp(app, { Host: "evil.example", "X-Forwarded-Host": PUBLIC_HOSTNAME });

    expect(res.status).toBe(200);
    expect(store.user?.map((row) => row.email)).toEqual([EMAIL]);
  });
});
