import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFile } from "../config-file.js";
import { publicChatTaskUrl, safeChatTaskUrl } from "./chat-task-url.js";
import { safeMilestoneText } from "./chat-run-publications.js";
import { publicChatInteractionTaskUrl } from "./chat-interaction-publications.js";

vi.mock("../config-file.js", () => ({
  readConfigFile: vi.fn(() => null),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(readConfigFile).mockReturnValue(null);
});

describe("external Wardmote task links", () => {
  it("resolves the configured public origin at use time", () => {
    vi.stubEnv("WARDMOTE_AUTH_PUBLIC_BASE_URL", "https://board.example");
    expect(publicChatTaskUrl("issue-1")).toBe("https://board.example/issues/issue-1");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe("https://board.example/issues/issue-1");
  });

  it("uses only the safe board origin and canonical issue path", () => {
    expect(
      safeChatTaskUrl(
        "https://board.example/path?secret=ignored#fragment",
        "issue-1",
      ),
    ).toBe("https://board.example/issues/issue-1");
    expect(safeChatTaskUrl("https://board.example", "a/b?c")).toBe(
      "https://board.example/issues/a%2Fb%3Fc",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "not a URL",
    "http://board.example",
    "http://127.0.0.1:3103",
    "https://localhost",
    "https://10.0.0.1",
    "https://board.internal",
    "https://user:secret@board.example",
  ])(
    "omits unsafe or private board links before generating recovery copy (%s)",
    (baseUrl) => {
      expect(safeChatTaskUrl(baseUrl, "issue-1")).toBeNull();
      expect(
        safeMilestoneText({
          agentName: "Maya",
          milestone: "failed",
          issueId: "issue-1",
          publicBaseUrl: baseUrl,
        }),
      ).toBe(
        "Maya stopped before completing this turn. Open the task in Wardmote for details.",
      );
    },
  );

  it("does not use webhook ingress as the question or confirmation destination", () => {
    for (const name of [
      "WARDMOTE_PUBLIC_URL",
      "WARDMOTE_AUTH_PUBLIC_BASE_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_BASE_URL",
      "WARDMOTE_MANAGED_RUNTIME_PUBLIC_URL",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv("WARDMOTE_CHAT_WEBHOOK_PUBLIC_URL", "https://ingress.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBeNull();
    vi.stubEnv("WARDMOTE_PUBLIC_URL", "http://127.0.0.1:3103");
    expect(publicChatInteractionTaskUrl("issue-1")).toBeNull();
    vi.stubEnv("WARDMOTE_PUBLIC_URL", "https://board.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://board.example/issues/issue-1",
    );
    vi.stubEnv("WARDMOTE_AUTH_PUBLIC_BASE_URL", "https://canonical.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://canonical.example/issues/issue-1",
    );
  });

  it("uses the configured board origin ahead of the managed-runtime fallback", () => {
    for (const name of [
      "WARDMOTE_PUBLIC_URL",
      "WARDMOTE_AUTH_PUBLIC_BASE_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_BASE_URL",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv(
      "WARDMOTE_MANAGED_RUNTIME_PUBLIC_URL",
      "https://managed.example",
    );
    vi.mocked(readConfigFile).mockReturnValue({
      auth: { publicBaseUrl: "https://configured.example" },
    } as ReturnType<typeof readConfigFile>);

    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://configured.example/issues/issue-1",
    );

    vi.stubEnv("WARDMOTE_PUBLIC_URL", "https://environment.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://environment.example/issues/issue-1",
    );
  });
});
