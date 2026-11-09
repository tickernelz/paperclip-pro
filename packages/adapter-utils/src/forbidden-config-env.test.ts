import { describe, expect, it } from "vitest";
import { isForbiddenConfigEnvKey, sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("agent run config env", () => {
  it("forbids runtime identity keys in config env regardless of case", () => {
    for (const name of ["API_KEY", "WAKE_PAYLOAD_JSON", "AGENT_KEY_ID", "AGENT_PUBLIC_KEY", "AGENT_PRIVATE_KEY"]) {
      expect(isForbiddenConfigEnvKey(`WARDMOTE_${name}`), name).toBe(true);
    }
    expect(isForbiddenConfigEnvKey("wardmote_agent_private_key")).toBe(true);
    expect(isForbiddenConfigEnvKey("WARDMOTE_CUSTOM")).toBe(false);
  });

  it("drops inherited runtime identity keys", () => {
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
