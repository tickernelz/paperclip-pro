import { describe, expect, it } from "vitest";

import { RETIRED_ADAPTER_TYPES, retiredAdapterMessage } from "@tickernelz/wardmote-shared";
import { getAdapterDisplay, getAdapterLabel, getAdapterLabels } from "./adapter-display-registry";

describe("adapter display registry", () => {
  it("shows every retired adapter as removed, disabled, and hidden from selection", () => {
    for (const type of RETIRED_ADAPTER_TYPES) {
      expect(getAdapterLabel(type)).toMatch(/ \(removed\)$/);
      expect(getAdapterDisplay(type)).toMatchObject({
        comingSoon: true,
        disabledLabel: retiredAdapterMessage(type),
        hideFromVisualSelection: true,
      });
      expect(getAdapterLabels()).not.toHaveProperty(type);
    }
  });

  it("drops local suffixes for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_local")).toBe("Droid");
    expect(getAdapterDisplay("droid_local")).toMatchObject({
      label: "Droid",
      description: "External adapter",
    });
  });

  it("keeps a gateway suffix for unknown plugin adapter labels", () => {
    expect(getAdapterLabel("droid_gateway")).toBe("Droid (gateway)");
    expect(getAdapterDisplay("droid_gateway")).toMatchObject({
      label: "Droid (gateway)",
      description: "External gateway adapter",
    });
  });
});
