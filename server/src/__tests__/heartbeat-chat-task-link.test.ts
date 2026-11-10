import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWardmoteTaskMarkdown } from "../services/heartbeat.js";
import { readConfigFile } from "../config-file.js";

vi.mock("../config-file.js", () => ({ readConfigFile: vi.fn(() => null) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(readConfigFile).mockReturnValue(null);
});

const issue = { id: "task-123", identifier: "TEST-1", title: "Chat request" };

describe("external chat task link context", () => {
  it.each(["slack", "discord", "telegram", "agentmail"])(
    "supplies the public task link for fresh and resumed %s turns",
    (externalChatProvider) => {
      vi.stubEnv("WARDMOTE_AUTH_PUBLIC_BASE_URL", "https://board.example");
      vi.stubEnv("WARDMOTE_API_URL", "http://localhost:3100");
      for (const includeDescription of [true, false]) {
        for (const nativeRunner of [true, false]) {
          const markdown = buildWardmoteTaskMarkdown({ issue, externalChatProvider, nativeRunner, includeDescription });
          expect(markdown).toContain("Public task URL: https://board.example/issues/task-123");
          expect(markdown).toContain("use this exact URL");
          expect(markdown).toContain("Opening it still requires Wardmote access");
          expect(markdown).not.toContain("http://localhost:3100");
        }
      }
    },
  );

  it.each(["", "http://localhost:3100", "https://board.internal", "https://user:secret@board.example"])(
    "does not invent a task link from missing or unsafe configuration (%s)",
    (publicUrl) => {
      for (const name of ["WARDMOTE_AUTH_PUBLIC_BASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_BASE_URL", "WARDMOTE_PUBLIC_URL", "WARDMOTE_MANAGED_RUNTIME_PUBLIC_URL"]) vi.stubEnv(name, "");
      vi.stubEnv("WARDMOTE_PUBLIC_URL", publicUrl);
      vi.stubEnv("WARDMOTE_API_URL", "https://api.example");
      vi.stubEnv("WARDMOTE_CHAT_WEBHOOK_PUBLIC_URL", "https://ingress.example");
      const markdown = buildWardmoteTaskMarkdown({ issue, externalChatProvider: "slack" });
      expect(markdown).toContain("No public task URL is configured");
      expect(markdown).toContain("do not invent a URL");
      expect(markdown).not.toContain("Public task URL:");
      expect(markdown).not.toContain("https://api.example");
      expect(markdown).not.toContain("https://ingress.example");
    },
  );
});

describe("OpenWA external chat contract", () => {
  it("keeps OpenWA out of the generic external-chat file-delivery instructions", () => {
    for (const includeDescription of [true, false]) {
      for (const nativeRunner of [true, false]) {
        const openwa = buildWardmoteTaskMarkdown({ issue, externalChatProvider: "openwa", nativeRunner, includeDescription }) ?? "";
        expect(openwa).not.toContain("External chat file delivery");
        expect(openwa).not.toContain("wardmote-upload-artifact.sh");
        expect(openwa).not.toContain("register_deliverable");
        const slack = buildWardmoteTaskMarkdown({ issue, externalChatProvider: "slack", nativeRunner, includeDescription }) ?? "";
        expect(slack).toContain("External chat file delivery");
      }
    }
  });
});
