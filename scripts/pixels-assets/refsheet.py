import sys
from pathlib import Path

from PIL import Image

NAMES = [
    "PC/PC_FRONT_ON_1.png",
    "CLOCK",
    "WHITEBOARD",
    "BOOKSHELF",
    "PLANT",
    "COFFEE",
    "BIN",
    "LARGE_PAINTING/LARGE_PAINTING.png",
    "ARCADE_MACHINE",
    "DESK/DESK_FRONT.png",
]
SCALE = 8
PAD = 16
KEY = (255, 0, 255, 255)


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    paths = []
    for name in NAMES:
        p = root / name
        if p.is_dir():
            pngs = sorted(p.glob("*.png"))
            if pngs:
                paths.append(pngs[0])
        elif p.exists():
            paths.append(p)
    imgs = [Image.open(p).convert("RGBA") for p in paths]
    imgs = [i.resize((i.width * SCALE, i.height * SCALE), Image.NEAREST) for i in imgs]
    max_h = max(i.height for i in imgs)
    width = sum(i.width for i in imgs) + PAD * (len(imgs) + 1)
    sheet = Image.new("RGBA", (width, max_h + PAD * 2), KEY)
    x = PAD
    for i in imgs:
        sheet.alpha_composite(i, (x, PAD + max_h - i.height))
        x += i.width + PAD
    sheet.convert("RGB").save(out)
    print(out, sheet.size, [str(p.relative_to(root)) for p in paths])


main()
