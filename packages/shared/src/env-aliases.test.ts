import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STATE_KEY = Symbol.for("wardmote.envAliases");

async function freshModule() {
  delete (globalThis as Record<symbol, unknown>)[STATE_KEY];
  vi.resetModules();
  return import("./env-aliases.js");
}

describe("process env aliases", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("PAPERCLIP_") || key.startsWith("WARDMOTE_")) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it("reads a legacy-only name and warns once per process", async () => {
    const { bootstrapEnvAliases } = await freshModule();
    process.env.PAPERCLIP_HOME = "/srv/legacy";
    const warn = vi.fn();
    bootstrapEnvAliases(warn);
    bootstrapEnvAliases(warn);
    expect(process.env.PAPERCLIP_HOME).toBe("/srv/legacy");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("PAPERCLIP_HOME -> WARDMOTE_HOME");
  });

  it("reads a new-only name without a warning", async () => {
    const { bootstrapEnvAliases } = await freshModule();
    process.env.WARDMOTE_HOME = "/srv/new";
    const warn = vi.fn();
    bootstrapEnvAliases(warn);
    expect(process.env.PAPERCLIP_HOME).toBe("/srv/new");
    expect(process.env.WARDMOTE_HOME).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets the new name win when both are set", async () => {
    const { bootstrapEnvAliases } = await freshModule();
    process.env.PAPERCLIP_HOME = "/srv/legacy";
    process.env.WARDMOTE_HOME = "/srv/new";
    const warn = vi.fn();
    bootstrapEnvAliases(warn);
    expect(process.env.PAPERCLIP_HOME).toBe("/srv/new");
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn again for a name another module copy already folded", async () => {
    const first = await freshModule();
    process.env.WARDMOTE_INSTANCE_ID = "lab";
    first.bootstrapEnvAliases(vi.fn());
    vi.resetModules();
    const second = await import("./env-aliases.js");
    const warn = vi.fn();
    second.bootstrapEnvAliases(warn);
    expect(process.env.PAPERCLIP_INSTANCE_ID).toBe("lab");
    expect(warn).not.toHaveBeenCalled();
  });

  it("folds a new name loaded later from an env file without warning about generated legacy names", async () => {
    const { applyEnvAliases, bootstrapEnvAliases } = await freshModule();
    const warn = vi.fn();
    bootstrapEnvAliases(warn);
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "generated";
    process.env.WARDMOTE_PUBLIC_URL = "https://example.test";
    applyEnvAliases();
    expect(process.env.PAPERCLIP_PUBLIC_URL).toBe("https://example.test");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("agent run env aliases", () => {
  it("twins small values, keeps large or JSON values under the legacy name only, and drops stale twins", async () => {
    const { withWardmoteEnvAliases, MAX_ALIASED_ENV_VALUE_BYTES } = await freshModule();
    const large = "x".repeat(MAX_ALIASED_ENV_VALUE_BYTES + 1);
    const env = withWardmoteEnvAliases({
      PAPERCLIP_RUN_ID: "run-1",
      PAPERCLIP_TASK_NOTES: large,
      PAPERCLIP_WORKSPACES_JSON: "[]",
      WARDMOTE_TASK_NOTES: "stale",
      WARDMOTE_RUN_ID: "stale",
      HOME: "/home/agent",
    });
    expect(env).toEqual({
      PAPERCLIP_RUN_ID: "run-1",
      WARDMOTE_RUN_ID: "run-1",
      PAPERCLIP_TASK_NOTES: large,
      PAPERCLIP_WORKSPACES_JSON: "[]",
      HOME: "/home/agent",
    });
  });
});
