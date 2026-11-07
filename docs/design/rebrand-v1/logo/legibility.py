#!/usr/bin/env python3
import json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "render"
SIZES = (16, 24, 32, 48, 128)
COLORS = json.loads((HERE / "logo.json").read_text())["colors"]
CHROME = "google-chrome"


def shoot(svg, size, out, bg="#fff"):
    html = OUT / "one.html"
    html.write_text(f'<!doctype html><body style="margin:0;background:{bg}"><img src="{svg.resolve().as_uri()}" width="{size}" height="{size}" style="display:block">')
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--force-device-scale-factor=1", f"--window-size={size},{size}", "--virtual-time-budget=1500", f"--screenshot={out}", html.as_uri()], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def components(png, threshold):
    r = subprocess.run(["magick", str(png), "-colorspace", "gray", "-threshold", f"{threshold}%", "-negate", "-define", "connected-components:verbose=true", "-define", "connected-components:area-threshold=1", "-connected-components", "8", "null:"], capture_output=True, text=True)
    rows = [l for l in r.stdout.splitlines()[1:] if "gray(255)" in l or "srgb(255,255,255)" in l]
    return len(rows)


def holes(png, threshold):
    r = subprocess.run(["magick", str(png), "-colorspace", "gray", "-threshold", f"{threshold}%", "-define", "connected-components:verbose=true", "-define", "connected-components:area-threshold=1", "-connected-components", "4", "null:"], capture_output=True, text=True)
    rows = [l for l in r.stdout.splitlines()[1:] if "gray(255)" in l or "srgb(255,255,255)" in l]
    return max(0, len(rows) - 1)


def main():
    OUT.mkdir(exist_ok=True)
    res = {}
    for key in ("moot", "gate", "bubble"):
        svg = HERE / key / "mark-mono.svg"
        row = {}
        for s in SIZES:
            png = OUT / f"{key}-mono-{s}.png"
            shoot(svg, s, png)
            row[s] = {"parts": components(png, 50), "holes": holes(png, 50)}
        ref = row[128]
        keep = [s for s in SIZES if row[s] == ref]
        row["smallestFaithful"] = min(keep) if keep else None
        res[key] = row
    for key in ("moot", "gate", "bubble"):
        for theme in ("light", "dark"):
            for s in (16, 32):
                shoot(HERE / key / f"mark-{theme}.svg", s, OUT / f"{key}-{theme}-{s}.png", COLORS[theme]["bg"])
    for png in OUT.glob("*-16.png"):
        subprocess.run(["magick", str(png), "-filter", "point", "-resize", "800%", str(png.with_name(png.stem + "-x8.png"))], check=True)
    (OUT / "one.html").unlink()
    (HERE / "legibility.json").write_text(json.dumps(res, indent=1) + "\n")
    for k, v in res.items():
        print(k, {s: (v[s]["parts"], v[s]["holes"]) for s in SIZES}, "smallest faithful", v["smallestFaithful"])


if __name__ == "__main__":
    sys.exit(main())
