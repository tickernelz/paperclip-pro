# pixels-assets

Regenerates the Pixels Office furniture and effect sprites. Requires Python 3 with Pillow.

## 1. Reference sheet

Builds a magenta-keyed strip of existing tileset furniture at 8x, used to anchor the image model
to the current art style.

```sh
python3 scripts/pixels-assets/refsheet.py ui/public/pixels/furniture /tmp/pxasset/reference.png
```

## 2. Generate

Call the image model with `/tmp/pxasset/reference.png` as `input[0]` and a prompt that asks for
chunky low-resolution pixel art identical in style to Image 1, on a flat solid background, objects
bottom-aligned on one baseline and widely spaced. One object per generation batch keeps the block
size uniform. Save the result anywhere; the extractor reads a single PNG.

## 3. Extract

Splits the generated sheet into one PNG per object. The background key is sampled from the top-left
pixel, components are merged within `merge_gap` source pixels, and each object is snapped back to
its native pixel block size.

```sh
python3 scripts/pixels-assets/extract.py /tmp/generated.png /tmp/pxasset/ref_out 40
```

## 4. Normalize

`spec.json` lists every shipped sprite: source file, output id and directory, tile-aligned target
size, optional colour count and an optional `dim` transform used to derive state frames such as
`ALARM_LIGHT` from `ALARM_LIGHT_ON`. Normalization hardens alpha, drops the chroma key, trims,
nearest-resizes into the target box bottom-centred, and quantizes to at most 16 opaque colours.

```sh
python3 scripts/pixels-assets/normalize.py scripts/pixels-assets/spec.json /tmp/pxasset/ref_out /tmp/pxasset/final
cp -r /tmp/pxasset/final/* ui/public/pixels/furniture/
```

## 5. Preview

```sh
python3 scripts/pixels-assets/preview.py /tmp/pxasset/final /tmp/pxasset/preview-6x.png
```

## 6. Catalog

Placeable sprites need an entry in `ui/public/pixels/pixels-office-assets.json` under `furniture`
with `category`, `width`, `height`, `footprintW`, `footprintH` and `furniturePath`; wall-mounted
objects set `canPlaceOnWalls`. On/off pairs share a `groupId` and set `state`. `SMOKE` and
`CONFETTI` are effect sprites drawn by the overlay layers and are deliberately absent from the
catalog.
