import { describe, expect, it } from "vitest";
import { parseOmpSettingsCatalog } from "./settings-catalog.js";

const listText = [
  "Settings:",
  "",
  "[model]",
  "  retry.maxRetries = 10 (number)",
  "  defaultThinkingLevel = auto (minimal|low|medium|high|xhigh|max|auto)",
  "  searxng.endpoint = http://user:pw@host (string)",
  "  providers.foo.apiKey = (not set) (string)",
  "[internal]",
  "  auth.broker.token = (not set) (string)",
  "  modelRoles = {} (record)",
  "[tools]",
  "  bash.enabled = true (boolean)",
  "  vault.password = x (string)",
].join("\n");
const listJson = JSON.stringify({
  "retry.maxRetries": { value: 10, type: "number", description: "Maximum retry attempts on API errors" },
  defaultThinkingLevel: { value: "auto", type: "enum", description: "Reasoning depth" },
  "searxng.endpoint": { value: "http://user:pw@host", type: "string", description: "SearXNG URL" },
  "bash.enabled": { value: true, type: "boolean", description: "Enable the bash tool" },
});

describe("parseOmpSettingsCatalog", () => {
  it("lists visible settings with type, options and description", () => {
    const entries = parseOmpSettingsCatalog(listText, listJson);
    expect(entries.map((entry) => entry.key)).toEqual(["retry.maxRetries", "defaultThinkingLevel", "searxng.endpoint", "bash.enabled"]);
    expect(entries[1]).toEqual({ key: "defaultThinkingLevel", section: "model", type: "enum", options: ["minimal", "low", "medium", "high", "xhigh", "max", "auto"], description: "Reasoning depth", value: "auto" });
  });

  it("never returns internal settings, credential keys, or the machine's string values", () => {
    const entries = parseOmpSettingsCatalog(listText, listJson);
    expect(entries.some((entry) => entry.section === "internal")).toBe(false);
    expect(entries.some((entry) => /apiKey|password|token/.test(entry.key))).toBe(false);
    expect(entries.find((entry) => entry.key === "searxng.endpoint")).not.toHaveProperty("value");
    expect(entries.find((entry) => entry.key === "bash.enabled")?.value).toBe(true);
  });

  it("still lists settings when the JSON half is unreadable", () => {
    expect(parseOmpSettingsCatalog(listText, "not json").map((entry) => entry.description)).toEqual(["", "", "", ""]);
  });
});
