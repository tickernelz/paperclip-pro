#!/usr/bin/env python3
import json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "measurements"
REPO = ROOT.parents[3]


def oklch_to_oklab(l, c, h):
    h = math.radians(h)
    return (l, c * math.cos(h), c * math.sin(h))


def oklab_to_srgb(l, a, b):
    l_ = l + 0.3963377774 * a + 0.2158037573 * b
    m_ = l - 0.1055613458 * a - 0.0638541728 * b
    s_ = l - 0.0894841775 * a - 1.2914855480 * b
    L, M, S = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S
    g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S
    bb = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S

    def enc(x):
        x = min(1.0, max(0.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055

    return (enc(r), enc(g), enc(bb))


def parse(raw):
    m = re.match(r"oklch\(([^)]*)\)", raw.strip())
    if not m:
        return None
    parts = m.group(1).replace("/", " ").split()
    alpha = parts[3] if len(parts) > 3 else "1"
    alpha = float(alpha[:-1]) / 100 if alpha.endswith("%") else float(alpha)
    return tuple(float(p) for p in parts[:3]) + (alpha,)


def blocks(css):
    out = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        vals = {}
        for name, value in re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", body):
            vals[name] = value.strip()
        out[sel.strip()] = vals
    return out


def rgb(theme, name):
    l, c, h, a = parse(theme[name])
    return oklab_to_srgb(*oklch_to_oklab(l, c, h)) + (a,)


def over(top, bottom):
    return tuple(top[i] * top[3] + bottom[i] * (1 - top[3]) for i in range(3)) + (1.0,)


def lum(c):
    def lin(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(x) for x in c[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    a, b = lum(fg), lum(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def hexof(c):
    return "#" + "".join(f"{round(min(1, max(0, x)) * 255):02x}" for x in c[:3])


T, G = "text", "graphic"
PAIRS = [
    ("ink on page", "ink", "bg", T, 4.5),
    ("ink on surface", "ink", "bg-2", T, 4.5),
    ("ink-2 on page", "ink-2", "bg", T, 4.5),
    ("ink-2 on surface", "ink-2", "bg-2", T, 4.5),
    ("ink-3 on page", "ink-3", "bg", T, 4.5),
    ("ink-3 on surface", "ink-3", "bg-2", T, 4.5),
    ("ink-3 on hover row", "ink-3", "bg-3", T, 4.5),
    ("accent link on surface", "accent", "bg-2", T, 4.5),
    ("accent link on page", "accent", "bg", T, 4.5),
    ("accent-ink on accent (primary button)", "accent-ink", "accent", T, 4.5),
    ("accent on accent-soft (selected nav)", "accent", "accent-soft", T, 4.5),
    ("ok on surface", "ok", "bg-2", T, 4.5),
    ("ok on ok-soft (badge)", "ok", "ok-soft", T, 4.5),
    ("warn on surface", "warn", "bg-2", T, 4.5),
    ("warn on warn-soft (badge)", "warn", "warn-soft", T, 4.5),
    ("bad on surface", "bad", "bg-2", T, 4.5),
    ("bad on bad-soft (badge)", "bad", "bad-soft", T, 4.5),
    ("run on surface", "run", "bg-2", T, 4.5),
    ("run on run-soft (badge)", "run", "run-soft", T, 4.5),
    ("input border (line-strong) on surface", "line-strong", "bg-2", G, 3.0),
    ("focus ring on page", "focus", "bg", G, 3.0),
    ("focus ring on surface", "focus", "bg-2", G, 3.0),
    ("focus ring on accent button edge", "focus", "bg-3", G, 3.0),
]

BEFORE_PAIRS = [
    ("foreground on background", "foreground", "background", T, 4.5),
    ("muted-foreground on background", "muted-foreground", "background", T, 4.5),
    ("muted-foreground on muted", "muted-foreground", "muted", T, 4.5),
    ("primary-foreground on primary", "primary-foreground", "primary", T, 4.5),
    ("destructive on background", "destructive", "background", T, 4.5),
    ("border on background", "border", "background", G, 3.0),
    ("ring on background", "ring", "background", G, 3.0),
]


def evaluate(theme, pairs):
    rows = []
    for label, fg, bg, kind, floor in pairs:
        base = rgb(theme, "bg" if "bg" in theme else "background")
        back = over(rgb(theme, bg), base)
        front = over(rgb(theme, fg), back)
        r = ratio(front, back)
        rows.append({"pair": label, "fg": hexof(front), "bg": hexof(back), "ratio": round(r, 2), "floor": floor, "kind": kind, "pass": r >= floor})
    return rows


def load():
    tokens = blocks((ROOT / "tokens.css").read_text())
    dirs = blocks((ROOT / "directions.css").read_text())
    idx = (REPO / "ui/src/index.css").read_text()
    light = re.search(r"\n:root\s*\{(.*?)\n\}", idx, re.S).group(1)
    dark = re.search(r"\n\.dark\s*\{(.*?)\n\}", idx, re.S).group(1)
    pick = lambda body: dict(re.findall(r"--([a-z0-9-]+)\s*:\s*(oklch\([^;]+\));", body))
    themes = {
        ("b", "light"): tokens[':root[data-theme="light"]'],
        ("b", "dark"): tokens[':root[data-theme="dark"]'],
        ("a", "light"): dirs['[data-dir="a"][data-theme="light"]'],
        ("a", "dark"): dirs['[data-dir="a"][data-theme="dark"]'],
        ("c", "light"): dirs['[data-dir="c"][data-theme="light"]'],
        ("c", "dark"): dirs['[data-dir="c"][data-theme="dark"]'],
    }
    before = {("now", "light"): pick(light), ("now", "dark"): pick(dark)}
    return themes, before


def main():
    themes, before = load()
    result = {}
    lines = []
    failed = []
    for (d, t), theme in list(themes.items()) + list(before.items()):
        rows = evaluate(theme, BEFORE_PAIRS if d == "now" else PAIRS)
        result[f"{d}-{t}"] = rows
        lines.append(f"\n## {d} {t}\n\n| Pair | Fg | Bg | Ratio | Floor | Result |\n|---|---|---|---|---|---|")
        for r in rows:
            lines.append(f"| {r['pair']} | {r['fg']} | {r['bg']} | {r['ratio']:.2f} | {r['floor']} | {'pass' if r['pass'] else 'FAIL'} |")
            if d == "b" and not r["pass"]:
                failed.append(f"{t}: {r['pair']} {r['ratio']:.2f} < {r['floor']}")
    DATA.mkdir(exist_ok=True)
    (DATA / "contrast.json").write_text(json.dumps(result, indent=1) + "\n")
    (ROOT / "contrast.md").write_text("# Contrast, computed from tokens.css and directions.css\n" + "\n".join(lines) + "\n")
    for k, rows in result.items():
        worst = min(rows, key=lambda r: r["ratio"] / r["floor"])
        print(f"{k:10s} pass {sum(r['pass'] for r in rows)}/{len(rows)}  worst {worst['pair']} {worst['ratio']}")
    if failed:
        print("FAILURES (chosen direction):", *failed, sep="\n  ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
