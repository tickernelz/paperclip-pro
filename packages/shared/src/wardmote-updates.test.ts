import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  fetchLatestWardmoteVersion,
  isNewerVersion,
  isUpdateNoticeHidden,
  UPDATE_NOTICE_HIDE_DAYS,
  updateNoticeHiddenUntil,
  WARDMOTE_DIST_TAGS_URL,
} from "./wardmote-updates.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("compareVersions", () => {
  it("orders calendar releases numerically, not lexically", () => {
    expect(compareVersions("2026.1112.0", "2026.1111.0")).toBe(1);
    expect(compareVersions("2026.1108.1", "2026.1108.0")).toBe(1);
    expect(compareVersions("2026.928.7", "2026.1001.0")).toBe(-1);
    expect(compareVersions("v2026.1112.0", "2026.1112.0")).toBe(0);
  });

  it("ranks prereleases below the release and compares their identifiers", () => {
    expect(compareVersions("1.0.0-canary.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-canary.10", "1.0.0-canary.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
  });

  it("treats only strictly newer versions as an update", () => {
    expect(isNewerVersion("2026.1112.0", "2026.1111.0")).toBe(true);
    expect(isNewerVersion("2026.1111.0", "2026.1111.0")).toBe(false);
    expect(isNewerVersion("2026.1110.0", "2026.1111.0")).toBe(false);
    expect(isNewerVersion(null, "2026.1111.0")).toBe(false);
  });
});

describe("update notice hide window", () => {
  it("hides for exactly the named number of days, then shows again", () => {
    const hiddenAt = Date.UTC(2026, 10, 12, 7, 0, 0);
    const until = updateNoticeHiddenUntil(hiddenAt);
    expect(UPDATE_NOTICE_HIDE_DAYS).toBe(3);
    expect(until - hiddenAt).toBe(3 * DAY_MS);
    expect(isUpdateNoticeHidden(until, hiddenAt + 2 * DAY_MS)).toBe(true);
    expect(isUpdateNoticeHidden(until, until - 1)).toBe(true);
    expect(isUpdateNoticeHidden(until, until)).toBe(false);
  });

  it("shows the notice when nothing or garbage was stored", () => {
    expect(isUpdateNoticeHidden(null, 0)).toBe(false);
    expect(isUpdateNoticeHidden(Number.NaN, 0)).toBe(false);
  });
});

describe("fetchLatestWardmoteVersion", () => {
  it("reads the install channel from the small dist-tags document", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ latest: "2026.1112.0", canary: "2026.1113.0-canary.1" })));
    expect(await fetchLatestWardmoteVersion("latest", { fetchImpl })).toBe("2026.1112.0");
    expect(await fetchLatestWardmoteVersion("canary", { fetchImpl })).toBe("2026.1113.0-canary.1");
    expect(fetchImpl).toHaveBeenCalledWith(WARDMOTE_DIST_TAGS_URL, expect.anything());
  });

  it("returns null for a channel without a dist-tag and throws on HTTP errors", async () => {
    expect(await fetchLatestWardmoteVersion("canary", { fetchImpl: async () => new Response(JSON.stringify({ latest: "1.0.0" })) })).toBeNull();
    await expect(fetchLatestWardmoteVersion("latest", { fetchImpl: async () => new Response("", { status: 503 }) })).rejects.toThrow("HTTP 503");
  });
});
