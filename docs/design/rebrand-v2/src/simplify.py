#!/usr/bin/env python3
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = HERE.parent / "measurements"
E = json.loads((M / "essential.json").read_text())
ESS = {r["key"]: r for r in E["essential"]}

CONTROLS = [
    {"id": "preset", "label": "Style", "choices": ["Balanced", "Fast", "Thorough"], "keys": ["thinking", "advisor.enabled", "prewalk.enabled", "retry.maxRetries"], "how": "Balanced: thinking high, advisor on, prewalk off, 3 retries. Fast: thinking low, prewalk on to the small model, advisor off. Thorough: thinking xhigh, advisor on, 5 retries."},
    {"id": "model", "label": "Model", "choices": ["picked from models OMP reports"], "keys": ["model", "smolModel", "slowModel", "planModel"], "how": "One pick. Small, slow and plan models follow the same provider family automatically."},
    {"id": "thinking", "label": "Thinking", "choices": ["Quick", "Balanced", "Deep", "Max"], "keys": ["thinking", "modelEfforts", "defaultThinkingLevel"], "how": "Quick = low, Balanced = medium, Deep = high, Max = xhigh; per-model effort derived."},
    {"id": "backup", "label": "Backup models", "choices": ["Automatic", "Custom list"], "keys": ["fallbackModels", "retry.fallbackOn"], "how": "Automatic: next model of the same tier from another provider OMP lists, used on rate limit or outage."},
    {"id": "tools", "label": "Tools", "choices": ["Standard", "Read only", "Everything"], "keys": ["tools", "tools.approvalMode", "bash.enabled", "browser.enabled", "web_search.enabled", "github.enabled", "ask.enabled", "lsp.enabled"], "how": "Standard = OMP default set; Read only = no shell, no edits; Everything = Standard plus browser."},
    {"id": "limit", "label": "Stop a run after", "choices": ["30 min", "1 hour", "2 hours", "No limit"], "keys": ["maxTime", "timeoutSec"], "how": "One value sets both."},
]
ELSEWHERE = {"skills": "Skills tab", "instructionsFilePath": "Instructions tab", "systemPrompt": "Instructions tab", "env": "Secrets and environment"}

covered = sorted({k for c in CONTROLS for k in c["keys"] if k in ESS})
else_ = sorted(k for k in ELSEWHERE if k in ESS)
rest = sorted(k for k in ESS if k not in covered and k not in ELSEWHERE)
assert all(k in ESS for c in CONTROLS for k in c["keys"]), [k for c in CONTROLS for k in c["keys"] if k not in ESS]

FLOWS = {
    "a": {"title": "Pengguna baru: instalasi sampai agent pertama menjalankan task",
          "v1": [("Pilih OS (tab, terdeteksi tapi tampil sebagai pilihan)", 1, 1, 0), ("Jalankan perintah pasang di terminal, klik Continue", 0, 1, 0), ("Pilih provider", 1, 1, 0), ("Sign in provider", 0, 1, 0), ("Pilih model default", 1, 1, 1), ("Continue", 0, 1, 0), ("Isi nama agent", 0, 0, 1), ("Pilih peran", 1, 1, 0), ("Isi folder kerja", 0, 0, 1), ("Baca 4 nilai config OMP, Create agent", 0, 1, 0), ("Isi task pertama (opsional)", 0, 0, 1), ("Open Home", 0, 1, 0)],
          "v2": [("OS dan omp terdeteksi; jalankan perintah, layar maju sendiri saat cek lulus", 0, 0, 0), ("Provider: diimpor dari ~/.omp bila sudah sign in; bila belum, pilih provider dan sign in", 1, 2, 0), ("Model: rekomendasi terpilih otomatis", 0, 0, 0), ("Tulis task pertama (satu kotak teks); nama Atlas dan folder terdeteksi bisa diganti nanti", 0, 0, 1), ("Start", 0, 1, 0)]},
    "b": {"title": "Mengubah model satu agent saja (override)",
          "v1": [("Buka Agents", 0, 1, 0), ("Buka Raka", 0, 1, 0), ("Tab OMP config", 0, 1, 0), ("Cari baris Model di tabel Effective", 0, 0, 0), ("Ketik nilai model di input", 0, 1, 1), ("Save", 0, 1, 0), ("Dialog diff dan apply-to, Save for 1 agent", 1, 1, 0)],
          "v2": [("Buka Agents", 0, 1, 0), ("Buka Raka", 0, 1, 0), ("Tab Setup", 0, 1, 0), ("Pilih model dari daftar terdeteksi", 1, 2, 0), ("Save di bilah simpan (label sesi tampil di bilah)", 0, 1, 0)]},
    "c": {"title": "Mengubah default untuk semua agent (global)",
          "v1": [("Buka OMP config", 0, 1, 0), ("Tab Global defaults", 0, 1, 0), ("Cari baris Model", 0, 0, 0), ("Ketik nilai model", 0, 1, 1), ("Save, dialog konfirmasi", 1, 2, 0)],
          "v2": [("Settings > Agent defaults", 0, 2, 0), ("Pilih model dari daftar", 1, 2, 0), ("Save (bilah menyebut 17 agent yang ikut, 4 yang punya nilai sendiri)", 0, 1, 0)]},
}


def tot(steps):
    return {"decisions": sum(s[1] for s in steps), "clicks": sum(s[2] for s in steps), "fields": sum(s[3] for s in steps), "steps": len(steps)}


out = {"controls": CONTROLS, "coveredEssential": covered, "elsewhere": {k: ELSEWHERE[k] for k in else_}, "advancedEssential": rest, "counts": {"essential": len(ESS), "byControls": len(covered), "elsewhere": len(else_), "advancedOnly": len(rest), "controls": len(CONTROLS), "searchable": E["searchable"]}, "flows": {k: {"title": f["title"], "v1": f["v1"], "v2": f["v2"], "v1t": tot(f["v1"]), "v2t": tot(f["v2"])} for k, f in FLOWS.items()}}
(M / "simplify.json").write_text(json.dumps(out, indent=1) + "\n")
print(json.dumps(out["counts"]), {k: (v["v1t"], v["v2t"]) for k, v in out["flows"].items()})
print("advanced-only:", rest)
