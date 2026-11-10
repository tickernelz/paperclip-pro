#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wardmote-upgrade-path.XXXXXX")"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export HOME="$ROOT/home"
export npm_config_cache="$ROOT/npm-cache"
phase_started=$SECONDS
phase() {
  echo "==> $1 (elapsed $((SECONDS - phase_started))s)"
  phase_started=$SECONDS
}
if [ -n "${UPGRADE_PNPM_STORE:-}" ]; then
  export npm_config_store_dir="$UPGRADE_PNPM_STORE"
fi
export npm_config_userconfig="$HOME/.npmrc"
export PATH="$HOME/.local/bin:$PATH"
unset WARDMOTE_HOME
REPO="${UPGRADE_REPO:?UPGRADE_REPO is required}"
SHA="${UPGRADE_SHA:?UPGRADE_SHA is required}"
PORT="${UPGRADE_PORT:-3197}"
OMP_STUB_VERSION="${UPGRADE_OMP_VERSION:-18.18.0}"
mkdir -p "$HOME/.paperclip-pro" "$HOME/.local/bin"
printf '#!/bin/sh\necho "omp/%s"\n' "$OMP_STUB_VERSION" > "$HOME/.local/bin/omp"
chmod +x "$HOME/.local/bin/omp"
server_pid=""

stop_server() {
  [ -n "$server_pid" ] || return 0
  kill -TERM -- "-$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  server_pid=""
  local pid_file postgres_pid
  for pid_file in "$HOME/.$LEGACY_COMMAND"/instances/*/db/postmaster.pid "$HOME"/.wardmote/instances/*/db/postmaster.pid; do
    [ -f "$pid_file" ] || continue
    postgres_pid="$(head -n 1 "$pid_file")"
    for _ in $(seq 1 60); do
      kill -0 "$postgres_pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$postgres_pid" 2>/dev/null; then
      echo "embedded PostgreSQL (pid $postgres_pid) still running 60s after the server stopped" >&2
      return 1
    fi
  done
}
cleanup() {
  stop_server
  [ "${CI:-}" = true ] || rm -rf "$ROOT"
}
trap cleanup EXIT

start_server() {
  local label="$1"
  shift
  PORT="$PORT" setsid "$@" >"$ROOT/$label.log" 2>&1 &
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

LEGACY_PACKAGE="@tickernelz/paperclip-pro"
LEGACY_COMMAND="paperclip-pro"
OLD_VERSION="$(npm view "$LEGACY_PACKAGE" version)"
phase "start"
echo "==> Installing the published release $LEGACY_PACKAGE@$OLD_VERSION the way an existing user has it"
npm install --prefix "$ROOT/bootstrap" "$LEGACY_PACKAGE@$OLD_VERSION" --no-audit --no-fund >/dev/null
"$ROOT/bootstrap/node_modules/.bin/paperclip-pro" install --version "$OLD_VERSION" --yes
paperclip-pro --version
start_server before paperclip-pro onboard --yes
test -d "$HOME/.paperclip-pro/instances/default"
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"name":"Upgrade path marker"}' "http://127.0.0.1:$PORT/api/companies" >/dev/null
stop_server

phase "published release installed and health-checked"
echo "==> Upgrading to $REPO@$SHA with this commit's @tickernelz/wardmote CLI, as npx @tickernelz/wardmote install does"
(cd "$REPO_ROOT" && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts install --repo "$REPO" --ref "$SHA" --yes)
wardmote --version
test -d "$HOME/.wardmote/instances/default"
test -L "$HOME/.paperclip-pro"
test ! -e "$HOME/.local/bin/$LEGACY_COMMAND"
grep -q '^# wardmote managed install shim v1$' "$HOME/.local/bin/wardmote"

start_server after wardmote run
curl -fsS "http://127.0.0.1:$PORT/api/companies" | grep -q '"Upgrade path marker"'
echo "after upgrade: home moved to ~/.wardmote, marker company still listed"
stop_server

phase "source install to this commit done and served"
echo "==> Re-running install through the migrated wardmote shim"
wardmote install --repo "$REPO" --ref "$SHA" --yes
wardmote --version
test -L "$HOME/.paperclip-pro"
echo "upgrade path ok: $OLD_VERSION -> $SHA"
