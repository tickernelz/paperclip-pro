#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${0}")/.." && pwd)"
. "${REPO_ROOT}/scripts/release-lib.sh"
CLI_DIR="${REPO_ROOT}/cli"
CLI_PACKAGE="@tickernelz/paperclip-pro"
PUBLISH_TAG="next"
PROMOTE_TAG="latest"
PACK_CONCURRENCY="${PACK_CONCURRENCY:-4}"
PACK_DIR=""

dry_run=false
skip_build=false
print_version_only=false
version=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release.sh [--version YYYY.MDD.P] [--dry-run] [--skip-build] [--print-version]

Publishes every @tickernelz/paperclip-pro package at one calendar version, in
dependency order, under the "next" dist-tag, then moves "latest" onto that
version once npm exposes the whole set, tags the release commit and opens a
GitHub release with notes generated since the previous v* tag.

Each package is packed exactly once into a tarball and that tarball is what
gets published, so no publish step repacks the workspace.

The run is idempotent: a package whose version is already on npm is skipped, a
dist-tag already pointing at the version is left alone, and an existing tag or
GitHub release is not recreated. Rerunning after a partial failure finishes the
set.

Options:
  --version        Release version. Empty resolves the UTC date slot YYYY.MDD
                   plus the next patch not yet published for the CLI package.
  --dry-run        Preview every step, contacting npm only for read-only checks.
  --skip-build     Reuse the current workspace build output.
  --print-version  Print the resolved version and exit.

Auth:
  NODE_AUTH_TOKEN, when set, authenticates npm through a temporary userconfig.
  Left empty, npm publish falls back to GitHub Actions OIDC trusted publishing;
  npm dist-tag add is not covered by OIDC and needs the token.
EOF
}

