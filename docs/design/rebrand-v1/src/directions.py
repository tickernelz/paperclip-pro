#!/usr/bin/env python3
import json, math, sys
from pathlib import Path
from contrast import load, parse, oklch_to_oklab

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "measurements"
FONTS = ROOT / "fonts"
STATUS = ("ok", "warn", "bad", "run")
LAYOUT_H = 900
CHROME_H = 48 + 56 + 44
NAMES = {"a": "Jati", "b": "Ledger", "c": "Signal"}
TYPE = {
    "a": {"sans": "IBM Plex Sans 400/500/600 (latin)", "mono": "IBM Plex Mono 400/500", "files": ["plex-sans-400.woff2", "plex-sans-500.woff2", "plex-sans-600.woff2", "plex-mono-400.woff2", "plex-mono-500.woff2"], "dropsInter": True},
    "b": {"sans": "Inter variable (sudah dikirim)", "mono": "IBM Plex Mono 400/500", "files": ["plex-mono-400.woff2", "plex-mono-500.woff2"], "dropsInter": False},
    "c": {"sans": "Inter variable (sudah dikirim)", "mono": "ui-monospace (font sistem, beda per OS)", "files": [], "dropsInter": False},
}
UI_FONTS = ROOT.parents[3] / "ui" / "public" / "fonts"
INTER_KB = (UI_FONTS / "InterVariable.woff2").stat().st_size / 1024
INTER_ITALIC_KB = (UI_FONTS / "InterVariable-Italic.woff2").stat().st_size / 1024


def lab(theme, name):
    l, c, h, _ = parse(theme[name])
    return oklch_to_oklab(l, c, h)


def dist(p, q):
    return math.dist(p, q)


def main():
    themes, _ = load()
    contrast = json.loads((DATA / "contrast.json").read_text())
    out = {}
    for d in ("a", "b", "c"):
        row = {"name": NAMES[d]}
        seps = []
        for t in ("light", "dark"):
            th = themes[(d, t)]
            acc = lab(th, "accent")
            nearest = min(STATUS, key=lambda s: dist(acc, lab(th, s)))
            seps.append({"theme": t, "nearest": nearest, "distance": round(dist(acc, lab(th, nearest)), 3), "hueAccent": parse(th["accent"])[2]})
        row["accentSeparation"] = seps
        row["minAccentSeparation"] = min(s["distance"] for s in seps)
        rows = contrast[f"{d}-light"] + contrast[f"{d}-dark"]
        row["contrastPass"] = f"{sum(r['pass'] for r in rows)}/{len(rows)}"
        row["minTextRatio"] = min(r["ratio"] for r in rows if r["kind"] == "text")
        rh = int(themes[(d, "light")].get("row-h", "36px").rstrip("px")) if "row-h" in themes[(d, "light")] else 36
        row["rowHeight"] = rh
        row["rowsAt1440x900"] = (LAYOUT_H - CHROME_H) // rh
        kb = sum((FONTS / f).stat().st_size for f in TYPE[d]["files"]) / 1024
        inter = INTER_KB
        row["fontsAddedKB"] = round(kb, 1)
        row["fontDeltaKB"] = round(kb - (inter + INTER_ITALIC_KB if TYPE[d]["dropsInter"] else 0), 1)
        row["type"] = {k: v for k, v in TYPE[d].items() if k != "files"}
        out[d] = row
    (DATA / "directions.json").write_text(json.dumps(out, indent=1) + "\n")
    for d, r in out.items():
        print(d, r["name"], r["contrastPass"], "minText", r["minTextRatio"], "sep", r["minAccentSeparation"], [(s["theme"], s["nearest"], s["distance"]) for s in r["accentSeparation"]], "rows", r["rowsAt1440x900"], "fontDelta", r["fontDeltaKB"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
