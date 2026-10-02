import { describe, expect, it } from "vitest";
import { progressCaption } from "./bubbles";

describe("progressCaption", () => {
  it("keeps short progress verbatim and trims long progress to the bubble width", () => {
    expect(progressCaption("Running tests")).toBe("Running tests");
    expect(progressCaption("Reading   server/src/routes/issues.ts carefully")).toBe("Reading server/src/r..");
  });

  it("drops glyphs the pixel font cannot draw without merging words", () => {
    expect(progressCaption("Membaca “catatan” — selesai")).toBe("Membaca catatan selesai".slice(0, 20) + "..");
  });
});
