#!/bin/bash
# EDITH-facing entry points for WorkBuddy benchmark runs.
#
#   eval.sh build            build the edith split-mount image
#   eval.sh dry [job]        resolve + print the manifest, no execution
#   eval.sh smoke            run the edith-local-smoke job (infra proof)
#   eval.sh code             run the edith-code-smoke job (real benchmark subset)
#   eval.sh run <job>        run any configs/jobs/<job>.yaml
#   eval.sh report           summarize the newest result directory
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR="$EVAL_DIR/vendor/workbuddy-bench"
RESULTS_LINK="$EVAL_DIR/results"

[ -d "$VENDOR" ] || { echo "vendor checkout missing — run: npm run eval:workbuddy:setup" >&2; exit 1; }

cmd="${1:-help}"; shift || true
case "$cmd" in
    build)
        exec "$SCRIPT_DIR/build-mount.sh" ;;
    dry)
        job="${1:-edith-local-smoke}"
        cd "$VENDOR" && exec uv run ./scripts/run.sh --job "$job" --dry-run ;;
    smoke)
        cd "$VENDOR" && exec uv run ./scripts/run.sh --job edith-local-smoke ;;
    code)
        cd "$VENDOR" && exec uv run ./scripts/run.sh --job edith-code-smoke ;;
    run)
        job="${1:?usage: eval.sh run <job-slug>}"
        cd "$VENDOR" && exec uv run ./scripts/run.sh --job "$job" ;;
    report)
        base="$VENDOR/results"
        [ -d "$base" ] || { echo "no results yet under $base" >&2; exit 1; }
        latest="$(find "$base" -name 'result.json' -o -name 'reward.json' | xargs -I{} dirname {} 2>/dev/null | sort | tail -50)"
        echo "── newest results under $base:"
        find "$base" -mindepth 2 -maxdepth 3 -type d | sort | tail -10
        echo
        echo "── rewards:"
        find "$base" -name 'reward.json' | sort | while read -r f; do
            printf '%s  %s\n' "$(cat "$f")" "$f"
        done
        ;;
    *)
        sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
