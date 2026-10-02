import { afterEach, describe, expect, it, vi } from "vitest";
import {
  declutterLabelBoxes,
  getGlyphAtlas,
  glyphAtlasCacheSize,
  measureLabelWidth,
  resetGlyphAtlasCache,
  type LabelBox,
} from "./agentLabels";

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): FakeContext | null;
}

interface FakeContext {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(...args: unknown[]): void;
}

function installFakeDocument(): { canvases: FakeCanvas[]; drawCalls: () => number } {
  const canvases: FakeCanvas[] = [];
  let draws = 0;
  const createElement = (): FakeCanvas => {
    const context: FakeContext = {
      fillStyle: "",
      fillRect: () => undefined,
      drawImage: () => {
        draws += 1;
      },
    };
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    };
    canvases.push(canvas);
    return canvas;
  };
  vi.stubGlobal("document", { createElement });
  return { canvases, drawCalls: () => draws };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetGlyphAtlasCache();
});

describe("declutterLabelBoxes", () => {
  it("separates a dense cluster so no two boxes overlap", () => {
    const boxes: LabelBox[] = [];
    for (let i = 0; i < 18; i += 1) {
      boxes.push({ x: 100 + (i % 3), y: 200, w: 26, h: 7 });
    }

    declutterLabelBoxes(boxes, 1);

    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const first = boxes[a];
        const second = boxes[b];
        const apart =
          first.x >= second.x + second.w ||
          second.x >= first.x + first.w ||
          first.y >= second.y + second.h ||
          second.y >= first.y + first.h;
        expect(apart).toBe(true);
      }
    }
  });

  it("keeps boxes that do not share horizontal space at their anchor row", () => {
    const boxes: LabelBox[] = [
      { x: 0, y: 50, w: 20, h: 7 },
      { x: 40, y: 50, w: 20, h: 7 },
    ];

    declutterLabelBoxes(boxes, 1);

    expect(boxes[0].y).toBe(50);
    expect(boxes[1].y).toBe(50);
  });
});

describe("measureLabelWidth", () => {
  it("advances four pixels per glyph and trims the trailing kerning column", () => {
    expect(measureLabelWidth("A")).toBe(3);
    expect(measureLabelWidth("AB")).toBe(7);
    expect(measureLabelWidth("")).toBe(0);
  });

  it("measures lowercase like its uppercase glyph", () => {
    expect(measureLabelWidth("ana")).toBe(measureLabelWidth("ANA"));
  });
});

describe("getGlyphAtlas", () => {
  it("rasterizes once and reuses the same atlas across frames at one zoom", () => {
    const fake = installFakeDocument();

    const first = getGlyphAtlas(2, "#fff");
    for (let frame = 0; frame < 30; frame += 1) {
      expect(getGlyphAtlas(2, "#fff")).toBe(first);
    }

    expect(fake.canvases).toHaveLength(1);
  });

  it("emits one blit per glyph and skips the space advance", () => {
    const fake = installFakeDocument();
    const atlas = getGlyphAtlas(3, "#fff");
    let blits = 0;
    const target = {
      fillStyle: "",
      fillRect: () => undefined,
      drawImage: () => {
        blits += 1;
      },
    };

    atlas?.drawText(target as unknown as CanvasRenderingContext2D, "AN A", 0, 0);

    expect(blits).toBe(3);
    expect(fake.canvases).toHaveLength(1);
  });

  it("bounds the atlas cache when the zoom level keeps changing", () => {
    installFakeDocument();

    for (let zoom = 1; zoom <= 12; zoom += 1) {
      getGlyphAtlas(zoom, "#fff");
    }

    expect(glyphAtlasCacheSize()).toBeLessThanOrEqual(4);
  });
});
