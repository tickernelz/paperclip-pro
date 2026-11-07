#!/usr/bin/env python3
import json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:18960/docs/design/rebrand-v2/src"
PROBE = """<script>window.addEventListener('load',()=>setTimeout(()=>{const W=innerWidth;const bad=[];let maxR=0;document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return;const s=getComputedStyle(e);if(s.position==='fixed')return;let clip=false;for(let p=e.parentElement;p;p=p.parentElement){const ps=getComputedStyle(p);if(/(hidden|auto|scroll|clip)/.test(ps.overflowX)){const pr=p.getBoundingClientRect();if(pr.right<=W+0.5){clip=true;break;}}}if(clip)return;if(r.right>W+0.5){maxR=Math.max(maxR,r.right);if(bad.length<5)bad.push((e.className&&e.className.baseVal===undefined?e.className:e.tagName)+':'+Math.round(r.right));}});const sm=[];if(W<1024){document.querySelectorAll('.btn,.iconbtn,.bnav-item,.chip,.seg>span,.tabs>span,[role=switch]').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&Math.min(r.height,r.width)<24)sm.push((e.className||e.tagName)+':'+Math.round(r.width)+'x'+Math.round(r.height));});}const o=document.createElement('script');o.type='application/json';o.id='ov';o.textContent=JSON.stringify({sw:document.documentElement.scrollWidth,W,maxR:Math.round(maxR),bad,small:sm.slice(0,5),smallN:sm.length});document.body.appendChild(o);},300));</script>"""


def one(job):
    s, t, w, h = job
    url = f"{BASE}/.ov.html?screen={s}&theme={t}"
    r = subprocess.run(["google-chrome", "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={w},{h}", "--virtual-time-budget=2500", "--dump-dom", url], capture_output=True, text=True, timeout=120)
    m = re.search(r'id="ov">(.*?)</script>', r.stdout, re.S)
    return job, (json.loads(m.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")) if m else None)


def main():
    sys.path.insert(0, str(HERE))
    import jobs as J
    page = (HERE / "screen.html").read_text().replace("</body>", PROBE + "</body>")
    tmp = HERE / ".ov.html"
    tmp.write_text(page)
    only = [j for j in J.jobs() if j[1] == "light"] if "--light" in sys.argv else list(J.jobs())
    rows = []
    try:
        with ThreadPoolExecutor(3) as ex:
            for job, res in ex.map(one, only):
                rows.append({"screen": job[0], "theme": job[1], "size": f"{job[2]}x{job[3]}", **(res or {"missing": True})})
    finally:
        tmp.unlink(missing_ok=True)
    over = [r for r in rows if r.get("missing") or r.get("sw", 0) > r.get("W", 0) or r.get("maxR", 0) > r.get("W", 1e9)]
    small = [r for r in rows if r.get("smallN")]
    sizes = sorted({r["size"] for r in rows}, key=lambda x: int(x.split("x")[0]))
    out = {"renders": len(rows), "screens": len({r["screen"] for r in rows}), "sizes": sizes, "overflow": len(over), "smallTargets": len(small), "overflowRows": over[:60], "smallRows": small[:60]}
    (HERE.parent / "measurements" / "overflow.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({k: v for k, v in out.items() if not k.endswith("Rows")}))
    for r in over[:25]:
        print("OVER", r["screen"], r["theme"], r["size"], r.get("sw"), r.get("maxR"), r.get("bad"))
    for r in small[:15]:
        print("SMALL", r["screen"], r["size"], r["small"])
    return 1 if over or small else 0


if __name__ == "__main__":
    sys.exit(main())
