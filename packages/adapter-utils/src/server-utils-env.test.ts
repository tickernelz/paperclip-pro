import { describe, expect, it } from "vitest";
import { sanitizeInheritedPaperclipEnv } from "./server-utils.js";

describe("sanitizeInheritedPaperclipEnv", () => {
  it("drops the host-only Paperclip CLI command pointer", () => {
    expect(sanitizeInheritedPaperclipEnv({
      PAPERCLIPAI_CMD: "node /missing/@tickernelz/paperclip-pro/dist/index.js",
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PAPERCLIP_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });

  it("keeps agent processes from signalling the Paperclip systemd unit", () => {
    expect(sanitizeInheritedPaperclipEnv({
      NOTIFY_SOCKET: "/run/user/1000/systemd/notify",
      WATCHDOG_USEC: "30000000",
      WATCHDOG_PID: "1234",
      PATH: "/usr/bin",
    })).toEqual({ PATH: "/usr/bin" });
  });
});
