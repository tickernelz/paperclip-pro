#!/usr/bin/env python3
import json, re, subprocess, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=HERE, text=True).strip())
OUT = HERE.parent / "measurements" / "measure.json"
SELF = "docs/design/rebrand-v1/"


def sh(*args, ok=(0, 1)):
    r = subprocess.run(args, cwd=REPO, capture_output=True, text=True)
    if r.returncode not in ok:
        sys.exit(f"{args}: {r.stderr}")
    return r.stdout


def lines(*args):
    return [l for l in sh(*args).splitlines() if l and not l.startswith(SELF)]


def gg_files(pattern, *flags, paths=()):
    return lines("git", "grep", "-l", *flags, "-e", pattern, "--", *paths)


def gg_count(pattern, *flags, paths=()):
    total = 0
    for l in lines("git", "grep", "-c", *flags, "-e", pattern, "--", *paths):
        total += int(l.rsplit(":", 1)[1])
    return total


def tracked(*paths):
    return lines("git", "ls-files", "--", *paths)


def loc(files):
    n = 0
    for f in files:
        try:
            n += (REPO / f).read_bytes().count(b"\n")
        except (IsADirectoryError, FileNotFoundError):
            pass
    return n


m = {}
m["commit"] = sh("git", "rev-parse", "HEAD").strip()
m["cliVersion"] = json.loads((REPO / "cli/package.json").read_text())["version"]
files = tracked()
m["trackedFiles"] = len(files)

name = {}
name["filesWithPaperclip"] = len(gg_files("paperclip", "-i"))
name["linesWithPaperclip"] = gg_count("paperclip", "-i")
name["textFilesWithPaperclip"] = len(gg_files("paperclip", "-i", "-I"))
name["filesWithScope"] = len(gg_files("@tickernelz/paperclip-pro", "-F"))
pkg_all = [f for f in files if f.endswith("package.json")]
pkg_json = [json.loads((REPO / f).read_text()) for f in pkg_all]
name["packageJsonTracked"] = len(pkg_all)
name["packagesScoped"] = sum(1 for p in pkg_json if (p.get("name") or "").startswith("@tickernelz/paperclip-pro"))
name["publishable"] = sum(1 for p in pkg_json if (p.get("name") or "").startswith("@tickernelz/paperclip-pro") and not p.get("private"))
name["bin"] = json.loads((REPO / "cli/package.json").read_text()).get("bin")
env_tokens = Counter(re.findall(r"PAPERCLIP_[A-Z0-9_]+", sh("git", "grep", "-ohE", "PAPERCLIP_[A-Z0-9_]+", "--", ".", ":!" + SELF)))
name["envTokensDistinct"] = len(env_tokens)
name["envFiles"] = len(gg_files("PAPERCLIP_[A-Z0-9_]+", "-E"))
name["envOccurrences"] = sum(env_tokens.values())
name["envTop"] = env_tokens.most_common(12)
name["homeDirFiles"] = len(gg_files(".paperclip-pro", "-F"))
name["serviceFiles"] = len(gg_files("paperclip-pro.service", "-F"))
name["binInvocationFiles"] = len(gg_files(r"(^|[^/@a-z-])paperclip-pro( |$|\")", "-E"))
name["displayNameUiFiles"] = len([f for f in gg_files(r"\bPaperclip\b", "-P", paths=("ui/src",)) if ".test." not in f])
name["displayNameUiLines"] = gg_count(r"\bPaperclip\b", "-P", paths=("ui/src", ":!*.test.*"))
en = json.loads((REPO / "ui/src/i18n/locales/en.json").read_text())


def walk(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, str):
        yield o


