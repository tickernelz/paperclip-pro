#!/usr/bin/env python3
import argparse, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:18960/docs/design"
TEXT_MIN, LARGE_MIN, BOUND_MIN, TARGET_MIN = 4.5, 3.0, 3.0, 24


def dump(src_dir, job):
    q, w, h = job
    url = f"{BASE}/{src_dir}/.audit-screen.html?{q}"
    r = subprocess.run(["google-chrome", "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}", "--virtual-time-budget=3000", "--dump-dom", url], capture_output=True, text=True, timeout=120)
    m = re.search(r'<script type="application/json" id="audit-out">(.*?)</script>', r.stdout, re.S)
    if not m:
        return job, None
    return job, json.loads(m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="rebrand-v2/src")
    ap.add_argument("--jobs", required=True, help="file with lines: query width height")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    src = HERE.parent.parent / a.src
    page = (src / "screen.html").read_text().replace("</body>", f'<script src="{BASE}/rebrand-v2/src/audit-probe.js"></script></body>')
    tmp = src / ".audit-screen.html"
    tmp.write_text(page)
    jobs = [tuple([l.split()[0], int(l.split()[1]), int(l.split()[2])]) for l in Path(a.jobs).read_text().splitlines() if l.strip()]
    rows, missing = [], []
    try:
        with ThreadPoolExecutor(3) as ex:
            for (q, w, h), res in ex.map(lambda j: dump(a.src, j), jobs):
                if res is None:
                    missing.append(q)
                    continue
                for it in res["items"]:
                    floor = LARGE_MIN if it["large"] else TEXT_MIN
                    fails = []
                    if it["minText"] is not None and it["minText"] < (floor if it["texts"] else 3.0):
                        fails.append("text")
                    if it["boundary"] is not None and it["boundary"] < BOUND_MIN:
                        fails.append("boundary")
                    rows.append({"screen": q, "size": f"{w}x{h}", "overflowX": res["scrollW"] > res["vw"], **it, "fails": fails})
    finally:
        tmp.unlink(missing_ok=True)
    bad = [r for r in rows if r["fails"]]
    worst = sorted([r for r in rows if r["minText"] is not None], key=lambda r: r["minText"])[:12]
    summary = {"screens": len(jobs) - len(missing), "missing": missing, "buttons": len(rows), "failing": len(bad), "lowestText": worst[0]["minText"] if worst else None, "failKinds": sorted({r["kind"] + "@" + r["ctx"] for r in bad})}
    Path(a.out).write_text(json.dumps({"summary": summary, "worst": worst, "failing": bad[:400]}, indent=1) + "\n")
    print(json.dumps(summary, indent=1))
    for r in worst[:8]:
        print(f"{r['minText']:5.2f} {r['kind']:<16} {r['ctx']:<10} {r['screen']:<34} {r['size']:<9} {r['label']!r} {r['texts'][:1]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
