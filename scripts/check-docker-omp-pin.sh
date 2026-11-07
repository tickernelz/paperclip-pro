#!/usr/bin/env bash
set -euo pipefail

dockerfile="${1:-Dockerfile}"
image="${2:-paperclip-omp-pin:check}"

pin="$(sed -n 's/^ARG OMP_VERSION=//p' "$dockerfile" | head -n 1)"
if [ -z "$pin" ]; then
  echo "No global ARG OMP_VERSION=<version> in $dockerfile" >&2
  exit 1
fi
grep -qx 'COPY --from=omp /opt/omp/bin/omp /usr/local/bin/omp' "$dockerfile" \
  || { echo "The production stage must copy /opt/omp/bin/omp from the omp stage" >&2; exit 1; }
grep -q 'PAPERCLIP_OMP_BUNDLED_VERSION=${OMP_VERSION}' "$dockerfile" \
  || { echo "The production stage must set PAPERCLIP_OMP_BUNDLED_VERSION=\${OMP_VERSION}" >&2; exit 1; }

docker build --target omp --tag "$image" --file "$dockerfile" .
actual="$(docker run --rm --entrypoint /opt/omp/bin/omp "$image" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
if [ "$actual" != "$pin" ]; then
  echo "OMP in the image is $actual, the pin is $pin" >&2
  exit 1
fi
echo "OMP in the image matches the pin: $pin"
