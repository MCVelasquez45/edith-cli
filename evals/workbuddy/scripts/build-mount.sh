#!/bin/bash
# Build the EDITH split-mount image (workbuddy-bench/harness/edith:<version>).
# Re-packs the EDITH working tree first so the image always reflects it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EDITH_ROOT="$(cd "$EVAL_DIR/../.." && pwd)"
VENDOR="$EVAL_DIR/vendor/workbuddy-bench"

EDITH_VERSION="$(node -p "require('$EDITH_ROOT/package.json').version")"

SRC_TAR="$VENDOR/configs/harnesses/edith/docker/edith-src.tar.gz"
( cd "$EDITH_ROOT" && git ls-files -co --exclude-standard -z \
    bin src package.json package-lock.json \
    | tar --null -T - -czf "$SRC_TAR" )

docker build \
    --build-arg "EDITH_VERSION=$EDITH_VERSION" \
    --build-arg "MOUNT_PATH=/opt/edith" \
    -t "workbuddy-bench/harness/edith:$EDITH_VERSION" \
    -f "$VENDOR/configs/harnesses/edith/docker/Dockerfile" \
    "$VENDOR/configs/harnesses/edith/docker"

echo "OK — built workbuddy-bench/harness/edith:$EDITH_VERSION"
