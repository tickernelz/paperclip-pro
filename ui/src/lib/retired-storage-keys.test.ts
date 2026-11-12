// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { migrateRetiredStorageKeys } from "./retired-storage-keys";

describe("migrateRetiredStorageKeys", () => {
  beforeEach(() => window.localStorage.clear());

  it("moves colon and dot prefixed keys to the Wardmote prefix", () => {
    window.localStorage.setItem("paperclip.theme", "dark");
    window.localStorage.setItem("paperclip:inbox:dismissed", "[\"a\"]");
    migrateRetiredStorageKeys(window.localStorage);
    expect(window.localStorage.getItem("wardmote.theme")).toBe("dark");
    expect(window.localStorage.getItem("wardmote:inbox:dismissed")).toBe("[\"a\"]");
    expect(window.localStorage.getItem("paperclip.theme")).toBeNull();
    expect(window.localStorage.getItem("paperclip:inbox:dismissed")).toBeNull();
  });

  it("keeps a value already written under the new key", () => {
    window.localStorage.setItem("paperclip.theme", "dark");
    window.localStorage.setItem("wardmote.theme", "light");
    migrateRetiredStorageKeys(window.localStorage);
    expect(window.localStorage.getItem("wardmote.theme")).toBe("light");
    expect(window.localStorage.getItem("paperclip.theme")).toBeNull();
  });

  it("rewrites a stored no-template Skill Studio selection to the current value", () => {
    const retired = "__paperclip_no_template__";
    window.localStorage.setItem("skillStudio.runTemplate.company-a", retired);
    window.localStorage.setItem("skillStudio.runTemplate.company-b", "template-1");
    migrateRetiredStorageKeys(window.localStorage);
    expect(window.localStorage.getItem("skillStudio.runTemplate.company-a")).toBe("__wardmote_no_template__");
    expect(window.localStorage.getItem("skillStudio.runTemplate.company-b")).toBe("template-1");
  });

  it("leaves keys that only contain the old name elsewhere", () => {
    window.localStorage.setItem("paperclipX", "1");
    window.localStorage.setItem("other:paperclip.theme", "2");
    migrateRetiredStorageKeys(window.localStorage);
    expect(window.localStorage.getItem("paperclipX")).toBe("1");
    expect(window.localStorage.getItem("other:paperclip.theme")).toBe("2");
  });
});
