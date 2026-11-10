import { describe, expect, it } from "vitest";
import {
  adoptRetiredCompanyPackageExtension,
  findCompanyPackageExtensionPath,
} from "./company-package-extension.js";

describe("company package extension file", () => {
  it("renames a retired extension file in place, keeping its directory", () => {
    expect(adoptRetiredCompanyPackageExtension({
      "COMPANY.md": "c",
      "nested/.paperclip.yml": "n",
      ".paperclip.yaml": "root",
    })).toEqual({
      "COMPANY.md": "c",
      "nested/.wardmote.yaml": "n",
      ".wardmote.yaml": "root",
    });
  });

  it("keeps the current extension file when both names are present", () => {
    expect(adoptRetiredCompanyPackageExtension({
      ".wardmote.yml": "current",
      ".paperclip.yaml": "retired",
    })).toEqual({ ".wardmote.yml": "current" });
  });

  it("prefers the retired .yaml over the retired .yml", () => {
    expect(adoptRetiredCompanyPackageExtension({
      ".paperclip.yml": "yml",
      ".paperclip.yaml": "yaml",
    })).toEqual({ ".wardmote.yaml": "yaml" });
  });

  it("finds a root extension before a nested one and ignores retired names", () => {
    expect(findCompanyPackageExtensionPath(["a/.wardmote.yaml", ".wardmote.yml"])).toBe(".wardmote.yml");
    expect(findCompanyPackageExtensionPath([".paperclip.yaml"])).toBeNull();
  });
});
