#!/usr/bin/env bash
set -euo pipefail
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
OUT="$(cd "$(dirname "$0")/.." && pwd)/measurements/merge.json"
BASE=${BASE:-$(git -C "$REPO" rev-parse HEAD)}
UP=${UP:-upstream/master}
ROOT=$(dirname "$REPO")
WU="$ROOT/paperclip-pro-zha5100-up"
WF="$ROOT/paperclip-pro-zha5100-fork"
RENAME="$REPO/scripts/fork/rename-to-paperclip-pro.mjs"
ADAPTERS="claude-local codex-local cursor-cloud cursor-local gemini-local grok-local hermes hermes-gateway kimi-local openclaw-gateway opencode-local pi-local"
EXCL=(":!docs/design/rebrand-v1" ":!doc/upstream-sync" ":!pnpm-lock.yaml" ":!releases" ":!screenshots" ":!report")

cleanup() {
  git -C "$REPO" worktree remove --force "$WU" 2>/dev/null || true
  git -C "$REPO" worktree remove --force "$WF" 2>/dev/null || true
  for b in zha5100/sim-up zha5100/sim-up2 zha5100/sim-fork; do git -C "$REPO" branch -D "$b" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT
cleanup

conflicts() { git -C "$REPO" merge-tree --write-tree --name-only --no-messages "$1" "$2" | tail -n +2 | grep -c . || true; }
commit() { git -C "$1" add -A >/dev/null; git -c gc.auto=0 -C "$1" commit -qm "$2" --no-verify; git -C "$1" rev-parse HEAD; }
subst() {
  local dir=$1 pat=$2 expr=$3; shift 3
  (cd "$dir" && git grep -lIP "$pat" -- "$@" "${EXCL[@]}" | xargs -r sed -i -E "$expr")
}
stage1() {
  subst "$1" 'paperclip-pro' 's/paperclip-pro/wardmote/g' .
  subst "$1" '\bPaperclip\b' 's/\bPaperclip\b/Wardmote/g' ui/src cli/src
}
stage2() {
  subst "$1" 'PAPERCLIP_' 's/PAPERCLIP_/WARDMOTE_/g' .
  subst "$1" '\bpaperclip[A-Z]' 's/\bpaperclip([A-Z])/wardmote\1/g' .
}
drop_adapters() { (cd "$1/packages/adapters" && git rm -rq $ADAPTERS); }

git -C "$REPO" worktree add -q -b zha5100/sim-up "$WU" "$UP"
mkdir -p "$WU/scripts/fork"
cp "$RENAME" "$WU/scripts/fork/rename-to-paperclip-pro.mjs"
(cd "$WU" && node scripts/fork/rename-to-paperclip-pro.mjs >/dev/null && rm -r scripts/fork)
UPR=$(commit "$WU" "sim: upstream renamed with the current fork rule set")

git -C "$REPO" worktree add -q -b zha5100/sim-fork "$WF" "$BASE"
raw=$(conflicts "$BASE" "$UP")
now=$(conflicts "$BASE" "$UPR")
stage1 "$WF"; F1=$(commit "$WF" "sim: stage 1 rename")
s1_old=$(conflicts "$F1" "$UPR")

git -C "$WU" checkout -q -b zha5100/sim-up2
stage1 "$WU"; UP1=$(commit "$WU" "sim: upstream with stage 1 rules")
s1=$(conflicts "$F1" "$UP1")

drop_adapters "$WF"; F2=$(commit "$WF" "sim: drop 12 adapters")
s1_drop=$(conflicts "$F2" "$UP1")
adre=$(echo $ADAPTERS | sed "s/ /|/g")
s1_drop_adapters=$(git -C "$REPO" merge-tree --write-tree --name-only --no-messages "$F2" "$UP1" | tail -n +2 | grep -cE "^packages/adapters/($adre)/" || true)

stage2 "$WF"; F3=$(commit "$WF" "sim: stage 2 rename")
stage2 "$WU"; UP2=$(commit "$WU" "sim: upstream with stage 2 rules")
s2_drop=$(conflicts "$F3" "$UP2")

git -C "$REPO" merge-tree --write-tree --name-only --no-messages "$F3" "$UP2" | tail -n +2 | awk -F/ '{print ($1=="packages"&&NF>2)?$1"/"$2"/"$3:$1}' | sort | uniq -c | sort -rn | sed -n 1,15p > "$OUT.areas" || true
mb=$(git -C "$REPO" merge-base "$BASE" "$UP")
cat > "$OUT" <<JSON
{
 "base": "$BASE",
 "upstream": "$(git -C "$REPO" rev-parse "$UP")",
 "mergeBase": "$mb",
 "upstreamAhead": $(git -C "$REPO" rev-list --count "$mb..$UP"),
 "forkAhead": $(git -C "$REPO" rev-list --count "$mb..$BASE"),
 "rawNoRename": $raw,
 "currentMethod": $now,
 "stage1RulesNotExtended": $s1_old,
 "stage1RulesExtended": $s1,
 "stage1PlusDropAdapters": $s1_drop,
 "stage1PlusDropAdaptersInRemovedDirs": $s1_drop_adapters,
 "upstreamSecurityCommits": $(git -C "$REPO" log --oneline -i -E --grep="security|cve|vuln|xss|ssrf|csrf|injection|traversal|sanitiz|escap|auth bypass" "$mb..$UP" | wc -l),
 "upstreamDays": $(( ( $(git -C "$REPO" log -1 --format=%ct "$UP") - $(git -C "$REPO" log -1 --format=%ct "$mb") ) / 86400 )),
 "stage2PlusDropAdapters": $s2_drop
}
JSON
cat "$OUT"; cat "$OUT.areas"
