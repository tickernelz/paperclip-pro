#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME=${CHROME:-google-chrome}
OUT=wardmote-rebrand-v1.pdf
nice -n 19 "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --allow-file-access-from-files --virtual-time-budget=15000 \
  --print-to-pdf="$OUT" "file://$PWD/src/doc.html" >/dev/null 2>&1
pdfinfo "$OUT" | grep -E '^(Pages|Page size|File size)'