name["enStrings"] = len(list(walk(en)))
tools = json.loads((REPO / "packages/mcp-server/src/generated/api-tools.json").read_text())
tool_list = tools if isinstance(tools, list) else tools.get("tools", [])
tool_names = [t.get("name", "") for t in tool_list if isinstance(t, dict)]
name["mcpTools"] = len(tool_names)
name["mcpToolsPrefixed"] = sum(1 for n in tool_names if n.startswith("paperclip"))
name["mcpToolNameFiles"] = len(gg_files(r"\bpaperclip[A-Z][A-Za-z]+\b", "-P"))
skills = sorted(p.name for p in (REPO / "skills").iterdir() if p.is_dir())
name["skills"] = skills
name["skillsPrefixed"] = [s for s in skills if s.startswith("paperclip")]
lic = (REPO / "LICENSE").read_text()
name["licenseCopyright"] = [l.strip() for l in lic.splitlines() if l.lower().startswith("copyright")]
m["name"] = name

ad = {}
folders = sorted(p.name for p in (REPO / "packages/adapters").iterdir() if p.is_dir())
ad["folders"] = folders
const = (REPO / "packages/shared/src/constants.ts").read_text()
types = re.findall(r'"([a-z_]+)"', re.search(r"AGENT_ADAPTER_TYPES = \[(.*?)\]", const, re.S).group(1))
ad["types"] = types
refs = {}
for t in types:
    if t in ("process", "http", "cursor"):
        refs[t] = len(gg_files(f'"{t}"', "-F"))
    else:
        refs[t] = len(gg_files(t, "-w"))
ad["refsByWord"] = refs
per = {}
for f in folders:
    fs = tracked(f"packages/adapters/{f}")
    per[f] = {"files": len(fs), "loc": loc(fs)}
ad["perFolder"] = per
ui_adapters = REPO / "ui/src/adapters"
ad["uiAdapterDirs"] = sorted(p.name for p in ui_adapters.iterdir() if p.is_dir()) if ui_adapters.exists() else []
ad["uiAdapterFiles"] = {d: len(tracked(f"ui/src/adapters/{d}")) for d in ad["uiAdapterDirs"]}
ad["ompUiFiles"] = tracked("packages/adapters/omp-local/src/ui")
ad["configFieldsFiles"] = [f for f in files if f.endswith("config-fields.tsx")]
m["adapters"] = ad

ui = {}
uifiles = [f for f in tracked("ui/src") if re.search(r"\.(ts|tsx|css)$", f)]
ui["tsTsxCssUi"] = len([f for f in tracked("ui") if re.search(r"\.(ts|tsx|css)$", f)])
ui["tsTsxCss"] = len(uifiles)
ui["pages"] = len([f for f in uifiles if f.startswith("ui/src/pages/")])
ui["components"] = len([f for f in uifiles if f.startswith("ui/src/components/")])
ui["filesDarkVariant"] = len(gg_files("dark:", "-F", paths=("ui/src",)))
ui["filesDarkOrTheme"] = len(gg_files(r"dark:|theme", "-E", "-i", paths=("ui/src",)))
ui["themeFiles"] = [f for f in tracked("ui/src") if re.search(r"Theme(Context|Toggle)", f)]
pages = [f for f in tracked("ui/src/pages") if f.endswith(".tsx") and ".test." not in f and ".stories." not in f]
ui["pageModules"] = sorted(f[len("ui/src/pages/"):] for f in pages)
app = (REPO / "ui/src/App.tsx").read_text()
ui["routes"] = sorted(set(re.findall(r'path="([^"]+)"', app)))
ui["locales"] = sorted(p.stem for p in (REPO / "ui/src/i18n/locales").glob("*.json"))
ui["onboarding"] = sorted(p.name for p in (REPO / "ui/src/components/onboarding").iterdir())
idx = (REPO / "ui/src/index.css").read_text()
ui["indexCssTokens"] = len(set(re.findall(r"(--[a-z0-9-]+)\s*:", idx)))
ui["indexCssLines"] = idx.count("\n")
m["ui"] = ui

