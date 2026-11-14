#!/usr/bin/env python3
import json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
V1 = HERE.parents[1] / "rebrand-v1" / "src"
M = HERE.parent / "measurements"


def tokens(p):
    return len(set(re.findall(r"(?m)^\s*(--[a-z0-9-]+)\s*:", (p / "tokens.css").read_text())))


def css_classes(p):
    s = (p / "app.css").read_text()
    return len(set(re.findall(r"\.([a-z][a-z0-9-]*)", re.sub(r"\d+\.\d+", "", s))))


def variants(p, comp):
    s = (p / "app.css").read_text()
    return sorted(set(re.findall(r"\." + comp + r"\.([a-z]+)", s)) - {"focus", "hover", "active", "loading", "selected", "on", "sm", "block"})


def screens(p):
    return len(set(re.findall(r"S(?:\.|\[')([a-z][a-z0-9-]*)'?\]?\s*=\s*\(", "".join(f.read_text() for f in p.glob("screens-*.js")))))


def container_overrides(p):
    s = (p / "app.css").read_text()
    hits = []
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", s):
        sel = sel.strip()
        if re.search(r"\s(span|a|b|div|\*)\s*$", sel.split(",")[-1]) and re.search(r"\b(color|font-size)\s*:", body):
            hits.append(sel)
    return hits


def bytes_of(p, pats):
    return sum(f.stat().st_size for pat in pats for f in p.glob(pat))


out = {}
for name, p in (("v1", V1), ("v2", HERE)):
    out[name] = {"tokens": tokens(p), "cssClasses": css_classes(p), "buttonVariants": variants(p, "btn"), "screens": screens(p), "containerOverrides": container_overrides(p), "cssBytes": bytes_of(p, ["app.css", "tokens.css"]), "cssRules": len(re.findall(r"\{", (p / "app.css").read_text()))}
(M / "complexity.json").write_text(json.dumps(out, indent=1) + "\n")
for k, v in out.items():
    print(k, {a: (b if not isinstance(b, list) else (len(b), b[:8])) for a, b in v.items()})
