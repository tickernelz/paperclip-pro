#!/usr/bin/env bash
set -euo pipefail

config="$1"

if [ "${BROWSER_GATES_IMAGE_READY:-false}" = true ]; then
  exec docker run --rm --init --ipc=host \
    --user "$(id -u):$(id -g)" \
    --env CI --env HOME=/tmp \
    --volume "$PWD:$PWD" --workdir "$PWD" \
    "$BROWSER_GATES_IMAGE" pnpm exec playwright test --config "$config"
fi

exec pnpm exec playwright test --config "$config"