before = {}
sb = (REPO / "ui/src/components/Sidebar.tsx").read_text()
labels = re.findall(r'label="([^"]+)"', sb)
before["sidebarLabels"] = labels
before["sidebarDistinct"] = len(dict.fromkeys(labels))
srcs = [f for f in tracked("ui/src") if re.search(r"\.(tsx|ts)$", f) and ".test." not in f and ".stories." not in f]
bodies = {f: (REPO / f).read_text(errors="ignore") for f in srcs}
text = "\n".join(bodies.values())
pal = re.compile(r"\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b")
before["paletteClassUses"] = len(pal.findall(text))
before["paletteClassFiles"] = sum(1 for b in bodies.values() if pal.search(b))
before["paletteDistinct"] = len(set(pal.findall(text)))
before["arbitraryPxUses"] = len(re.findall(r"-\[\d+(?:\.\d+)?px\]", text))
sizes = set(re.findall(r"\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b", text)) | set(re.findall(r"\btext-\[\d+(?:\.\d+)?(?:px|rem)\]", text))
before["textSizesDistinct"] = len(sizes)
radii = set(re.findall(r"\brounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?\b", text))
before["radiusClassesDistinct"] = len(radii)
before["darkVariantUses"] = len(re.findall(r"\bdark:", text))
light = re.search(r"\n:root\s*\{(.*?)\n\}", idx, re.S)
dark = re.search(r"\n\.dark\s*\{(.*?)\n\}", idx, re.S)


def pick(block):
    out = {}
    if not block:
        return out
    for k in ("background", "foreground", "muted-foreground", "border", "primary", "primary-foreground", "ring", "destructive", "muted", "card"):
        mm = re.search(r"--" + k + r":\s*([^;]+);", block.group(1))
        if mm:
            out[k] = mm.group(1).strip()
    return out


before["tokensLight"] = pick(light)
before["tokensDark"] = pick(dark)
before["fontSans"] = re.search(r"--font-sans:\s*([^;]+);", idx).group(1)
m["uiBefore"] = before

omp = {}
cfg = REPO / "packages/adapters/omp-local/src/server"
src = "\n".join(p.read_text() for p in cfg.glob("*.ts") if ".test." not in p.name)
omp["adapterConfigKeys"] = sorted(set(re.findall(r"\bconfig\.([a-zA-Z]+)\b", src)) - {"yml", "yaml", "js", "json"})
settings = []
section = None
raw_list = subprocess.run(["omp", "config", "list"], capture_output=True, text=True).stdout
for line in raw_list.splitlines():
    s = re.match(r"^\[([a-z]+)\]$", line.strip())
    if s:
        section = s.group(1)
        continue
    kv = re.match(r"^\s{2}([A-Za-z0-9_.\-]+) = (.*) \(([^()]*)\)$", line)
    if kv and section:
        key, value, typ = kv.groups()
        entry = {"key": key, "section": section, "type": typ}
        if typ in ("boolean", "number") or "|" in typ:
            entry["value"] = value
        settings.append(entry)
omp["version"] = subprocess.run(["omp", "--version"], capture_output=True, text=True).stdout.strip()
omp["settingsTotal"] = len(settings)
omp["sections"] = dict(Counter(e["section"] for e in settings))
omp["types"] = dict(Counter("enum" if "|" in e["type"] else e["type"] for e in settings))
omp["settings"] = settings
m["omp"] = omp

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(m, indent=1) + "\n")
print(json.dumps({k: v for k, v in name.items() if k not in ("skills", "envTop")}, indent=1))
print(json.dumps({"types": len(types), "folders": len(folders), "refs": refs, "per": per, "ui": ad["uiAdapterFiles"]}))
print(json.dumps({k: v for k, v in ui.items() if k not in ("pageModules", "routes", "onboarding", "locales")}), len(ui["pageModules"]), len(ui["routes"]), len(ui["locales"]))
print(json.dumps({k: v for k, v in before.items() if k != "sidebarLabels"}))
print(omp["version"], omp["settingsTotal"], omp["sections"], omp["types"], len(omp["adapterConfigKeys"]))
