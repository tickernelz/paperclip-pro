import { afterEach, describe, expect, it, vi } from "vitest";
import { readClipboardImage, shellEscapePath } from "./terminal-clipboard";

describe("terminal clipboard", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("gives up on a clipboard read that never settles so held keystrokes are released", async () => {
    const read = vi.fn(() => new Promise<ClipboardItem[]>(() => {}));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read } });

    await expect(readClipboardImage(20)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("treats a denied clipboard read as no image", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
    });

    await expect(readClipboardImage(1_000)).resolves.toBeNull();
  });

  it("quotes paths only when the shell would split or expand them", () => {
    expect(shellEscapePath("/tmp/paperclip-pasted-1000/pasted-image-1.png")).toBe("/tmp/paperclip-pasted-1000/pasted-image-1.png");
    expect(shellEscapePath("/tmp/it's here/$x.png")).toBe("'/tmp/it'\\''s here/$x.png'");
  });
});
