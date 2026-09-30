import { describe, expect, it } from "vitest";
import { classifyOmpFailure } from "./failure.js";

const CREDIT_EXHAUSTED =
  "Provider requested 1800000ms wait, exceeds retry.maxDelayMs (300000ms). Original error: 400 credit insufficient balance: balance=14655 required=14892 (request id: 20260929100202236343137c955d568mVpQoJbd)\ncredit insufficient balance: balance=14655 required=14892 (type=api_error param=insufficient_user_quota)";

const classify = (parsedError: string) =>
  classifyOmpFailure({ parsedError, stderr: "", timedOut: false, exitCode: 1, signal: null });

describe("classifyOmpFailure", () => {
  it("treats an exhausted provider credit balance as a quota failure with the provider's wait", () => {
    const before = Date.now();
    const result = classify(CREDIT_EXHAUSTED);
    expect(result.errorCode).toBe("omp_provider_quota");
    expect(result.errorFamily).toBe("provider_quota");
    const retryAt = Date.parse(result.retryNotBefore ?? "");
    expect(retryAt - before).toBeGreaterThanOrEqual(1_800_000 - 1_000);
    expect(retryAt - before).toBeLessThanOrEqual(1_800_000 + 5_000);
  });

  it.each([
    "402 insufficient balance on this account",
    "insufficient funds to complete the request",
    "Error: insufficient credit",
  ])("recognises %s as a quota failure", (message) => {
    expect(classify(message).errorFamily).toBe("provider_quota");
  });

  it("retries a start that OMP aborted because the system prompt kept changing before dispatch", () => {
    expect(
      classify("System prompt changed repeatedly during before_agent_start; original input was not delivered."),
    ).toEqual({
      errorCode: "omp_agent_start_policy_changed",
      errorFamily: "transient_upstream",
      retryNotBefore: null,
    });
  });

  it("keeps an unrelated exit as a plain exit code", () => {
    expect(classify("tool crashed unexpectedly")).toEqual({
      errorCode: "omp_exit_1",
      errorFamily: null,
      retryNotBefore: null,
    });
  });
});
