import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPixelAssets } from "./assetLoader";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPixelAssets", () => {
  it("names the failing url and retries after a rejection", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPixelAssets()).rejects.toThrow(
      "Failed to fetch /pixels/pixels-office-assets.json",
    );
    const afterFirst = fetchMock.mock.calls.length;

    await expect(loadPixelAssets()).rejects.toThrow(
      "Failed to fetch /pixels/pixels-office-assets.json",
    );
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
