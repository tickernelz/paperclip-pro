import { describe, expect, it } from "vitest";
import { readPortableCatalogProvenance } from "./catalog-provenance.js";
import { RETIRED_PACKAGE_METADATA_KEY } from "./retired-package-metadata-key.js";

describe("readPortableCatalogProvenance", () => {
  it("reads catalog provenance from skill packages written before the rename", () => {
    const provenance = readPortableCatalogProvenance({
      [RETIRED_PACKAGE_METADATA_KEY]: { catalog: { sourceRef: "sha256:old", catalogId: "team-a" } },
    });
    expect(provenance).toEqual({ sourceRef: "sha256:old", metadata: { sourceKind: "catalog", catalogId: "team-a", originHash: "sha256:old" } });
  });

  it("prefers the wardmote block when a package carries both", () => {
    const provenance = readPortableCatalogProvenance({
      wardmote: { catalog: { sourceRef: "sha256:new" } },
      [RETIRED_PACKAGE_METADATA_KEY]: { catalog: { sourceRef: "sha256:old" } },
    });
    expect(provenance?.sourceRef).toBe("sha256:new");
  });
});
