#!/usr/bin/env python3
import io, json, math, re, sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "src"
sys.path.insert(0, str(SRC))
from contrast import load, rgb, over, ratio, hexof

NAME = "Wardmote"
WEIGHT = 640
TRACK = -0.012
FONT = HERE.parents[3] / "ui" / "public" / "fonts" / "InterVariable.woff2"

themes, _ = load()
L, D = themes[("b", "light")], themes[("b", "dark")]
COL = {
    "light": {"ink": hexof(over(rgb(L, "ink"), rgb(L, "bg-2"))), "accent": hexof(over(rgb(L, "accent"), rgb(L, "bg-2"))), "bg": hexof(rgb(L, "bg-2")), "page": hexof(rgb(L, "bg"))},
    "dark": {"ink": hexof(over(rgb(D, "ink"), rgb(D, "bg"))), "accent": hexof(over(rgb(D, "accent"), rgb(D, "bg"))), "bg": hexof(rgb(D, "bg")), "page": hexof(rgb(D, "bg-2"))},
}


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1.0,)


def wordmark_paths(size):
    font = TTFont(str(FONT))
    font = instancer.instantiateVariableFont(font, {"wght": WEIGHT}, inplace=False)
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    upem = font["head"].unitsPerEm
    face = hb.Face(buf.getvalue())
    hbfont = hb.Font(face)
    b = hb.Buffer()
    b.add_str(NAME)
    b.guess_segment_properties()
    hb.shape(hbfont, b, {"kern": True, "liga": True})
    gs = font.getGlyphSet()
    order = font.getGlyphOrder()
    scale = size / upem
    x = 0.0
    parts = []
    for info, pos in zip(b.glyph_infos, b.glyph_positions):
        name = order[info.codepoint]
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x + pos.x_offset * scale, -pos.y_offset * scale))
        gs[name].draw(tpen)
        d = pen.getCommands()
        if d:
            parts.append(d)
        x += pos.x_advance * scale + TRACK * size
    width = x - TRACK * size
    cap = font["OS/2"].sCapHeight * scale
    return " ".join(parts), width, cap


def moot(c, mono=False):
    out = [f'<circle cx="24" cy="24" r="7.4" fill="{c["ink"]}"/>']
    for k in range(6):
        a = math.radians(-90 + 60 * k)
        x, y = 24 + 17 * math.cos(a), 24 + 17 * math.sin(a)
        if k == 1:
            if mono:
                out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4.3" fill="none" stroke="{c["ink"]}" stroke-width="2.6"/>')
            else:
                out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5.6" fill="{c["accent"]}"/>')
        else:
            out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5.6" fill="{c["ink"]}"/>')
    return "".join(out)


def u_stroke(cx, r, top, cy):
    return f"M{cx - r},{top} V{cy} A{r},{r} 0 0 0 {cx + r},{cy} V{top}"


def u_fill(cx, r, top, cy):
    return f"M{cx - r},{top} V{cy} A{r},{r} 0 0 0 {cx + r},{cy} V{top} Z"


def gate(c, mono=False, uid="g"):
    r, top, cy, sw = 11, 8, 26, 5.4
    a, b = 24 - 5.5, 24 + 5.5
    shield = "" if mono else (
        f'<clipPath id="{uid}c"><path d="{u_fill(a, r - sw / 2, top, cy)}"/></clipPath>'
        f'<path clip-path="url(#{uid}c)" d="{u_fill(b, r - sw / 2, top, cy)}" fill="{c["accent"]}"/>'
    )
    strokes = f'<path d="{u_stroke(a, r, top, cy)} M{b - r},{top} V{cy} A{r},{r} 0 0 0 {b + r},{cy} V{top}" fill="none" stroke="{c["ink"]}" stroke-width="{sw}" stroke-linejoin="round"/>'
    return shield + strokes


