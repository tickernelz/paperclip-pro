#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${0}")/.." && pwd)"
. "${REPO_ROOT}/scripts/release-lib.sh"

CI_WORKFLOW_FILE="${RELEASE_CI_WORKFLOW_FILE:-ci.yml}"
CI_POLL_ATTEMPTS="${RELEASE_CI_POLL_ATTEMPTS:-60}"
CI_POLL_DELAY_SECONDS="${RELEASE_CI_POLL_DELAY_SECONDS:-30}"
MAIN_REF="${RELEASE_MAIN_REF:-origin/main}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-tag-gate.sh version-from-tag <tag>
  ./scripts/release-tag-gate.sh require-main-ancestor <sha>
  ./scripts/release-tag-gate.sh require-green-ci <repo> <sha>
  ./scripts/release-tag-gate.sh resolve

Guards that turn a pushed v* tag into a publishable release.

version-from-tag      Strips the leading "v" and enforces YYYY.MDD.P.
require-main-ancestor Fails unless the commit is reachable from origin/main.
require-green-ci      Fails unless ci.yml completed successfully for the exact
                      commit. A queued or running workflow is polled until
                      RELEASE_CI_POLL_ATTEMPTS x RELEASE_CI_POLL_DELAY_SECONDS
                      elapses; a completed non-success fails immediately.
resolve               Prints version, dry-run and auth as GITHUB_OUTPUT lines,
                      reading the tag on a push and the inputs on a dispatch.
EOF
}

version_from_tag() {
  local tag="$1" version

  case "$tag" in
    v*) version="${tag#v}" ;;
    *) release_fail "release tag '$tag' must start with 'v'." ;;
  esac

  if ! printf '%s' "$version" | grep -Eq '^[0-9]{4}\.[0-9]{3,4}\.[0-9]+$'; then
    release_fail "release tag '$tag' does not carry a YYYY.MDD.P calendar version."
  fi

  printf '%s\n' "$version"
}

require_main_ancestor() {
  local sha="$1"

  git -C "$REPO_ROOT" rev-parse --verify --quiet "${MAIN_REF}^{commit}" >/dev/null ||
    release_fail "$MAIN_REF is missing; check out with fetch-depth 0 before gating a tag."

  git -C "$REPO_ROOT" merge-base --is-ancestor "$sha" "$MAIN_REF" ||
    release_fail "commit $sha is not reachable from $MAIN_REF; only tags on main are releasable."

  release_info "  $sha is reachable from $MAIN_REF"
}

require_green_ci() {
  local repo="$1" sha="$2" attempt=1 states status conclusion pending

  while :; do
    states="$(gh api "repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs?head_sha=${sha}&per_page=100" \
      --jq '.workflow_runs[] | "\(.status) \(.conclusion)"' 2>/dev/null || true)"

    pending=false
    while read -r status conclusion; do
      [ -n "$status" ] || continue
      if [ "$status" = "completed" ]; then
        if [ "$conclusion" = "success" ]; then
          release_info "  ${CI_WORKFLOW_FILE} succeeded for $sha"
          return 0
        fi
      else
        pending=true
      fi
    done <<< "$states"

    if [ "$pending" = false ] && [ -n "$states" ]; then
      release_fail "${CI_WORKFLOW_FILE} did not succeed for $sha; no publish without green CI."
    fi

    if [ "$attempt" -ge "$CI_POLL_ATTEMPTS" ]; then
      if [ -z "$states" ]; then
        release_fail "no ${CI_WORKFLOW_FILE} run exists for $sha; no publish without green CI."
      fi
      release_fail "${CI_WORKFLOW_FILE} was still running for $sha after $attempt checks; no publish without green CI."
    fi

    release_info "  waiting for ${CI_WORKFLOW_FILE} on $sha (check $attempt/$CI_POLL_ATTEMPTS)"
    attempt=$((attempt + 1))
    sleep "$CI_POLL_DELAY_SECONDS"
  done
}

resolve() {
  local event="${EVENT_NAME:-}" version dry_run auth

  if [ "$event" = "push" ]; then
    version="$(version_from_tag "${TAG_NAME:-}")"
    dry_run=false
    auth=token
  else
    version="${INPUT_VERSION:-}"
    dry_run="${INPUT_DRY_RUN:-false}"
    auth="${INPUT_AUTH:-token}"
    [ "$dry_run" = "true" ] || dry_run=false
    [ "$auth" = "oidc" ] || auth=token
  fi

  printf 'version=%s\n' "$version"
  printf 'dry_run=%s\n' "$dry_run"
  printf 'auth=%s\n' "$auth"
}

command="${1:-}"
[ $# -gt 0 ] && shift || true

case "$command" in
  version-from-tag)
    [ $# -eq 1 ] || release_fail "version-from-tag requires a tag name."
    version_from_tag "$1"
    ;;
  require-main-ancestor)
    [ $# -eq 1 ] || release_fail "require-main-ancestor requires a commit sha."
    require_main_ancestor "$1"
    ;;
  require-green-ci)
    [ $# -eq 2 ] || release_fail "require-green-ci requires a repository and a commit sha."
    require_green_ci "$1" "$2"
    ;;
  resolve)
    resolve
    ;;
  -h | --help)
    usage
    ;;
  *)
    usage >&2
    release_fail "unknown command: ${command:-<none>}"
    ;;
esac
