import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ATTACHMENT_UPLOAD_ROUTES = ["issues.ts", "assets.ts", "cases.ts"];

describe("attachment upload routes", () => {
  it.each(ATTACHMENT_UPLOAD_ROUTES)("%s streams uploads to disk instead of buffering them in memory", async (file) => {
    const source = await readFile(new URL(`../routes/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/memoryStorage/);
    expect(source).not.toMatch(/file\.buffer/);
    expect(source).toMatch(/stageSingleFileUpload/);
    expect(source).toMatch(/removeStagedUpload/);
  });
});
