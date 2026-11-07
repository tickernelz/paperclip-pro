#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
SRC=$PWD
OUT="$SRC/../shots"
SCALE=${SCALE:-1.5}
CHROME=${CHROME:-google-chrome}
mkdir -p "$OUT"

DESKTOP="dashboard inbox approvals tasks task agents agent org routines costs connectors browser chat settings instance
ob-install ob-old ob-offline ob-remote ob-model ob-agent ob-done
cfg-global cfg-agent cfg-search cfg-save cfg-providers
tasks-empty tasks-loading tasks-error keyboard i18n system"

jobs() {
  for s in $DESKTOP; do for t in light dark; do echo "$s $t 1440 900 screen=$s&theme=$t $s-$t"; done; done
  for t in light dark; do
    echo "tablet-tasks $t 1024 768 screen=tablet-tasks&theme=$t tablet-tasks-$t"
    for p in phone-inbox phone-task phone-ob; do echo "$p $t 390 844 screen=$p&theme=$t $p-$t"; done
    for d in a b c; do echo "dir $t 1440 900 screen=tasks&theme=$t&dir=$d dir-$d-$t"; done
    echo "rtl $t 1440 900 screen=tasks&theme=$t&rtl=1 rtl-$t"
  done
}

shoot() {
  local w=$3 h=$4 q=$5 name=$6
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor="$SCALE" --window-size="$w,$h" --virtual-time-budget=3000 \
    --screenshot="$OUT/$name.png" "file://$SRC/screen.html?$q" >/dev/null 2>&1
  magick "$OUT/$name.png" -quality 82 "$OUT/$name.jpg" && rm -f "$OUT/$name.png"
}
export -f shoot
export CHROME SCALE OUT SRC

if [ $# -gt 0 ]; then
  jobs | grep -E "$1" | xargs -P 3 -L 1 bash -c 'shoot "$@"' _
else
  jobs | xargs -P 3 -L 1 bash -c 'shoot "$@"' _
fi
ls "$OUT" | wc -l
du -sh "$OUT" | cut -f1
