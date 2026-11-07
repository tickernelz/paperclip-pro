#!/usr/bin/env python3
import json, math, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "pwa"
REPO = ROOT.parents[2]
SHOTS = ROOT / "shots"
sys.path.insert(0, str(HERE))
from contrast import load, rgb, over, hexof, ratio

themes, _ = load()
L, D = themes[("v2", "light")], themes[("v2", "dark")]
INK_L = hexof(over(rgb(L, "ink"), rgb(L, "bg-2")))
BG_L = hexof(rgb(L, "bg"))
BG_D = hexof(rgb(D, "bg"))
INK_D = hexof(over(rgb(D, "ink"), rgb(D, "bg")))
ACC_D = hexof(over(rgb(D, "accent"), rgb(D, "bg")))


def mark(ink, accent, scale, cx=256, cy=256):
    s = scale / 48
    out = [f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{7.4 * s:.2f}" fill="{ink}"/>']
    for k in range(6):
        a = math.radians(-90 + 60 * k)
        x, y = cx + 17 * s * math.cos(a), cy + 17 * s * math.sin(a)
        out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{5.6 * s:.2f}" fill="{accent if k == 1 else ink}"/>')
    return "".join(out)


def svg(body, bg=None, rx=0):
    b = f'<rect width="512" height="512" rx="{rx}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{b}{body}</svg>\n'


VARIANTS = {
    "icon-any": svg(mark(INK_D, ACC_D, 440), BG_D, 112),
    "icon-maskable": svg(mark(INK_D, ACC_D, 300), BG_D, 0),
    "icon-monochrome": svg(mark("#ffffff", "#ffffff", 440)),
    "favicon": svg(mark(INK_D, ACC_D, 470), BG_D, 120),
}
PNG = [("icon-any", 192), ("icon-any", 512), ("icon-maskable", 192), ("icon-maskable", 512), ("icon-monochrome", 512), ("favicon", 16), ("favicon", 32), ("favicon", 48), ("apple-touch-icon", 180)]


def render(name, size):
    src = OUT / f"{'icon-maskable' if name == 'apple-touch-icon' else name}.svg"
    dst = OUT / f"{name}-{size}.png"
    subprocess.run(["magick", "-background", "none", "-density", str(max(72, size * 72 // 512 * 4)), str(src), "-resize", f"{size}x{size}", str(dst)], check=True)
    return dst


def manifest():
    return {
        "id": "/", "name": "Wardmote", "short_name": "Wardmote",
        "description": "Run a company of AI agents: tasks, decisions, approvals and live runs.",
        "lang": "en", "dir": "ltr", "start_url": "/?source=pwa", "scope": "/",
        "display": "standalone", "display_override": ["window-controls-overlay", "standalone"],
        "orientation": "any", "theme_color": BG_L, "background_color": BG_L,
        "categories": ["productivity", "business", "developer"], "prefer_related_applications": False,
        "launch_handler": {"client_mode": ["navigate-existing", "auto"]},
        "icons": [
            {"src": "/icon-any-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icon-any-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            {"src": "/icon-monochrome-512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome"},
            {"src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
        ],
        "screenshots": [
            {"src": "/screenshot-wide.jpg", "sizes": "1800x1125", "type": "image/jpeg", "form_factor": "wide", "label": "Home: what needs you and who is working"},
            {"src": "/screenshot-narrow.jpg", "sizes": "780x1688", "type": "image/jpeg", "form_factor": "narrow", "label": "Inbox on a phone"},
        ],
        "shortcuts": [
            {"name": "Inbox", "short_name": "Inbox", "url": "/inbox?source=pwa-shortcut", "icons": [{"src": "/icon-any-192.png", "sizes": "192x192", "type": "image/png"}]},
            {"name": "Decisions", "short_name": "Decisions", "url": "/inbox/decisions?source=pwa-shortcut", "icons": [{"src": "/icon-any-192.png", "sizes": "192x192", "type": "image/png"}]},
            {"name": "Tasks", "short_name": "Tasks", "url": "/tasks?source=pwa-shortcut", "icons": [{"src": "/icon-any-192.png", "sizes": "192x192", "type": "image/png"}]},
            {"name": "New task", "short_name": "New task", "url": "/tasks/new?source=pwa-shortcut", "icons": [{"src": "/icon-any-192.png", "sizes": "192x192", "type": "image/png"}]},
        ],
    }


HEAD = """<meta name="theme-color" media="(prefers-color-scheme: light)" content="{bl}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="{bd}">
<meta name="application-name" content="Wardmote">
<meta name="apple-mobile-web-app-title" content="Wardmote">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" sizes="180x180">
<link rel="manifest" href="/site.webmanifest" crossorigin="use-credentials">
"""


def ident(p):
    w, h = subprocess.check_output(["magick", "identify", "-format", "%w %h", str(p)], text=True).split()
    return int(w), int(h)


def opaque_bbox_radius(p):
    out = subprocess.check_output(["magick", str(p), "-alpha", "off", "-fuzz", "6%", "-fill", "black", "-opaque", BG_D, "-fill", "white", "+opaque", "black", "-format", "%@", "info:"], text=True)
    wh, x, y = out.split("+")[0], int(out.split("+")[1]), int(out.split("+")[2])
    w, h = (int(v) for v in wh.split("x"))
    W, H = ident(p)
    cx, cy = W / 2, H / 2
    far = max(math.hypot(px - cx, py - cy) for px in (x, x + w) for py in (y, y + h))
    return far / (W / 2)


def validate(m):
    res = []
    def chk(name, ok, detail=""):
        res.append({"check": name, "pass": bool(ok), "detail": detail})
    for k in ("id", "name", "short_name", "start_url", "scope", "display", "icons", "theme_color", "background_color"):
        chk(f"field {k}", k in m and m[k] not in ("", None, []))
    chk("start_url inside scope", m["start_url"].startswith(m["scope"]), f"{m['start_url']} in {m['scope']}")
    sizes = {(i["sizes"], i.get("purpose", "any")) for i in m["icons"]}
    chk("icon 192 any", ("192x192", "any") in sizes)
    chk("icon 512 any", ("512x512", "any") in sizes)
    chk("icon maskable", any(p == "maskable" for _, p in sizes))
    chk("icon monochrome", any(p == "monochrome" for _, p in sizes))
    for i in m["icons"] + m["screenshots"]:
        f = OUT / i["src"].lstrip("/")
        if i["sizes"] == "any":
            chk(f"file {i['src']}", f.exists())
            continue
        want = tuple(int(v) for v in i["sizes"].split("x"))
        chk(f"size {i['src']}", f.exists() and ident(f) == want, f"{ident(f) if f.exists() else 'missing'} vs {want}")
    r = opaque_bbox_radius(OUT / "icon-maskable-512.png")
    chk("maskable mark inside 80% safe circle", r <= 0.80, f"farthest mark pixel at {r:.2f} of radius")
    chk("wide and narrow screenshots", {s["form_factor"] for s in m["screenshots"]} == {"wide", "narrow"})
    chk("shortcut Decisions", any(s["name"] == "Decisions" for s in m["shortcuts"]))
    sw = (REPO / "ui/public/sw.js").read_text()
    chk("sw.js fetch handler", 'addEventListener("fetch"' in sw)
    chk("sw.js push and notificationclick", 'addEventListener("push"' in sw and 'addEventListener("notificationclick"' in sw)
    chk("launch_handler navigate-existing", "navigate-existing" in m["launch_handler"]["client_mode"])
    return res


def main():
    OUT.mkdir(exist_ok=True)
    for k, v in VARIANTS.items():
        (OUT / f"{k}.svg").write_text(v)
    for n, s in PNG:
        render(n, s)
    subprocess.run(["magick", str(SHOTS / "home-light-1440x900.jpg"), "-resize", "1800x1125!", "-quality", "80", str(OUT / "screenshot-wide.jpg")], check=True)
    subprocess.run(["magick", str(SHOTS / "inbox-light-390x844.jpg"), "-resize", "780x1688!", "-quality", "80", str(OUT / "screenshot-narrow.jpg")], check=True)
    m = manifest()
    (OUT / "site.webmanifest").write_text(json.dumps(m, indent=2) + "\n")
    (OUT / "head.html").write_text(HEAD.format(bl=BG_L, bd=BG_D))
    res = validate(m)
    old = json.loads((REPO / "ui/public/site.webmanifest").read_text())
    summary = {"pass": sum(r["pass"] for r in res), "total": len(res), "checks": res, "themeLight": BG_L, "themeDark": BG_D, "oldName": old["name"], "oldTheme": old["theme_color"], "oldShortcuts": [s["name"] for s in old["shortcuts"]], "markOnBgDark": round(ratio(tuple(int(INK_D[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1,), tuple(int(BG_D[i:i + 2], 16) / 255 for i in (1, 3, 5)) + (1,)), 2)}
    (ROOT / "measurements" / "pwa.json").write_text(json.dumps(summary, indent=1) + "\n")
    for r in res:
        print(("PASS" if r["pass"] else "FAIL"), r["check"], r["detail"])
    print(summary["pass"], "/", summary["total"])
    return 0 if summary["pass"] == summary["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