while [ $# -gt 0 ]; do
  if [ "$1" = "--version" ]; then
    shift
    [ $# -gt 0 ] || release_fail "--version requires a value."
    version="$1"
  elif [ "$1" = "--dry-run" ]; then
    dry_run=true
  elif [ "$1" = "--skip-build" ]; then
    skip_build=true
  elif [ "$1" = "--print-version" ]; then
    print_version_only=true
  elif [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
  else
    release_fail "unexpected argument: $1"
  fi
  shift
done

if [ -z "$version" ]; then
  version="$(next_stable_version "$(utc_date_iso)" "${CLI_PACKAGE}")"
fi

if ! printf '%s' "$version" | grep -Eq '^[0-9]{4}\.[0-9]{3,4}\.[0-9]+$'; then
  release_fail "version '$version' is not a YYYY.MDD.P calendar version."
fi

if [ "$print_version_only" = true ]; then
  printf '%s\n' "$version"
  exit 0
fi

restore_publish_artifacts() {
  if [ -f "${CLI_DIR}/package.dev.json" ]; then
    mv "${CLI_DIR}/package.dev.json" "${CLI_DIR}/package.json"
  fi

  rm -f "${CLI_DIR}/README.md"
  rm -rf "${REPO_ROOT}/server/ui-dist"

  for pkg_dir in server packages/adapters/claude-local packages/adapters/codex-local; do
    rm -rf "${REPO_ROOT}/$pkg_dir/skills"
  done
}

cleanup_release_state() {
  restore_publish_artifacts
  git -C "${REPO_ROOT}" checkout -q -- . || true

  if [ -n "${PACK_DIR:-}" ]; then
    rm -rf "$PACK_DIR"
  fi

  if [ -n "${NPM_USERCONFIG_FILE:-}" ]; then
    rm -f "$NPM_USERCONFIG_FILE"
  fi
}

configure_npm_auth() {
  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    release_info "  Auth: npm OIDC trusted publishing (no token in the environment)"
    return
  fi

  NPM_USERCONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/paperclip-npmrc.XXXXXX")"
  printf '//registry.npmjs.org/:_authToken=%s\n' "$NODE_AUTH_TOKEN" > "$NPM_USERCONFIG_FILE"
  chmod 600 "$NPM_USERCONFIG_FILE"
  export NPM_CONFIG_USERCONFIG="$NPM_USERCONFIG_FILE"
  release_info "  Auth: npm registry token from NODE_AUTH_TOKEN"
}

assert_no_workspace_specs() {
  local manifest_path="$1"
  local package_name="$2"
  local leaked

  leaked="$(node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const leaks = [];
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
      for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
        if (typeof spec === "string" && spec.startsWith("workspace:")) leaks.push(section + ":" + name + "@" + spec);
      }
    }
    process.stdout.write(leaks.join(" "));
  ' "$manifest_path")"

  if [ -n "$leaked" ]; then
    release_fail "$package_name would publish unresolved workspace specs: $leaked"
  fi
}

release_npm() {
  if [ -z "${RELEASE_NPM_CLI:-}" ]; then
    if node -e 'const v=process.argv[1].split(".").map(Number);process.exit(v[0]>11||(v[0]===11&&(v[1]>5||(v[1]===5&&v[2]>=1)))?0:1)' "$(npm --version)"; then
      RELEASE_NPM_CLI="local"
    else
      RELEASE_NPM_CLI="pinned"
    fi
    export RELEASE_NPM_CLI
  fi

  if [ "$RELEASE_NPM_CLI" = "local" ]; then
    npm "$@"
  else
    npx --yes "npm@$BUNDLED_NPM_PUBLISH_VERSION" "$@"
  fi
}

pack_dest_dir() {
  printf '%s/tarballs/%s\n' "$PACK_DIR" "${1//\//_}"
}

pack_one_package() {
  local pkg_dir="$1"
  local pkg_name="$2"
  local publish_tool work_dir staged_dir dest_dir

  cd "${REPO_ROOT}/$pkg_dir"
  publish_tool="$(package_publish_tool)"
  work_dir="${REPO_ROOT}/$pkg_dir"
  dest_dir="$(pack_dest_dir "$pkg_dir")"
  mkdir -p "$dest_dir"

  if [ "$publish_tool" = "npm" ]; then
    staged_dir="$PACK_DIR/staged/${pkg_dir//\//_}"
    mkdir -p "$staged_dir"
    node "${REPO_ROOT}/scripts/prepare-bundled-package.mjs" "${REPO_ROOT}/$pkg_dir" "$staged_dir"
    work_dir="$staged_dir"
  fi

  assert_no_workspace_specs "$work_dir/package.json" "$pkg_name"
  cd "$work_dir"

  if [ "$publish_tool" = "npm" ]; then
    release_npm pack --pack-destination "$dest_dir" --ignore-scripts >/dev/null
  else
    pnpm pack --pack-destination "$dest_dir" >/dev/null
  fi

  cd "${REPO_ROOT}"
}

publish_one_tarball() {
  local pkg_name="$1"
  local pkg_version="$2"
  local tarball="$3"
  local status=0

  if npm_package_version_exists "$pkg_name" "$pkg_version"; then
    release_info "    already on npm, skipping publish"
    return 0
  fi

  if [ "$dry_run" = true ]; then
    release_npm publish "$tarball" --dry-run --tag "$PUBLISH_TAG" --access public || status=$?
  else
    release_npm publish "$tarball" --tag "$PUBLISH_TAG" --access public --provenance || status=$?
  fi

  if [ "$status" -ne 0 ]; then
    release_fail "npm rejected ${pkg_name}@${pkg_version}."
  fi
}

promote_to_latest() {
  local package_info="$1"
  local pkg_name pkg_version current

  while IFS=$'\t' read -r _pkg_dir pkg_name pkg_version; do
    [ -z "$pkg_name" ] && continue

    current="$(npm view "$pkg_name" "dist-tags.${PROMOTE_TAG}" 2>/dev/null || true)"
    if [ "$current" = "$pkg_version" ]; then
      release_info "  ${pkg_name}: ${PROMOTE_TAG} already at ${pkg_version}"
      continue
    fi

    if [ "$dry_run" = true ]; then
      release_info "  [dry-run] npm dist-tag add ${pkg_name}@${pkg_version} ${PROMOTE_TAG}"
      continue
    fi

    if ! npm dist-tag add "${pkg_name}@${pkg_version}" "$PROMOTE_TAG"; then
      if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
        release_fail "npm dist-tag add failed for ${pkg_name}; OIDC trusted publishing does not authenticate dist-tag changes, so this step needs NODE_AUTH_TOKEN."
      fi
      release_fail "npm dist-tag add failed for ${pkg_name}@${pkg_version}."
    fi
    release_info "  ${pkg_name}: ${PROMOTE_TAG} -> ${pkg_version}"
  done <<< "$package_info"
}

publish_github_release() {
  local tag="v$version"
  local remote previous_tag github_repo

  remote="$(resolve_release_remote)"
  github_repo="$(github_repo_from_remote "$remote" || true)"
  [ -n "$github_repo" ] || release_fail "could not determine the GitHub repository from remote $remote."
  previous_tag="$(git -C "${REPO_ROOT}" tag --list 'v*' --sort=-version:refname | head -1)"

  if [ "$dry_run" = true ]; then
    release_info "  [dry-run] git tag $tag $RELEASE_COMMIT && git push $remote refs/tags/$tag"
    release_info "  [dry-run] gh release create $tag -R $github_repo --generate-notes (notes start tag: ${previous_tag:-<none>})"
    return
  fi

  if git_local_tag_exists "$tag" || git_remote_tag_exists "$tag" "$remote"; then
    release_info "  git tag $tag already exists, leaving it in place"
  else
    git -C "${REPO_ROOT}" tag "$tag" "$RELEASE_COMMIT"
    git -C "${REPO_ROOT}" push "$remote" "refs/tags/$tag"
    release_info "  Tagged $RELEASE_COMMIT as $tag"
  fi

  command -v gh >/dev/null 2>&1 || release_fail "gh CLI is required to create the GitHub release."

  if gh release view "$tag" -R "$github_repo" >/dev/null 2>&1; then
    release_info "  GitHub release $tag already exists, leaving it in place"
    return
  fi

  if [ -n "$previous_tag" ] && [ "$previous_tag" != "$tag" ]; then
    gh release create "$tag" -R "$github_repo" --title "$tag" --generate-notes --notes-start-tag "$previous_tag"
  else
    gh release create "$tag" -R "$github_repo" --title "$tag" --generate-notes
  fi
  release_info "  Created GitHub release $tag"
}

RELEASE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"

require_clean_worktree
configure_npm_auth

release_info ""
release_info "==> Release plan"
release_info "  Commit: $RELEASE_COMMIT"
release_info "  Version: $version"
release_info "  Publish dist-tag: $PUBLISH_TAG, promoted to $PROMOTE_TAG"
if [ "$dry_run" = true ]; then
  release_info "  Mode: dry run"
else
  release_info "  Mode: publish"
fi

trap cleanup_release_state EXIT
PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-release-tarballs.XXXXXX")"

export PAPERCLIP_RELEASE_REUSE_UI_DIST=1

release_info ""
if [ "$skip_build" = false ]; then
  release_info "==> Step 1/6: Building workspace artifacts..."
  cd "${REPO_ROOT}"
  pnpm build
  node "${REPO_ROOT}/scripts/build-standalone-public-packages.mjs"
else
  release_info "==> Step 1/6: Reusing the existing workspace build (--skip-build)"
fi

bash "${REPO_ROOT}/scripts/prepare-release-package-assets.sh"

release_info ""
release_info "==> Step 2/6: Rewriting workspace versions to $version..."
set_public_package_version "$version"

release_info ""
release_info "==> Step 3/6: Building the publishable CLI bundle..."
"${REPO_ROOT}/scripts/build-npm.sh" --skip-checks --skip-typecheck

PACKAGE_INFO="$(list_public_package_info)"
[ -n "$PACKAGE_INFO" ] || release_fail "no publishable packages were found."

CLI_PACKAGE_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "${CLI_DIR}/package.json")"
if [ "$CLI_PACKAGE_VERSION" != "$version" ]; then
  release_fail "versioning drift: expected $version but cli/package.json holds $CLI_PACKAGE_VERSION."
