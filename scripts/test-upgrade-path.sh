#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wardmote-upgrade-path.XXXXXX")"
export HOME="$ROOT/home"
export npm_config_cache="$ROOT/npm-cache"
export npm_config_userconfig="$HOME/.npmrc"
OMP_PIN="$(sed -n 's/^ARG OMP_VERSION=//p' "$(dirname "$0")/../Dockerfile" | head -n 1)"
mkdir -p "$ROOT/omp-bin"
printf '#!/bin/sh\necho "omp/%s"\n' "${OMP_PIN:?Dockerfile has no ARG OMP_VERSION}" >"$ROOT/omp-bin/omp"
chmod +x "$ROOT/omp-bin/omp"
export PATH="$HOME/.local/bin:$ROOT/omp-bin:$PATH"
unset PAPERCLIP_HOME WARDMOTE_HOME
REPO="${UPGRADE_REPO:?UPGRADE_REPO is required}"
SHA="${UPGRADE_SHA:?UPGRADE_SHA is required}"
PORT="${UPGRADE_PORT:-3197}"
mkdir -p "$HOME"
server_pid=""

stop_server() {
  [ -n "$server_pid" ] || return 0
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
}
trap 'stop_server; rm -rf "$ROOT"' EXIT

start_server() {
  local label="$1"
  shift
  PORT="$PORT" "$@" >"$ROOT/$label.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >"$ROOT/$label-health.json" 2>/dev/null; then
      echo "$label health: $(cat "$ROOT/$label-health.json")"
      return 0
    fi
    sleep 2
  done
  tail -n 80 "$ROOT/$label.log"
  return 1
}

OLD_VERSION="$(npm view @tickernelz/paperclip-pro version)"
echo "==> Installing the published release $OLD_VERSION the way an existing user has it"
npm install --prefix "$ROOT/bootstrap" "@tickernelz/paperclip-pro@$OLD_VERSION" --no-audit --no-fund >/dev/null
"$ROOT/bootstrap/node_modules/.bin/paperclip-pro" install --version "$OLD_VERSION" --yes
paperclip-pro --version
start_server before paperclip-pro onboard --yes
if [ -d "$HOME/.paperclip-pro" ]; then OLD_HOME="$HOME/.paperclip-pro"; else OLD_HOME="$HOME/.wardmote"; fi

only_old_home() {
  test -d "$OLD_HOME/instances/default"
  for home in "$HOME/.paperclip-pro" "$HOME/.wardmote"; do
    [ "$home" = "$OLD_HOME" ] || test ! -e "$home"
  done
}

only_old_home
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"name":"Upgrade path marker"}' "http://127.0.0.1:$PORT/api/companies" >/dev/null
stop_server

echo "==> Upgrading with the old CLI to $REPO@$SHA"
paperclip-pro install --repo "$REPO" --ref "$SHA" --yes
paperclip-pro --version
"$OLD_HOME/cli/current/node_modules/.bin/wardmote" --version
only_old_home

start_server after paperclip-pro run
curl -fsS "http://127.0.0.1:$PORT/api/companies" | grep -q '"Upgrade path marker"'
echo "after upgrade: $(basename "$OLD_HOME") home kept, marker company still listed"
stop_server

echo "==> Re-running install with the new CLI writes the wardmote shim"
paperclip-pro install --repo "$REPO" --ref "$SHA" --yes
wardmote --version
only_old_home
echo "upgrade path ok: $OLD_VERSION -> $SHA"
