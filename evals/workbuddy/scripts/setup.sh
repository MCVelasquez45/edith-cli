#!/bin/bash
# Set up the pinned WorkBuddy Bench checkout with the EDITH harness overlay.
# Idempotent — safe to re-run. macOS bash 3.2 compatible.
#
# Steps: clone pinned upstream → apply EDITH overlay + adapter patch →
# install the EDITH smoke dataset → register edith in fetched datasets'
# split-mount maps → uv sync → seed .env → pack EDITH source for the
# split-mount image build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # evals/workbuddy
EDITH_ROOT="$(cd "$EVAL_DIR/../.." && pwd)"        # EDITH repo root
VENDOR="$EVAL_DIR/vendor/workbuddy-bench"

# ── Version pins (upgrade procedure: docs/evals/WORKBUDDY-RUNBOOK.md) ──
WORKBUDDY_REPO="https://github.com/Tencent/workbuddy-bench.git"
WORKBUDDY_SHA="625b2233093ae4f23e76be28c1f341d41cc70373"

step() { echo "── $1"; }

# 1. Pinned upstream checkout
if [ ! -d "$VENDOR/.git" ]; then
    step "cloning workbuddy-bench @ ${WORKBUDDY_SHA:0:12}"
    mkdir -p "$EVAL_DIR/vendor"
    git clone "$WORKBUDDY_REPO" "$VENDOR"
fi
git -C "$VENDOR" fetch -q origin "$WORKBUDDY_SHA" 2>/dev/null || true
if [ "$(git -C "$VENDOR" rev-parse HEAD)" != "$WORKBUDDY_SHA" ]; then
    step "checking out pinned SHA"
    git -C "$VENDOR" checkout -q "$WORKBUDDY_SHA"
fi

# 2. EDITH overlay (EDITH-authored files; safe to overwrite)
step "applying EDITH overlay"
( cd "$EVAL_DIR/overlay" && find . -type f | while read -r f; do
    dest="$VENDOR/${f#./}"
    mkdir -p "$(dirname "$dest")"
    cp "$f" "$dest"
done )

# 3. Harness adapter registry patch (skip when already applied)
if ! grep -q '"edith": HarnessRuntimeAdapter' "$VENDOR/src/workbuddy_bench/runner/harness_adapters.py"; then
    step "applying harness adapter patch"
    git -C "$VENDOR" apply "$EVAL_DIR/patches/0001-add-edith-harness-adapter.patch"
fi

# 4. EDITH smoke dataset: copy, pack workspace tarballs, borrow the code
#    dataset's shared verifier plugin (stays inside the vendor checkout).
step "installing edith-smoke dataset"
rm -rf "$VENDOR/datasets/edith-smoke-v0.1"
cp -R "$EVAL_DIR/datasets/edith-smoke-v0.1" "$VENDOR/datasets/"
for task_dir in "$VENDOR"/datasets/edith-smoke-v0.1/tasks/*/; do
    ws="$task_dir/environment/workspace"
    if [ -d "$ws" ]; then
        # root-owned, xattr-free entries: macOS tar defaults would trip git's
        # dubious-ownership check when extracted as root in the task image.
        ( cd "$ws" && tar --no-xattrs --uid 0 --gid 0 -czf ../workspace.tar.gz . )
        rm -rf "$ws"
    fi
done
if [ -d "$VENDOR/datasets/wb-bench-code-v1.0/shared" ]; then
    rm -rf "$VENDOR/datasets/edith-smoke-v0.1/shared"
    cp -R "$VENDOR/datasets/wb-bench-code-v1.0/shared" "$VENDOR/datasets/edith-smoke-v0.1/shared"
else
    echo "WARN: wb-bench-code-v1.0 not fetched yet; edith-smoke needs its shared/verifier plugin." >&2
    echo "      Fetch it (see runbook), then re-run this script." >&2
fi

# 5. Register edith in fetched datasets' split-mount maps
step "registering edith in dataset split-mount maps"
python3 - "$VENDOR" <<'EOF'
import sys
from pathlib import Path
vendor = Path(sys.argv[1])
for toml in sorted(vendor.glob("datasets/wb-bench-*/dataset.toml")):
    text = toml.read_text()
    if "edith" in text:
        continue
    marker = "[runtime.harness_delivery_by_harness]"
    if marker in text:
        text = text.replace(marker, marker + '\nedith = "split-mount"', 1)
        toml.write_text(text)
        print(f"  patched {toml}")
EOF

# 6. Python environment (Harbor pinned by upstream pyproject)
step "uv sync"
( cd "$VENDOR" && uv sync -q )

# 7. Environment file (placeholders only; edit for your setup)
if [ ! -f "$VENDOR/.env" ]; then
    step "seeding .env from template"
    cp "$EVAL_DIR/.env.example" "$VENDOR/.env"
fi

# 8. Pack the EDITH working tree for the split-mount image build.
#    Tracked + untracked-unignored files only; node_modules/vendor excluded
#    by gitignore semantics, so no local secrets can be swept in.
step "packing EDITH source for the harness mount"
SRC_TAR="$VENDOR/configs/harnesses/edith/docker/edith-src.tar.gz"
( cd "$EDITH_ROOT" && git ls-files -co --exclude-standard -z \
    bin src package.json package-lock.json \
    | tar --null -T - -czf "$SRC_TAR" )
echo "   $(du -h "$SRC_TAR" | cut -f1) → $SRC_TAR"

echo "OK — setup complete. Next: npm run eval:workbuddy:build && npm run eval:workbuddy:dry"
