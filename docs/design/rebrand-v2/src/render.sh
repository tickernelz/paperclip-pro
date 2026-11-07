#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
OUT="$PWD/../shots"
BASE=${BASE:-http://127.0.0.1:18960/docs/design/rebrand-v2/src}
mkdir -p "$OUT"
shoot() {
  local s=$1 t=$2 w=$3 h=$4 scale=1.25
  [ "$w" -le 768 ] && scale=2
  local name="$s-$t-${w}x$h"
  google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="$scale" --window-size="$w,$h" \
    --virtual-time-budget=2500 --screenshot="$OUT/$name.png" "$BASE/screen.html?screen=$s&theme=$t" >/dev/null 2>&1
  magick "$OUT/$name.png" -quality 80 "$OUT/$name.jpg" && rm -f "$OUT/$name.png"
}
export -f shoot
export OUT BASE
if [ $# -gt 0 ]; then python3 jobs.py | grep -E "$1"; else python3 jobs.py; fi | nice -n 19 xargs -P 3 -L 1 bash -c 'shoot "$@"' _
ls "$OUT" | wc -l
