#!/usr/bin/env python3
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "measurements"
sys.path.insert(0, str(HERE))
from contrast import load, rgb, over, hexof

ESSENTIAL = [
    ("Model", "model", "adapter", "model"),
    ("Thinking level", "thinking", "adapter", "model"),
    ("Effort per model", "modelEfforts", "adapter", "model"),
    ("Fallback chain", "fallbackModels", "adapter", "model"),
    ("Small model", "smolModel", "adapter", "model"),
    ("Slow model", "slowModel", "adapter", "model"),
    ("Plan model", "planModel", "adapter", "model"),
    ("Default thinking level", "defaultThinkingLevel", "omp", "model"),
    ("Advisor", "advisor.enabled", "omp", "model"),
    ("Prewalk to small model", "prewalk.enabled", "omp", "model"),
    ("Retries", "retry.maxRetries", "omp", "model"),
    ("Fall back on", "retry.fallbackOn", "omp", "model"),
    ("Hide thinking from log", "omitThinking", "omp", "model"),
    ("Tool allowlist", "tools", "adapter", "tools"),
    ("Approval mode", "tools.approvalMode", "omp", "tools"),
    ("Shell", "bash.enabled", "omp", "tools"),
    ("Browser", "browser.enabled", "omp", "tools"),
    ("Web search", "web_search.enabled", "omp", "tools"),
    ("GitHub tool", "github.enabled", "omp", "tools"),
    ("Ask tool", "ask.enabled", "omp", "tools"),
    ("LSP", "lsp.enabled", "omp", "tools"),
    ("Skills", "skills", "adapter", "tools"),
    ("MCP startup timeout", "mcp.startupTimeoutMs", "omp", "tools"),
    ("MCP project config", "mcp.enableProjectConfig", "omp", "tools"),
    ("Extensions", "extensions", "adapter", "tools"),
    ("Hooks", "hooks", "adapter", "tools"),
    ("Context notes", "compaction.experimentalContextManagement", "omp", "context"),
    ("Compaction threshold", "compaction.thresholdPercent", "omp", "context"),
    ("Extra context files", "contextFiles.extra", "omp", "context"),
    ("Subagent depth", "task.maxRecursionDepth", "omp", "run"),
    ("Max run time", "maxTime", "adapter", "run"),
    ("Timeout", "timeoutSec", "adapter", "run"),
    ("Instructions file", "instructionsFilePath", "adapter", "run"),
    ("System prompt", "systemPrompt", "adapter", "run"),
    ("Environment variables", "env", "adapter", "run"),
    ("OMP profile", "profile", "adapter", "run"),
]
MODEL_SWITCH = {"model", "fallbackModels", "modelEfforts", "thinking", "thinkingEffort", "effort"}
NEUTRAL = {"instructionsFilePath", "promptTemplate", "bootstrapPromptTemplate"}


def main():
    m = json.loads((DATA / "measure.json").read_text())
    omp = {e["key"]: e for e in m["omp"]["settings"]}
    adapter = set(m["omp"]["adapterConfigKeys"])
    rows = []
    missing = []
    for label, key, src, group in ESSENTIAL:
        if src == "omp":
            e = omp.get(key)
            if not e or e["section"] == "internal":
                missing.append(key)
                continue
            typ = "enum" if "|" in e["type"] else e["type"]
            sec = e["section"]
        else:
            if key not in adapter:
                missing.append(key)
            typ, sec = "adapter", "adapter"
        session = "keep" if key in MODEL_SWITCH or key in NEUTRAL else "new"
        rows.append({"label": label, "key": key, "source": src, "group": group, "type": typ, "section": sec, "session": session})
    visible = [e for e in m["omp"]["settings"] if e["section"] != "internal"]
    ess_omp = sum(1 for r in rows if r["source"] == "omp")
    out = {
        "essential": rows,
        "essentialCount": len(rows),
        "essentialOmp": ess_omp,
        "essentialAdapter": len(rows) - ess_omp,
        "visibleOmp": len(visible),
        "advancedOmp": len(visible) - ess_omp,
        "searchable": len(visible) + len(rows) - ess_omp,
        "hiddenInternal": m["omp"]["sections"]["internal"],
        "adapterKeysNotInEssential": sorted(adapter - {r["key"] for r in rows}),
        "missing": missing,
    }
    themes, before = load()
    sw = {}
    names = ["bg", "bg-2", "bg-3", "line-soft", "line", "line-strong", "ink", "ink-2", "ink-3", "accent", "accent-ink", "accent-soft", "ok", "warn", "bad", "run", "focus", "ok-soft", "warn-soft", "bad-soft", "run-soft"]
    for d in ("a", "b", "c"):
        for t in ("light", "dark"):
            th = themes[(d, t)]
            base = rgb(th, "bg")
            sw[f"{d}-{t}"] = {n: {"hex": hexof(over(rgb(th, n), base)), "oklch": th[n]} for n in names}
    (DATA / "swatches.json").write_text(json.dumps(sw, indent=1) + "\n")
    (DATA / "essential.json").write_text(json.dumps(out, indent=1) + "\n")
    print({k: v for k, v in out.items() if k != "essential"})


if __name__ == "__main__":
    main()
