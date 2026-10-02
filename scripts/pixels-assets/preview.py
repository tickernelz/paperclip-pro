import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCALE = 6
PAD = 8
BG = (24, 26, 34, 255)


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    files = sorted(root.rglob("*.png"))
    cells = [(f.stem, Image.open(f).convert("RGBA")) for f in files]
    cw = max(im.width for _, im in cells) * SCALE + PAD * 2
    ch = max(im.height for _, im in cells) * SCALE + PAD * 2 + 14
    sheet = Image.new("RGBA", (cw * len(cells), ch), BG)
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(cells):
        big = im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST)
        x = i * cw + (cw - big.width) // 2
        y = PAD + (ch - 14 - PAD * 2 - big.height)
        sheet.alpha_composite(big, (x, y))
        draw.text((i * cw + 6, ch - 13), name, fill=(200, 205, 215, 255))
    sheet.save(out)
    print(out, sheet.size)


main()
