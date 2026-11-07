import { describe, expect, it } from "vitest";
import { buildAgentOnboardingPrompt } from "./agent-onboarding-prompt";

describe("buildAgentOnboardingPrompt", () => {
  it("lists reachable onboarding documents and the safe key-claim rules without gateway-specific setup", () => {
    const prompt = buildAgentOnboardingPrompt({
      onboardingTextUrl: "http://localhost:3100/api/invites/token-123/onboarding.txt",
      connectionCandidates: ["http://192.168.1.10:3100"],
    });

    expect(prompt).toContain("- http://localhost:3100/api/invites/token-123/onboarding.txt");
    expect(prompt).toContain("http://192.168.1.10:3100/api/invites/token-123/onboarding.txt");
    expect(prompt).toContain("Do not rotate or invent a Paperclip key manually");
    expect(prompt).toContain("parsed `token` field from the raw HTTP JSON response");
    expect(prompt).toContain("A token value containing literal `...` or `[redacted]`");
    expect(prompt).not.toMatch(/hermes/i);
  });
});