fi

release_info ""
release_info "==> Step 4/6: Packing every package once..."
mkdir -p "$PACK_DIR/logs"
pack_pids=()
pack_dirs=()
pack_failed=false

await_pack_batch() {
  local pid
  if [ "${#pack_pids[@]}" -eq 0 ]; then
    return 0
  fi
  for pid in "${pack_pids[@]}"; do
    if ! wait "$pid"; then
      pack_failed=true
    fi
  done
  pack_pids=()
}

while IFS=$'\t' read -r pkg_dir pkg_name pkg_version; do
  [ -z "$pkg_dir" ] && continue
  pack_dirs+=("$pkg_dir")
  pack_one_package "$pkg_dir" "$pkg_name" > "$PACK_DIR/logs/${pkg_dir//\//_}.log" 2>&1 &
  pack_pids+=($!)
  if [ "$(( ${#pack_pids[@]} % PACK_CONCURRENCY ))" -eq 0 ]; then
    await_pack_batch
  fi
done <<< "$PACKAGE_INFO"
await_pack_batch

if [ "$pack_failed" = true ]; then
  for pkg_dir in "${pack_dirs[@]}"; do
    release_info "  --- pack log: $pkg_dir ---"
    tail -20 "$PACK_DIR/logs/${pkg_dir//\//_}.log" || true
  done
  release_fail "packing failed for at least one package."