def bubble(c, mono=False, uid="b"):
    body = "M14,6 H34 Q42,6 42,14 V24 C42,33 33,39 18,44 C19,40 19,38 17,36.5 C10,33 6,29 6,24 V14 Q6,6 14,6 Z"
    line = '<rect x="20" y="16.5" width="14" height="5.2" rx="2.6" fill="black"/>'
    dot = '<circle cx="14.6" cy="19.1" r="3.1" fill="black"/>'
    mask = f'<mask id="{uid}m"><rect width="48" height="48" fill="white"/>{line}{"" if not mono else dot}</mask>'
    accent = "" if mono else f'<circle cx="14.6" cy="19.1" r="3.1" fill="{c["accent"]}"/>'
    hole = "" if mono else f'<mask id="{uid}n"><rect width="48" height="48" fill="white"/>{line}<circle cx="14.6" cy="19.1" r="4.6" fill="black"/></mask>'
    if mono:
        return f'<defs>{mask}</defs><path d="{body}" fill="{c["ink"]}" mask="url(#{uid}m)"/>'
    return f'<defs>{hole}</defs><path d="{body}" fill="{c["ink"]}" mask="url(#{uid}n)"/>{accent}'


CONCEPTS = {
    "moot": {"title": "Lingkar Moot", "draw": moot},
    "gate": {"title": "Gerbang W", "draw": gate},
    "bubble": {"title": "Balon Perisai", "draw": bubble},
}


def svg(w, h, body, vb=None):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb or f"0 0 {w} {h}"}" width="{w}" height="{h}">{body}</svg>\n'


def draw(key, c, mono=False, uid=None):
    fn = CONCEPTS[key]["draw"]
    if key == "moot":
        return fn(c, mono)
    return fn(c, mono, uid or key)


def main():
    word, ww, cap = wordmark_paths(30)
    metrics = {"font": f"Inter {WEIGHT} (OFL 1.1), outlined; tracking {TRACK}em", "colors": COL, "concepts": {}}
    for key in CONCEPTS:
        d = HERE / key
        d.mkdir(exist_ok=True)
        for theme, c in COL.items():
            (d / f"mark-{theme}.svg").write_text(svg(48, 48, draw(key, c, uid=f"{key}{theme}")))
            gap, mh = 12, 48
            base = 24 + cap / 2
            body = f'<g>{draw(key, c, uid=f"{key}h{theme}")}</g><path transform="translate({mh + gap},{base:.2f})" d="{word}" fill="{c["ink"]}"/>'
            (d / f"lockup-h-{theme}.svg").write_text(svg(round(mh + gap + ww), 48, body))
            vw = max(ww, 64)
            body = f'<g transform="translate({(vw - 64) / 2:.2f},0) scale(1.3333)">{draw(key, c, uid=f"{key}v{theme}")}</g><path transform="translate({(vw - ww) / 2:.2f},{64 + 14 + cap:.2f})" d="{word}" fill="{c["ink"]}"/>'
            (d / f"lockup-v-{theme}.svg").write_text(svg(round(vw), round(64 + 14 + cap + 4), body))
            (d / f"wordmark-{theme}.svg").write_text(svg(round(ww) + 1, round(cap) + 2, f'<path transform="translate(0,{cap + 1:.2f})" d="{word}" fill="{c["ink"]}"/>'))
        mono = {"ink": "#000000", "accent": "#000000"}
        (d / "mark-mono.svg").write_text(svg(48, 48, draw(key, mono, mono=True, uid=f"{key}mono")))
        light = (d / "mark-light.svg").read_text()
        shapes = len(re.findall(r"<(path|circle|rect)\b", re.sub(r"<(mask|clipPath)\b.*?</\1>", "", light)))
        fills = sorted(set(re.findall(r'(?:fill|stroke)="(#[0-9a-f]{6})"', light)))
        row = {"title": CONCEPTS[key]["title"], "shapes": shapes, "colors": len(fills)}
        for theme, c in COL.items():
            row[f"inkContrast_{theme}"] = round(ratio(hex_rgb(c["ink"]), hex_rgb(c["bg"])), 2)
            row[f"accentContrast_{theme}"] = round(ratio(hex_rgb(c["accent"]), hex_rgb(c["bg"])), 2)
        metrics["concepts"][key] = row
    metrics["wordmark"] = {"width": round(ww, 2), "capHeight": round(cap, 2)}
    (HERE / "logo.json").write_text(json.dumps(metrics, indent=1) + "\n")
    print(json.dumps(metrics["concepts"], indent=1), metrics["wordmark"])


if __name__ == "__main__":
    main()
