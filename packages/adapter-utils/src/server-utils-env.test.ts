import { describe, expect, it } from "vitest";
import { sanitizeInheritedWardmoteEnv } from "./server-utils.js";

describe("sanitizeInheritedWardmoteEnv", () => {
  it("drops the host-only Wardmote CLI command pointer", () => {
    expect(sanitizeInheritedWardmoteEnv({
      WARDMOTE_CMD: "node /missing/@tickernelz/wardmote/dist/index.js",
      [["PAPER", "CLIPAI_CMD"].join("")]: "node /missing/operator-cli.js",
      WARDMOTE_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      WARDMOTE_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("keeps agent processes from signalling the Wardmote systemd unit", () => {
    expect(sanitizeInheritedWardmoteEnv({
      NOTIFY_SOCKET: "/run/user/1000/systemd/notify",
      WATCHDOG_USEC: "30000000",
      WATCHDOG_PID: "1234",
      PATH: "/usr/bin",
    })).toEqual({ PATH: "/usr/bin" });
  });
});
