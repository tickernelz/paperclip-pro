#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO_ROOT/scripts/release-lib.sh"
CLI_DIR="$REPO_ROOT/cli"

dry_run=true
skip_build=false
version=""
dist_tag="latest"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/release-fork.sh [--version YYYY.MDD.P] [--dist-tag TAG] [--publish] [--skip-build]

Publishes the @tickernelz/paperclip-pro* package set from this fork in
dependency order. Dry run is the default; --publish is required to contact npm.

Options:
  --version    Release version. Defaults to the UTC date as YYYY.MDD.0.
  --dist-tag   npm dist-tag for the publish. Defaults to latest.
  --publish    Publish for real instead of previewing with --dry-run.
  --skip-build Reuse an existing workspace build (local iteration only).

Auth:
  With NODE_AUTH_TOKEN set, the script writes a temporary npm userconfig that
  authenticates with that token. With NODE_AUTH_TOKEN unset or empty, npm falls
  back to GitHub Actions OIDC trusted publishing.
EOF
}

while [ $# -gt 0 ]; do
  if [ "$1" = "--version" ]; then
    shift
    [ $# -gt 0 ] || release_fail "--version requires a value."
    version="$1"
  elif [ "$1" = "--dist-tag" ]; then
    shift
    [ $# -gt 0 ] || release_fail "--dist-tag requires a value."
    dist_tag="$1"
  elif [ "$1" = "--publish" ]; then
    dry_run=false
  elif [ "$1" = "--dry-run" ]; then
    dry_run=true
  elif [ "$1" = "--skip-build" ]; then
    skip_build=true
  elif [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
  else
    release_fail "unexpected argument: $1"
  fi
  shift
done

if [ -z "$version" ]; then
  version="$(date -u '+%Y.%-m%d.0')"
fi

if ! printf '%s' "$version" | grep -Eq '^[0-9]{4}\.[0-9]{3,4}\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
  release_fail "version '$version' is not a YYYY.MDD.P calver."
fi

restore_publish_artifacts() {
  if [ -f "$CLI_DIR/package.dev.json" ]; then
    mv "$CLI_DIR/package.dev.json" "$CLI_DIR/package.json"
  fi

  rm -f "$CLI_DIR/README.md"
  rm -rf "$REPO_ROOT/server/ui-dist"

  for pkg_dir in server packages/adapters/claude-local packages/adapters/codex-local; do
    rm -rf "$REPO_ROOT/$pkg_dir/skills"
  done
}

cleanup_release_state() {
  restore_publish_artifacts

  git -C "$REPO_ROOT" checkout -q -- . || true

  if [ -n "${NPM_USERCONFIG_FILE:-}" ]; then
    rm -f "$NPM_USERCONFIG_FILE"
  fi
}

configure_npm_auth() {
  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    release_info "  Auth: npm OIDC trusted publishing (no token in the environment)"
    return
  fi

  NPM_USERCONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/paperclip-fork-npmrc.XXXXXX")"
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
    const sections = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
    const leaks = [];
    for (const section of sections) {
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

publish_one_package() {
  local pkg_dir="$1"
  local pkg_name="$2"
  local pkg_version="$3"
  local publish_tool work_dir publish_dir=""

  cd "$REPO_ROOT/$pkg_dir"
  publish_tool="$(package_publish_tool)"
  work_dir="$REPO_ROOT/$pkg_dir"

  if [ "$publish_tool" = "npm" ]; then
    publish_dir="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-release-package.XXXXXX")"
    node "$REPO_ROOT/scripts/prepare-bundled-package.mjs" "$REPO_ROOT/$pkg_dir" "$publish_dir"
    work_dir="$publish_dir"
  fi

  assert_no_workspace_specs "$work_dir/package.json" "$pkg_name"
  cd "$work_dir"

  local status=0
  if [ "$dry_run" = true ]; then
    if [ "$publish_tool" = "npm" ]; then
      run_bundled_npm_publish publish --dry-run --tag "$dist_tag" --access public || status=$?
    else
      pnpm publish --dry-run --no-git-checks --tag "$dist_tag" --access public || status=$?
    fi
  elif [ "$publish_tool" = "npm" ]; then
    run_bundled_npm_publish publish --tag "$dist_tag" --access public --provenance || status=$?
  else
    pnpm publish --no-git-checks --tag "$dist_tag" --access public --provenance || status=$?
  fi

  if [ -n "$publish_dir" ]; then
    rm -rf "$publish_dir"
  fi

  if [ "$status" -ne 0 ]; then
    release_fail "npm rejected ${pkg_name}@${pkg_version} (tool: $publish_tool, exit $status)"
  fi
}

require_clean_worktree
configure_npm_auth

release_info ""
release_info "==> Fork release plan"
release_info "  Repository: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO_ROOT" rev-parse HEAD)"
release_info "  Version: $version"
release_info "  Dist-tag: $dist_tag"
release_info "  Mode: $([ "$dry_run" = true ] && echo 'dry run' || echo 'publish')"

trap cleanup_release_state EXIT

export PAPERCLIP_RELEASE_REUSE_UI_DIST=1

if [ "$skip_build" = false ]; then
  release_info ""
  release_info "==> Step 1/4: Building workspace artifacts..."
  cd "$REPO_ROOT"
  pnpm build
  node "$REPO_ROOT/scripts/build-standalone-public-packages.mjs"
  bash "$REPO_ROOT/scripts/prepare-release-package-assets.sh"
else
  release_info ""
  release_info "==> Step 1/4: Reusing existing workspace build (--skip-build)"
fi

release_info ""
release_info "==> Step 2/4: Rewriting workspace versions to $version..."
set_public_package_version "$version"

release_info ""
release_info "==> Step 3/4: Building publishable CLI bundle..."
"$REPO_ROOT/scripts/build-npm.sh" --skip-checks --skip-typecheck

PACKAGE_INFO="$(list_public_package_info)"
[ -n "$PACKAGE_INFO" ] || release_fail "no publishable packages were found."

CLI_PACKAGE_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$CLI_DIR/package.json")"
if [ "$CLI_PACKAGE_VERSION" != "$version" ]; then
  release_fail "versioning drift: expected $version but cli/package.json holds $CLI_PACKAGE_VERSION."
fi

release_info ""
if [ "$dry_run" = true ]; then
  release_info "==> Step 4/4: Previewing publishes in dependency order (--dry-run)..."
else
  release_info "==> Step 4/4: Publishing in dependency order..."
fi

while IFS=$'\t' read -r pkg_dir pkg_name pkg_version; do
  [ -z "$pkg_dir" ] && continue
  release_info ""
  release_info "  --- ${pkg_name}@${pkg_version} ($pkg_dir) ---"
  publish_one_package "$pkg_dir" "$pkg_name" "$pkg_version"
done <<< "$PACKAGE_INFO"

release_info ""
if [ "$dry_run" = true ]; then
  release_info "Dry run complete for $version."
else
  release_info "Published $version under dist-tag $dist_tag."
fi
