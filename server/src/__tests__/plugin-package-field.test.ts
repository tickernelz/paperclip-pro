import { describe, expect, it } from "vitest";
import { isPluginPackageName, readWardmotePluginPackageField, resolveDeclaredPluginEntrypoints } from "../services/plugin-loader.js";

describe("plugin package.json contract field", () => {
  it("reads wardmotePlugin and refuses a package that only declares the retired field", () => {
    expect(readWardmotePluginPackageField({ wardmotePlugin: { manifest: "./dist/manifest.js" } })).toEqual({ manifest: "./dist/manifest.js" });
    expect(readWardmotePluginPackageField({ name: "plain" })).toBeUndefined();
    const retired = { name: "legacy-plugin", paperclipPlugin: { manifest: "./dist/manifest.js" } };
    expect(() => readWardmotePluginPackageField(retired)).toThrow('rename it to "wardmotePlugin"');
    expect(() => resolveDeclaredPluginEntrypoints("/pkg", retired)).toThrow('rename it to "wardmotePlugin"');
  });
});

describe("plugin package naming convention", () => {
  it("recognizes Wardmote plugin packages, scoped and unscoped", () => {
    expect(isPluginPackageName("@tickernelz/wardmote-plugin-llm-wiki")).toBe(true);
    expect(isPluginPackageName("wardmote-plugin-linear")).toBe(true);
    expect(isPluginPackageName("@acme/plugin-linear")).toBe(true);
    expect(isPluginPackageName("@acme/linear")).toBe(false);
    expect(isPluginPackageName("linear")).toBe(false);
  });
});
