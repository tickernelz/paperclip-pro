import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../src/ui/clipboard.js";

type GlobalWithPluginBridge = typeof globalThis & {
  __wardmotePluginBridge__?: unknown;
};

afterEach(() => {
  delete (globalThis as GlobalWithPluginBridge).__wardmotePluginBridge__;
});

describe("copyTextToClipboard", () => {
  it("delegates clipboard writes to the host UI runtime", async () => {
    const copy = vi.fn(async () => undefined);
    (globalThis as GlobalWithPluginBridge).__wardmotePluginBridge__ = {
      sdkUi: { copyTextToClipboard: copy },
    };

    await copyTextToClipboard("src/index.ts");

    expect(copy).toHaveBeenCalledWith("src/index.ts");
  });
});
