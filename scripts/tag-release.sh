#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${0}")/.." && pwd)"
. "${REPO_ROOT}/scripts/release-lib.sh"

dry_run=false
version=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/tag-release.sh [--version YYYY.MDD.P] [--dry-run]

Tags origin/main HEAD as v<version> and pushes the tag, which is what triggers
the Release workflow. The commit must carry a successful ci.yml run.

Options:
  --version  Release version. Empty resolves the same slot the workflow would
             resolve through ./scripts/release.sh --print-version.
  --dry-run  Print the tag and push commands without running them.

Environment:
  RELEASE_CI_POLL_ATTEMPTS  Checks before giving up on a running CI run
                            (default 1 here, so a running CI fails fast).
EOF
}

while [ $# -gt 0 ]; do
  if [ "$1" = "--version" ]; then
    shift
    [ $# -gt 0 ] || release_fail "--version requires a value."
    version="$1"
  elif [ "$1" = "--dry-run" ]; then
    dry_run=true
  elif [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
  else
    release_fail "unexpected argument: $1"
  fi
  shift
done

command -v gh >/dev/null 2>&1 || release_fail "gh CLI is required to check CI before tagging."

remote="$(resolve_release_remote)"
github_repo="$(github_repo_from_remote "$remote" || true)"
[ -n "$github_repo" ] || release_fail "could not determine the GitHub repository from remote $remote."

fetch_release_remote "$remote"

main_sha="$(git -C "$REPO_ROOT" rev-parse "${remote}/main")"

if [ -z "$version" ]; then
  version="$("${REPO_ROOT}/scripts/release.sh" --print-version)"
fi

tag="$(RELEASE_MAIN_REF="${remote}/main" "${REPO_ROOT}/scripts/release-tag-gate.sh" version-from-tag "v${version}")"
tag="v${tag}"

if git_local_tag_exists "$tag" || git_remote_tag_exists "$tag" "$remote"; then
  release_fail "tag $tag already exists; pick another version."
fi

release_info "==> Tag plan"
release_info "  Repository: $github_repo"
release_info "  Commit: $main_sha (${remote}/main)"
release_info "  Tag: $tag"

RELEASE_CI_POLL_ATTEMPTS="${RELEASE_CI_POLL_ATTEMPTS:-1}" \
  "${REPO_ROOT}/scripts/release-tag-gate.sh" require-green-ci "$github_repo" "$main_sha"

if [ "$dry_run" = true ]; then
  release_info "  [dry-run] git tag -a $tag $main_sha -m \"Release $tag\""
  release_info "  [dry-run] git push $remote refs/tags/$tag"
  exit 0
fi

git -C "$REPO_ROOT" tag -a "$tag" "$main_sha" -m "Release $tag"
git -C "$REPO_ROOT" push "$remote" "refs/tags/$tag"
release_info "  Pushed $tag; the Release workflow takes over from here."