fi

while IFS=$'\t' read -r pkg_dir pkg_name pkg_version; do
  [ -z "$pkg_dir" ] && continue
  tarball="$(ls "$(pack_dest_dir "$pkg_dir")"/*.tgz 2>/dev/null | head -1)"
  [ -n "$tarball" ] || release_fail "packing $pkg_name produced no tarball."
  release_info "  packed ${pkg_name}@${pkg_version} -> ${tarball##*/}"
done <<< "$PACKAGE_INFO"

release_info ""
release_info "==> Step 5/6: Publishing the packed tarballs under dist-tag $PUBLISH_TAG..."
while IFS=$'\t' read -r pkg_dir pkg_name pkg_version; do
  [ -z "$pkg_dir" ] && continue
  release_info ""
  release_info "  --- ${pkg_name}@${pkg_version} ($pkg_dir) ---"
  publish_one_tarball "$pkg_name" "$pkg_version" "$(ls "$(pack_dest_dir "$pkg_dir")"/*.tgz | head -1)"
done <<< "$PACKAGE_INFO"

release_info ""
if [ "$dry_run" = true ]; then
  release_info "==> Step 6/6: Registry visibility wait skipped (dry run); previewing ${PROMOTE_TAG} promotion and the GitHub release"
  promote_to_latest "$PACKAGE_INFO"
else
  release_info "==> Step 6/6: Waiting for registry visibility, moving ${PROMOTE_TAG}, then tagging..."
  if ! wait_for_npm_package_versions \
    "${NPM_PUBLISH_VERIFY_ATTEMPTS:-12}" \
    "${NPM_PUBLISH_VERIFY_DELAY_SECONDS:-5}" \
    "$PACKAGE_INFO"; then
    release_fail "npm did not expose every published version; rerun to finish the set."
  fi
  promote_to_latest "$PACKAGE_INFO"
fi

publish_github_release

release_info ""
if [ "$dry_run" = true ]; then
  release_info "Dry run complete for $version."
else
  release_info "Released $version."
fi
