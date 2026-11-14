#!/usr/bin/env python3
import json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=HERE, text=True).strip())
OUT = HERE.parent / "measurements" / "features.json"


def gl(pattern, *paths):
    r = subprocess.run(["git", "grep", "-lw", pattern, "--", *paths], cwd=REPO, capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l and "docs/design/" not in l]


src = (REPO / "packages/shared/src/feature-catalog.ts").read_text()
body = src.split("INSTANCE_FEATURE_CATALOG", 1)[1]
entries = {}
for m in re.finditer(r"\n  (\w+): \{(.*?)\n?  \},", body, re.S):
    key, blk = m.group(1), m.group(2)
    t = re.search(r'title:\s*"([^"]*)"', blk)
    d = re.search(r'description:\s*((?:"[^"]*"\s*\+?\s*)+)', blk)
    desc = "".join(re.findall(r'"([^"]*)"', d.group(1))) if d else ""
    tier = re.search(r'tier:\s*"(\w+)"', blk)
    sh = re.search(r"selfHostedDefault:\s*(true|false)", blk)
    cl = re.search(r"cloudDefault:\s*(true|false)", blk)
    entries[key] = {"title": t.group(1) if t else key, "description": desc, "tier": tier.group(1) if tier else None, "selfHostedDefault": sh and sh.group(1) == "true", "cloudDefault": cl and cl.group(1) == "true"}
exp = (REPO / "ui/src/pages/InstanceExperimentalSettings.tsx").read_text()
for k, e in entries.items():
    ui = [f for f in gl(k, "ui/src") if ".test." not in f]
    sv = [f for f in gl(k, "server/src", "packages", "cli/src") if ".test." not in f]
    tests = gl(k, "ui/src", "server/src", "packages", "cli/src")
    e["uiFiles"] = len(ui)
    e["serverFiles"] = len(sv)
    e["testFiles"] = len([f for f in tests if ".test." in f])
    e["uiPagesOrComponents"] = len([f for f in ui if f.startswith(("ui/src/pages", "ui/src/components"))])
    i = exp.find(k)
    e["onExperimentalPage"] = i >= 0
    win = exp[max(0, i - 600): i + 900] if i >= 0 else ""
    e["restartHint"] = bool(re.search(r"restart", win, re.I))
live = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else {}
for k, e in entries.items():
    e["live"] = live.get(k)
OUT.write_text(json.dumps({"count": len(entries), "entries": entries}, indent=1) + "\n")
print(len(entries), sum(1 for e in entries.values() if e["live"]), sum(1 for e in entries.values() if e["live"] is False))
for k, e in entries.items():
    print(f"{k:42s} {str(e['live']):5s} {e['tier']:10s} ui={e['uiFiles']:3d} sv={e['serverFiles']:3d} rs={int(e['restartHint'])} {e['title']}")
