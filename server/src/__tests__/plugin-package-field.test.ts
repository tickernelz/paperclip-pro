import { describe, expect, it } from "vitest";
import { readWardmotePluginPackageField, resolveDeclaredPluginEntrypoints } from "../services/plugin-loader.js";

describe("plugin package.json contract field", () => {
  it("reads wardmotePlugin and refuses a package that only declares the retired field", () => {
    expect(readWardmotePluginPackageField({ wardmotePlugin: { manifest: "./dist/manifest.js" } })).toEqual({ manifest: "./dist/manifest.js" });
    expect(readWardmotePluginPackageField({ name: "plain" })).toBeUndefined();
    const retired = { name: "legacy-plugin", ["paper" + "clipPlugin"]: { manifest: "./dist/manifest.js" } };
    expect(() => readWardmotePluginPackageField(retired)).toThrow('rename it to "wardmotePlugin"');
    expect(() => resolveDeclaredPluginEntrypoints("/pkg", retired)).toThrow('rename it to "wardmotePlugin"');
  });
});
