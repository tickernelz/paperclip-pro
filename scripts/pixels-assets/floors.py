import sys
from pathlib import Path

from PIL import Image

SIZE = 16
BASE = 172
SEAM = 132
GRAIN = 160
LIGHT = 186


def parquet() -> Image.Image:
    img = Image.new("L", (SIZE, SIZE), BASE)
    px = img.load()
    for block_y in (0, 8):
        for block_x in (0, 8):
            horizontal = (block_x // 8 + block_y // 8) % 2 == 0
            for i in range(8):
                for j in range(8):
                    x, y = block_x + i, block_y + j
                    along, across = (i, j) if horizontal else (j, i)
                    if across % 4 == 3:
                        px[x, y] = SEAM
                    elif across % 4 == 0:
                        px[x, y] = LIGHT
                    elif (along + across * 3) % 7 == 0:
                        px[x, y] = GRAIN
    return img


def stone() -> Image.Image:
    img = Image.new("L", (SIZE, SIZE), BASE)
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            row = y // 8
            shifted = (x + (4 if row % 2 else 0)) % SIZE
            if y % 8 == 7 or shifted % 8 == 7:
                px[x, y] = SEAM
            elif y % 8 == 0 or shifted % 8 == 0:
                px[x, y] = LIGHT
            elif (x * 7 + y * 3) % 11 == 0:
                px[x, y] = GRAIN
    return img


def main() -> None:
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    stone().convert("RGBA").save(out_dir / "floor_7.png")
    parquet().convert("RGBA").save(out_dir / "floor_8.png")


if __name__ == "__main__":
    main()
