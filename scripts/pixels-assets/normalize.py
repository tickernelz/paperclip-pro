import json
import sys
from pathlib import Path

from PIL import Image

MAX_COLORS = 16
ALPHA_CUTOFF = 128


def is_key(r, g, b):
    return r > 120 and b > 120 and g < min(r, b) - 50


def hard_alpha(img):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < ALPHA_CUTOFF or is_key(r, g, b):
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)
    return img


def fit(img, tw, th):
    box = img.getbbox()
    if box is None:
        return Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    img = img.crop(box)
    w, h = img.size
    scale = min(tw / w, th / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    img = img.resize((nw, nh), Image.NEAREST)
    out = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    out.paste(img, ((tw - nw) // 2, th - nh))
    return out


def quantize(img, max_colors):
    rgb = img.convert("RGB")
    alpha = img.getchannel("A")
    reduced = rgb.quantize(colors=max_colors, method=Image.MEDIANCUT, dither=Image.NONE)
    out = reduced.convert("RGBA")
    out.putalpha(alpha)
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                px[x, y] = (0, 0, 0, 0)
    return out


def dim(img, factor, desaturate):
    img = img.copy()
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = int(0.3 * r + 0.59 * g + 0.11 * b)
            r = int((r * (1 - desaturate) + lum * desaturate) * factor)
            g = int((g * (1 - desaturate) + lum * desaturate) * factor)
            b = int((b * (1 - desaturate) + lum * desaturate) * factor)
            px[x, y] = (min(255, r), min(255, g), min(255, b), a)
    return img


def main():
    spec_path = Path(sys.argv[1])
    src_dir = Path(sys.argv[2])
    out_dir = Path(sys.argv[3])
    spec = json.loads(spec_path.read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    for item in spec:
        src = src_dir / item["source"]
        img = hard_alpha(Image.open(src))
        if "dim" in item:
            img = dim(img, item["dim"]["factor"], item["dim"]["desaturate"])
        img = fit(img, item["width"], item["height"])
        img = quantize(img, item.get("maxColors", MAX_COLORS))
        target = out_dir / item["dir"] / f"{item['id']}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        img.save(target, optimize=True)
        colors = len(img.convert("RGBA").getcolors(65536))
        print(item["id"], img.size, f"{target.stat().st_size}B", f"{colors} colors")


main()
