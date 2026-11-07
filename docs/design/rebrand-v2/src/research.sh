#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=research
mkdir -p "$OUT"
while read -r name url; do
  [ -z "$name" ] && continue
  nice -n 19 timeout 60 google-chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --virtual-time-budget=9000 \
    --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36" \
    --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1
  if [ -s "$OUT/$name.png" ]; then magick "$OUT/$name.png" -resize 720x -quality 78 "$OUT/$name.jpg" && rm -f "$OUT/$name.png"; fi
  printf '%s %s %s\n' "$name" "$url" "$( [ -s "$OUT/$name.jpg" ] && echo ok || echo fail)"
done < src/research.txt
