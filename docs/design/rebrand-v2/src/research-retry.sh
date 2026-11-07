#!/usr/bin/env bash
cd "$(dirname "$0")/../research"
for pair in "raycast https://www.raycast.com/" "notion https://www.notion.com/" "github https://github.com/features/copilot" "stripe https://docs.stripe.com/" "cursor https://cursor.com/features" "zed https://zed.dev/" "attio https://attio.com/" "resend https://resend.com/" "tailscale https://tailscale.com/" "posthog https://posthog.com/" "sentry https://sentry.io/welcome/" "planetscale https://planetscale.com/"; do
  set -- $pair
  [ -s "$1.jpg" ] && continue
  nice -n 19 timeout 75 google-chrome --headless=new --disable-gpu --hide-scrollbars --disable-blink-features=AutomationControlled --window-size=1440,900 --virtual-time-budget=6000 --screenshot="$1.png" "$2" >/dev/null 2>&1
  if [ -s "$1.png" ]; then
    m=$(magick "$1.png" -format '%[fx:standard_deviation]' info:)
    if awk "BEGIN{exit !($m > 0.04)}"; then magick "$1.png" -resize 720x -quality 78 "$1.jpg"; fi
    rm -f "$1.png"
  fi
  echo "$1 $2 $([ -s "$1.jpg" ] && echo ok || echo fail)"
done
