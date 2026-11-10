import { describe, expect, it } from "vitest";
import { isForbiddenConfigEnvKey, sanitizeInheritedWardmoteEnv } from "./server-utils.js";
import { RETIRED_ENV_PREFIX } from "@tickernelz/wardmote-shared/retired-env-file";

describe("agent run config env", () => {
  it("forbids runtime identity keys in config env regardless of case", () => {
    for (const name of ["API_KEY", "WAKE_PAYLOAD_JSON", "AGENT_KEY_ID", "AGENT_PUBLIC_KEY", "AGENT_PRIVATE_KEY"]) {
      expect(isForbiddenConfigEnvKey(`WARDMOTE_${name}`), name).toBe(true);
    }
    expect(isForbiddenConfigEnvKey("wardmote_agent_private_key")).toBe(true);
    expect(isForbiddenConfigEnvKey("WARDMOTE_CUSTOM")).toBe(false);
  });

  it("forbids runtime identity keys under the retired prefix", () => {
    for (const name of ["API_KEY", "WAKE_PAYLOAD_JSON", "AGENT_KEY_ID", "AGENT_PUBLIC_KEY", "AGENT_PRIVATE_KEY"]) {
      expect(isForbiddenConfigEnvKey(`${RETIRED_ENV_PREFIX}${name}`), name).toBe(true);
    }
    expect(isForbiddenConfigEnvKey(`${RETIRED_ENV_PREFIX}agent_private_key`.toLowerCase())).toBe(true);
  });


  it("drops inherited runtime identity keys under both prefixes", () => {
    expect(sanitizeInheritedWardmoteEnv({
      WARDMOTE_API_KEY: "leak",
      WARDMOTE_AGENT_PRIVATE_KEY: "leak",
      wardmote_agent_key_id: "leak",
      [`${RETIRED_ENV_PREFIX}API_KEY`]: "leak",
      [`${RETIRED_ENV_PREFIX}AGENT_PRIVATE_KEY`]: "leak",
      [`${RETIRED_ENV_PREFIX}RUN_ID`]: "leak",
      [`${RETIRED_ENV_PREFIX}agent_key_id`.toLowerCase()]: "leak",
      WARDMOTE_LISTEN_PORT: "3100",
      PATH: "/bin",
    })).toEqual({
      WARDMOTE_LISTEN_PORT: "3100",
      PATH: "/bin",
    });
  });
});
