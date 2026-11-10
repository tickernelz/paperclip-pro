import { describe, expect, it } from "vitest";
import { adapterCuratesModelOrder } from "./model-utils";

describe("adapterCuratesModelOrder", () => {
  it("keeps the advertised order for the Wardmote Runner's hand-ordered list", () => {
    expect(adapterCuratesModelOrder("wardmote_runner")).toBe(true);
  });

  it("leaves retired and third-party lists to the alphabetical fallback", () => {
    expect(adapterCuratesModelOrder("codex_local")).toBe(false);
    expect(adapterCuratesModelOrder("acme_plugin_adapter")).toBe(false);
  });
});
