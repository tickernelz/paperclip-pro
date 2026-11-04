import { describe, expect, it } from "vitest";
import { staticUiCacheControl } from "./static-ui-cache.js";

describe("static UI cache control", () => {
  it("revalidates the files that carry a version pointer or a download", () => {
    expect(staticUiCacheControl("/srv/ui-dist/index.html")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/sw.js")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/downloads/local-browser-firefox.xpi")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/downloads/local-browser-chromium.zip")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/downloads/fonts/tool-v1.2.3.woff2")).toBe("no-cache");
  });

  it("caches fonts named after their upstream version as immutable", () => {
    expect(staticUiCacheControl("/srv/ui-dist/fonts/SymbolsNerdFontMono-v3.5.1.woff2")).toBe("public, max-age=31536000, immutable");
  });

  it("leaves ordinary static files on the default TTL", () => {
    expect(staticUiCacheControl("/srv/ui-dist/favicon.ico")).toBeUndefined();
    expect(staticUiCacheControl("/srv/ui-dist/robots.txt")).toBeUndefined();
    expect(staticUiCacheControl("/srv/ui-dist/fonts/InterVariable.woff2")).toBeUndefined();
  });
});
