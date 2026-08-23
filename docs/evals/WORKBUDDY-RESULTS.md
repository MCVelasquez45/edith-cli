# WorkBuddy × EDITH — Results

Raw run outputs are git-ignored under
`evals/workbuddy/vendor/workbuddy-bench/results/`; this file keeps the
durable summaries. Pins for each run: see the runbook's version-pin table.

## edith-local-smoke — 2026-08-22

First fully scored end-to-end run of the chain
WorkBuddy → Harbor (docker) → EDITH harness mount → `edith run --json`
→ qwen3:8b (Ollama, direct) → tool loop → workspace edit → CompositeVerifier.

| Field | Value |
|---|---|
| Job | `edith-local-smoke` (1 trial) |
| Task | `edith-smoke/smoke-fix-add` |
| Harness | `edith/0.1.0` |
| Model | `qwen3:8b` local, direct, temperature 0.0 |
| Reward | **1.000** |
| Verifier tests | 5/5 passed |
| Exceptions | 0 |
| Runtime | 3m 12s |
| Results dir | `results/edith-local-smoke/2026-08-22__17-00-41` |

### Defect fixed on the way

Earlier runs of the same job died with `RewardFileNotFoundError`. Root cause
was in the EDITH integration, not upstream: `edith-smoke-v0.1` had no
`configs/bench/<dataset_id>.yaml` layer, and `load_bench` silently falls back
to `_default.yaml`, which carries no `verifier.import_path`. Harbor then ran
its built-in shared verifier against the `tests/test.sh` format stub (exit 64,
no reward file) instead of `workbuddy_bench.judge:CompositeVerifier`.
Fix: `evals/workbuddy/overlay/configs/bench/edith-smoke-v0.1.yaml` declares the
verifier import path; re-run `npm run eval:workbuddy:setup` to apply.

## Pending

- `edith-code-smoke` (real wb-bench Code-subset task) — infra identical to the
  smoke chain; run when a real-benchmark datapoint is wanted.
