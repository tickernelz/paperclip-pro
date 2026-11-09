import { afterEach, describe, expect, it } from "vitest";
import { buildPaperclipEnv } from "../adapters/utils.js";

const ORIGINAL_WARDMOTE_RUNTIME_API_URL = process.env.WARDMOTE_RUNTIME_API_URL;
const ORIGINAL_WARDMOTE_API_URL = process.env.WARDMOTE_API_URL;
const ORIGINAL_WARDMOTE_LISTEN_HOST = process.env.WARDMOTE_LISTEN_HOST;
const ORIGINAL_WARDMOTE_LISTEN_PORT = process.env.WARDMOTE_LISTEN_PORT;
const ORIGINAL_WARDMOTE_API_URL_OVERRIDE = process.env.WARDMOTE_API_URL_OVERRIDE;
const ORIGINAL_HOST = process.env.HOST;
const ORIGINAL_PORT = process.env.PORT;

afterEach(() => {
  if (ORIGINAL_WARDMOTE_RUNTIME_API_URL === undefined) delete process.env.WARDMOTE_RUNTIME_API_URL;
  else process.env.WARDMOTE_RUNTIME_API_URL = ORIGINAL_WARDMOTE_RUNTIME_API_URL;

  if (ORIGINAL_WARDMOTE_API_URL === undefined) delete process.env.WARDMOTE_API_URL;
  else process.env.WARDMOTE_API_URL = ORIGINAL_WARDMOTE_API_URL;

  if (ORIGINAL_WARDMOTE_LISTEN_HOST === undefined) delete process.env.WARDMOTE_LISTEN_HOST;
  else process.env.WARDMOTE_LISTEN_HOST = ORIGINAL_WARDMOTE_LISTEN_HOST;

  if (ORIGINAL_WARDMOTE_LISTEN_PORT === undefined) delete process.env.WARDMOTE_LISTEN_PORT;
  else process.env.WARDMOTE_LISTEN_PORT = ORIGINAL_WARDMOTE_LISTEN_PORT;

  if (ORIGINAL_WARDMOTE_API_URL_OVERRIDE === undefined) delete process.env.WARDMOTE_API_URL_OVERRIDE;
  else process.env.WARDMOTE_API_URL_OVERRIDE = ORIGINAL_WARDMOTE_API_URL_OVERRIDE;

  if (ORIGINAL_HOST === undefined) delete process.env.HOST;
  else process.env.HOST = ORIGINAL_HOST;

  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
});

describe("buildPaperclipEnv", () => {
  it("prefers an explicit WARDMOTE_API_URL override over the derived runtime URL", () => {
    process.env.WARDMOTE_RUNTIME_API_URL = "http://203.0.113.42:3102";
    process.env.WARDMOTE_API_URL = "http://localhost:4100";
    process.env.WARDMOTE_LISTEN_HOST = "127.0.0.1";
    process.env.WARDMOTE_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.WARDMOTE_API_URL).toBe("http://localhost:4100");
  });

  it("falls back to WARDMOTE_RUNTIME_API_URL when no explicit override is set", () => {
    process.env.WARDMOTE_RUNTIME_API_URL = "http://203.0.113.42:3102";
    delete process.env.WARDMOTE_API_URL;
    process.env.WARDMOTE_LISTEN_HOST = "127.0.0.1";
    process.env.WARDMOTE_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.WARDMOTE_API_URL).toBe("http://203.0.113.42:3102");
  });

  it("falls back to WARDMOTE_API_URL when no runtime URL is configured", () => {
    delete process.env.WARDMOTE_RUNTIME_API_URL;
    process.env.WARDMOTE_API_URL = "http://localhost:4100";
    process.env.WARDMOTE_LISTEN_HOST = "127.0.0.1";
    process.env.WARDMOTE_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.WARDMOTE_API_URL).toBe("http://localhost:4100");
  });

  it("uses runtime listen host/port when explicit URL is not set", () => {
    delete process.env.WARDMOTE_RUNTIME_API_URL;
    delete process.env.WARDMOTE_API_URL;
    process.env.WARDMOTE_LISTEN_HOST = "0.0.0.0";
    process.env.WARDMOTE_LISTEN_PORT = "3101";
    process.env.PORT = "3100";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.WARDMOTE_API_URL).toBe("http://localhost:3101");
  });

  it("formats IPv6 hosts safely in fallback URL generation", () => {
    delete process.env.WARDMOTE_RUNTIME_API_URL;
    delete process.env.WARDMOTE_API_URL;
    process.env.WARDMOTE_LISTEN_HOST = "::1";
    process.env.WARDMOTE_LISTEN_PORT = "3101";

    const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" });

    expect(env.WARDMOTE_API_URL).toBe("http://[::1]:3101");
  });

  describe("with a public base URL behind a tunnel", () => {
    function bootLikeServer(listenHost: string) {
      process.env.WARDMOTE_RUNTIME_API_URL = "https://paperclip.example.com";
      process.env.WARDMOTE_API_URL = "https://paperclip.example.com";
      process.env.WARDMOTE_LISTEN_HOST = listenHost;
      process.env.WARDMOTE_LISTEN_PORT = "3100";
      delete process.env.WARDMOTE_API_URL_OVERRIDE;
    }

    it("hands same-host agents the loopback listener instead of the tunnel", () => {
      bootLikeServer("127.0.0.1");
      const env = buildPaperclipEnv({ id: "agent-1", companyId: "company-1" }, { sameHost: true });
      expect(env.WARDMOTE_API_URL).toBe("http://127.0.0.1:3100");
    });

    it("maps a wildcard bind to the loopback of the same address family", () => {
      bootLikeServer("0.0.0.0");
      expect(buildPaperclipEnv({ id: "a", companyId: "c" }, { sameHost: true }).WARDMOTE_API_URL).toBe(
        "http://127.0.0.1:3100",
      );
      bootLikeServer("::");
      expect(buildPaperclipEnv({ id: "a", companyId: "c" }, { sameHost: true }).WARDMOTE_API_URL).toBe(
        "http://[::1]:3100",
      );
    });

    it("keeps the public origin for agents that run elsewhere", () => {
      bootLikeServer("127.0.0.1");
      expect(buildPaperclipEnv({ id: "agent-1", companyId: "company-1" }).WARDMOTE_API_URL).toBe(
        "https://paperclip.example.com",
      );
      expect(
        buildPaperclipEnv({ id: "agent-1", companyId: "company-1" }, { sameHost: false }).WARDMOTE_API_URL,
      ).toBe("https://paperclip.example.com");
    });

    it("lets an operator-pinned WARDMOTE_API_URL win for same-host agents", () => {
      bootLikeServer("127.0.0.1");
      process.env.WARDMOTE_API_URL = "http://10.0.0.5:3100";
      process.env.WARDMOTE_API_URL_OVERRIDE = "http://10.0.0.5:3100";
      expect(buildPaperclipEnv({ id: "a", companyId: "c" }, { sameHost: true }).WARDMOTE_API_URL).toBe(
        "http://10.0.0.5:3100",
      );
    });
  });
});
