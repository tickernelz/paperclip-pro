import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = resolve(uiRoot, "public");
const MASKABLE_BACKGROUND = [0x0d, 0x0e, 0x11];
const THEME_LIGHT = "#f6f7f9";
const THEME_DARK = "#0d0e11";

interface ManifestImage {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
  form_factor?: string;
}

interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  start_url: string;
  scope: string;
  display?: string;
  display_override?: string[];
  theme_color?: string;
  background_color?: string;
  prefer_related_applications?: boolean;
  launch_handler?: { client_mode?: string[] };
  icons: ManifestImage[];
  screenshots: ManifestImage[];
  shortcuts: Array<{ name: string; url: string }>;
}

const manifest = JSON.parse(readFileSync(resolve(publicDir, "site.webmanifest"), "utf8")) as Manifest;
const indexHtml = readFileSync(resolve(uiRoot, "index.html"), "utf8");
const serviceWorker = readFileSync(resolve(publicDir, "sw.js"), "utf8");

function publicFile(src: string) {
  return resolve(publicDir, src.replace(/^\//, ""));
}

function imageSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) === 0x89504e47) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes.readUInt16BE(offset);
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    offset += 2 + length;
  }
  throw new Error(path + " has no readable size");
}

function decodePng(path: string) {
  const bytes = readFileSync(path);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6];
  if (bitDepth !== 8 || !channels) throw new Error(path + " is not an 8-bit gray/RGB(A) PNG");
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upLeft;
      const paeth = [left, up, upLeft].reduce((best, candidate) => (Math.abs(p - candidate) < Math.abs(p - best) ? candidate : best));
      const predictor = [0, left, up, (left + up) >> 1, Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft][filter];
      if (predictor === undefined) throw new Error(path + " uses unknown PNG filter " + filter);
      void paeth;
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function farthestMarkRadius(path: string) {
  const { width, height, channels, pixels } = decodePng(path);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      const differs = MASKABLE_BACKGROUND.some((channel, index) => Math.abs(pixels[at + Math.min(index, channels - 1)] - channel) > 0.06 * 255);
      if (!differs) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + 1);
      maxY = Math.max(maxY, y + 1);
    }
  }
  if (maxX < 0) return 0;
  const cx = width / 2;
  const cy = height / 2;
  const far = Math.max(...[minX, maxX].flatMap((x) => [minY, maxY].map((y) => Math.hypot(x - cx, y - cy))));
  return far / (width / 2);
}

describe("Wardmote manifest validator (28 checks, rebrand v2 pwa.py)", () => {
  it.each(["id", "name", "short_name", "start_url", "scope", "display", "icons", "theme_color", "background_color"] as const)(
    "has field %s",
    (field) => {
      const value = manifest[field];
      expect(value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)).toBe(false);
    },
  );

  it("keeps start_url inside scope", () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it.each([
    ["192x192", "any"],
    ["512x512", "any"],
  ])("ships a %s %s icon", (sizes, purpose) => {
    expect(manifest.icons.some((icon) => icon.sizes === sizes && (icon.purpose ?? "any") === purpose)).toBe(true);
  });

  it.each(["maskable", "monochrome"])("ships a %s icon", (purpose) => {
    expect(manifest.icons.some((icon) => icon.purpose === purpose)).toBe(true);
  });

  it.each([...manifest.icons, ...manifest.screenshots].map((image) => [image.src, image.sizes] as const))(
    "ships %s at its declared size %s",
    (src, sizes) => {
      const path = publicFile(src);
      expect(existsSync(path)).toBe(true);
      if (sizes === "any") return;
      expect(imageSize(path)).toEqual(sizes.split("x").map(Number));
    },
  );

  it("keeps the maskable mark inside the 80% safe circle", () => {
    const radius = farthestMarkRadius(publicFile("/pwa-maskable-512x512.png"));
    expect(radius).toBeGreaterThan(0.3);
    expect(radius).toBeLessThanOrEqual(0.8);
  });

  it("ships wide and narrow screenshots", () => {
    expect(new Set(manifest.screenshots.map((shot) => shot.form_factor))).toEqual(new Set(["wide", "narrow"]));
  });

  it("offers a Decisions shortcut", () => {
    expect(manifest.shortcuts.some((shortcut) => shortcut.name === "Decisions")).toBe(true);
  });

  it("has a service worker fetch handler", () => {
    expect(serviceWorker).toContain('addEventListener("fetch"');
  });

  it("has service worker push and notificationclick handlers", () => {
    expect(serviceWorker).toContain('addEventListener("push"');
    expect(serviceWorker).toContain('addEventListener("notificationclick"');
  });

  it("reuses an open window through launch_handler navigate-existing", () => {
    expect(manifest.launch_handler?.client_mode).toContain("navigate-existing");
  });
});

describe("Wardmote install contract", () => {
  it("is named Wardmote and starts with the light theme colour", () => {
    expect(manifest.name).toBe("Wardmote");
    expect(manifest.short_name).toBe("Wardmote");
    expect(manifest.theme_color).toBe(THEME_LIGHT);
    expect(manifest.background_color).toBe(THEME_LIGHT);
    expect(manifest.prefer_related_applications ?? false).toBe(false);
  });

  it("keeps id, scope and start_url of earlier Paperclip installs so they update instead of reinstalling", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/?source=pwa");
  });

  it("opens the window-controls overlay before standalone", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.display_override).toEqual(["window-controls-overlay", "standalone"]);
  });

  it("offers Inbox, Decisions, Tasks and New task shortcuts inside scope", () => {
    expect(manifest.shortcuts.map((shortcut) => shortcut.name)).toEqual(["Inbox", "Decisions", "Tasks", "New task"]);
    const scope = new URL(manifest.scope, "https://app.example.com");
    for (const url of [manifest.start_url, ...manifest.shortcuts.map((shortcut) => shortcut.url)]) {
      expect(new URL(url, scope).href.startsWith(scope.href)).toBe(true);
    }
  });

  it("ships a 180px apple-touch-icon", () => {
    expect(indexHtml).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"');
    expect(imageSize(publicFile("/apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("sets light and dark theme colours by media query", () => {
    expect(indexHtml).toContain('name="theme-color" media="(prefers-color-scheme: light)" content="' + THEME_LIGHT + '"');
    expect(indexHtml).toContain('name="theme-color" media="(prefers-color-scheme: dark)" content="' + THEME_DARK + '"');
  });

  it("opens iOS home-screen launches as a standalone web app", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="Wardmote"');
    expect(indexHtml).toContain("viewport-fit=cover");
  });

  it("fetches the manifest with credentials so authenticating proxies can serve it", () => {
    expect(indexHtml).toContain('rel="manifest" href="/site.webmanifest" crossorigin="use-credentials"');
  });
});
