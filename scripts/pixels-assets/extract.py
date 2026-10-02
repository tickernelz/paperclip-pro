import sys
from collections import Counter
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
merge_gap = int(sys.argv[3]) if len(sys.argv) > 3 else 24
out_dir.mkdir(parents=True, exist_ok=True)

img = Image.open(src).convert("RGB")
W, H = img.size
px = img.load()
key_color = px[0, 0]


def is_key(p):
    return sum(abs(p[i] - key_color[i]) for i in range(3)) < 60


mask = [[not is_key(px[x, y]) for x in range(W)] for y in range(H)]

step = 4
gw, gh = (W + step - 1) // step, (H + step - 1) // step
grid = [[False] * gw for _ in range(gh)]
for y in range(H):
    for x in range(W):
        if mask[y][x]:
            grid[y // step][x // step] = True

reach = merge_gap // step
seen = [[False] * gw for _ in range(gh)]
boxes = []
for gy in range(gh):
    for gx in range(gw):
        if not grid[gy][gx] or seen[gy][gx]:
            continue
        stack = [(gx, gy)]
        seen[gy][gx] = True
        x0 = x1 = gx
        y0 = y1 = gy
        while stack:
            cx, cy = stack.pop()
            x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
            for ny in range(max(0, cy - reach), min(gh, cy + reach + 1)):
                for nx in range(max(0, cx - reach), min(gw, cx + reach + 1)):
                    if grid[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
        boxes.append((x0 * step, y0 * step, min(W, (x1 + 1) * step), min(H, (y1 + 1) * step)))

boxes = [b for b in boxes if (b[2] - b[0]) * (b[3] - b[1]) > 400]
boxes.sort(key=lambda b: (b[1] // (H // 3), b[0]))


def block_size(region):
    rw, rh = region.size
    rp = region.load()
    runs = Counter()
    for y in range(0, rh, 3):
        run = 1
        for x in range(1, rw):
            a, b = rp[x - 1, y], rp[x, y]
            if sum(abs(a[i] - b[i]) for i in range(3)) < 40:
                run += 1
            else:
                if 4 <= run <= 40:
                    runs[run] += 1
                run = 1
    if not runs:
        return 8
    best, best_score = 8, -1
    for cand in range(5, 25):
        score = sum(c for r, c in runs.items() if abs(r / cand - round(r / cand)) < 0.15 and round(r / cand) >= 1)
        score *= cand ** 0.35
        if score > best_score:
            best, best_score = cand, score
    return best


for idx, (x0, y0, x1, y1) in enumerate(boxes):
    region = img.crop((x0, y0, x1, y1))
    bs = block_size(region)
    rw, rh = region.size
    nw, nh = max(1, round(rw / bs)), max(1, round(rh / bs))
    rp = region.load()
    out = Image.new("RGBA", (nw, nh), (0, 0, 0, 0))
    op = out.load()
    for oy in range(nh):
        for ox in range(nw):
            sx = min(rw - 1, int((ox + 0.5) * rw / nw))
            sy = min(rh - 1, int((oy + 0.5) * rh / nh))
            p = rp[sx, sy]
            op[ox, oy] = (0, 0, 0, 0) if is_key(p) else (*p, 255)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    out.save(out_dir / f"obj_{idx}.png")
    print(idx, (x0, y0, x1, y1), "block", bs, "->", out.size)
