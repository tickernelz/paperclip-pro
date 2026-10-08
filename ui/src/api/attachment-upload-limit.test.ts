import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAttachmentSize, resetAttachmentLimitForTests, setAttachmentLimit } from "@/lib/attachment-limit";
import { ApiError, api } from "./client";
import { assetsApi } from "./assets";
import { issuesApi } from "./issues";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetAttachmentLimitForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAttachmentLimitForTests();
});

function fileOfSize(bytes: number) {
  return new File([new Uint8Array(bytes)], "big.bin", { type: "application/octet-stream" });
}

describe("formatAttachmentSize", () => {
  it("matches the server formatter", () => {
    expect(formatAttachmentSize(0)).toBe("0 bytes");
    expect(formatAttachmentSize(1)).toBe("1 byte");
    expect(formatAttachmentSize(512)).toBe("512 bytes");
    expect(formatAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatAttachmentSize(100 * 1024 * 1024)).toBe("100 MB");
    expect(formatAttachmentSize(10.5 * 1024 * 1024)).toBe("10.5 MB");
    expect(formatAttachmentSize(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });
});

describe("upload size limit", () => {
  it("rejects an oversized task attachment before sending it", async () => {
    setAttachmentLimit({ maxBytes: 1024, source: "setting" });

    const upload = issuesApi.uploadAttachment("company-1", "issue-1", fileOfSize(2048));

    await expect(upload).rejects.toMatchObject({
      name: "ApiError",
      status: 413,
      message: "File is larger than the 1 KB limit",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized image before sending it", async () => {
    setAttachmentLimit({ maxBytes: 1024, source: "env" });

    await expect(assetsApi.uploadImage("company-1", fileOfSize(4096), "issues/drafts")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends files within the limit", async () => {
    setAttachmentLimit({ maxBytes: 4096, source: "default" });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "attachment-1" }) });

    await expect(issuesApi.uploadAttachment("company-1", "issue-1", fileOfSize(1024))).resolves.toEqual({ id: "attachment-1" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("turns a 413 with an HTML body into the friendly limit message", async () => {
    setAttachmentLimit({ maxBytes: 100 * 1024 * 1024, source: "default" });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => JSON.parse("<html><body>413 Request Entity Too Large</body></html>"),
    });

    const upload = api.postForm("/companies/company-1/issues/issue-1/attachments", new FormData());

    await expect(upload).rejects.toMatchObject({ status: 413, message: "File is larger than the 100 MB limit" });
    await expect(upload).rejects.not.toMatchObject({ message: expect.stringContaining("<html>") });
  });

  it("keeps the server's 413 JSON message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: "File is larger than the 250 MB limit" }),
    });

    await expect(api.postForm("/companies/company-1/assets/images", new FormData())).rejects.toMatchObject({
      status: 413,
      message: "File is larger than the 250 MB limit",
    });
  });
});
