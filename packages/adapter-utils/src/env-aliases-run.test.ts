import { describe, expect, it } from "vitest";
import { isForbiddenConfigEnvKey, runChildProcess, sanitizeInheritedPaperclipEnv } from "./server-utils.js";

async function childEnv(env: Record<string, string>): Promise<Record<string, string>> {
  const result = await runChildProcess("env-alias-test", process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
    cwd: process.cwd(),
    env,
    timeoutSec: 30,
    graceSec: 1,
    onLog: async () => undefined,
  });
  return JSON.parse(result.stdout) as Record<string, string>;
}

describe("agent run env aliases", () => {
  it("gives a spawned run both names for small values and only the legacy name for large ones", async () => {
    const large = "y".repeat(5000);
    const seen = await childEnv({
      PAPERCLIP_RUN_ID: "run-7",
      PAPERCLIP_API_URL: "http://127.0.0.1:3100",
      PAPERCLIP_CONTEXT_NOTES: large,
      PAPERCLIP_WORKSPACES_JSON: "[{}]",
      WARDMOTE_CONTEXT_NOTES: "stale",
    });
    expect(seen.PAPERCLIP_RUN_ID).toBe("run-7");
    expect(seen.WARDMOTE_RUN_ID).toBe("run-7");
    expect(seen.WARDMOTE_API_URL).toBe("http://127.0.0.1:3100");
    expect(seen.PAPERCLIP_CONTEXT_NOTES).toBe(large);
    expect(seen.WARDMOTE_CONTEXT_NOTES).toBeUndefined();
    expect(seen.WARDMOTE_WORKSPACES_JSON).toBeUndefined();
  });

  it("treats WARDMOTE_* config keys like their PAPERCLIP_* names", () => {
    for (const name of ["API_KEY", "WAKE_PAYLOAD_JSON", "AGENT_KEY_ID", "AGENT_PUBLIC_KEY", "AGENT_PRIVATE_KEY"]) {
      expect(isForbiddenConfigEnvKey(`PAPERCLIP_${name}`), name).toBe(true);
      expect(isForbiddenConfigEnvKey(`WARDMOTE_${name}`), name).toBe(true);
    }
    expect(isForbiddenConfigEnvKey("wardmote_agent_private_key")).toBe(true);
    expect(isForbiddenConfigEnvKey("WARDMOTE_CUSTOM")).toBe(false);
    expect(sanitizeInheritedPaperclipEnv({
      WARDMOTE_API_KEY: "leak",
      WARDMOTE_AGENT_PRIVATE_KEY: "leak",
      wardmote_agent_key_id: "leak",
      WARDMOTE_LISTEN_PORT: "3100",
      PATH: "/bin",
    })).toEqual({
      WARDMOTE_LISTEN_PORT: "3100",
      PATH: "/bin",
    });
  });
});
