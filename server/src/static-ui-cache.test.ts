import { describe, expect, it } from "vitest";
import { staticUiCacheControl } from "./static-ui-cache.js";

describe("static UI cache control", () => {
  it("revalidates the files that carry a version pointer or a download", () => {
    expect(staticUiCacheControl("/srv/ui-dist/index.html")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/sw.js")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/downloads/local-browser-firefox.xpi")).toBe("no-cache");
    expect(staticUiCacheControl("/srv/ui-dist/downloads/local-browser-chromium.zip")).toBe("no-cache");
  });

  it("leaves ordinary static files on the default TTL", () => {
    expect(staticUiCacheControl("/srv/ui-dist/favicon.ico")).toBeUndefined();
    expect(staticUiCacheControl("/srv/ui-dist/robots.txt")).toBeUndefined();
  });
});
