import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { terminalAccessErrorMessage } from "./terminal-access";

describe("terminalAccessErrorMessage", () => {
  it("names the untrusted address and the fix instead of blaming the operator's role", () => {
    const error = new ApiError("This browser address is not trusted for terminal access.", 403, {
      error: "This browser address is not trusted for terminal access.",
      code: "terminal_origin_untrusted",
      remediation: "To use this address, add its hostname with npx @tickernelz/wardmote allowed-hostname <host>, restart Wardmote, and open http://<host>:3100.",
    });
    const message = terminalAccessErrorMessage(error, "fallback", "http://203.0.113.7:8080");
    expect(message).toBe(
      "The address you opened (http://203.0.113.7:8080) is not trusted for the terminal. To use this address, add its hostname with npx @tickernelz/wardmote allowed-hostname <host>, restart Wardmote, and open http://<host>:3100.",
    );
    expect(message).not.toMatch(/board operators/);
  });

  it("keeps the board-operator wording for role denials", () => {
    const error = new ApiError("Local terminals require an instance admin", 403, { error: "Local terminals require an instance admin" });
    expect(terminalAccessErrorMessage(error, "fallback", "http://203.0.113.7:3100")).toBe(
      "Terminal access is limited to board operators. Local terminals require an instance admin",
    );
  });
});
