import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  prefer_related_applications?: boolean;
  icons?: ManifestIcon[];
  shortcuts?: Array<{ url: string }>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(uiRoot, "public/site.webmanifest"), "utf8")) as Manifest;
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(resolve(uiRoot, "public", path.replace(/^\//, "")));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("PWA install mode", () => {
  it("meets the Chromium installability criteria", () => {
    const manifest = readManifest();
    expect(manifest.name ?? manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.prefer_related_applications ?? false).toBe(false);
    const anySizes = (manifest.icons ?? [])
      .filter((icon) => (icon.purpose ?? "any").split(" ").includes("any") && icon.type === "image/png")
      .map((icon) => icon.sizes);
    expect(anySizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("ships every declared PNG icon at its declared size", () => {
    for (const icon of readManifest().icons ?? []) {
      if (icon.type !== "image/png") continue;
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src), icon.src).toEqual({ width, height });
    }
    expect(pngSize("/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("keeps the start URL and shortcuts inside the app scope", () => {
    const manifest = readManifest();
    const scope = new URL(manifest.scope ?? "/", "https://app.example.com");
    for (const url of [manifest.start_url ?? "/", ...(manifest.shortcuts ?? []).map((s) => s.url)]) {
      expect(new URL(url, scope).href.startsWith(scope.href), url).toBe(true);
    }
  });

  it("opens iOS home-screen launches as a standalone web app", () => {
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"');
    expect(html).toContain("viewport-fit=cover");
  });

  it("fetches the manifest with credentials so authenticating proxies can serve it", () => {
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/site.webmanifest" crossorigin="use-credentials"');
  });
});
