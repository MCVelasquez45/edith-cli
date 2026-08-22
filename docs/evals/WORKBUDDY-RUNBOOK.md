# WorkBuddy × EDITH — Runbook

Everything runs from the EDITH repo root. The bench lives in a pinned,
git-ignored checkout under `evals/workbuddy/vendor/workbuddy-bench`.

## Prerequisites

- Docker Desktop running (`docker info` succeeds)
- `uv` ≥ 0.8 and Python ≥ 3.12 (uv provisions the interpreter)
- Node ≥ 20 (EDITH itself)
- A local model backend — default assumption: Ollama on the host with
  `qwen3:8b` pulled (`ollama pull qwen3:8b`; `curl localhost:11434/v1/models`)

## Setup (idempotent)

```bash
npm run eval:workbuddy:setup
```

Clones `Tencent/workbuddy-bench` at the pinned SHA, applies the EDITH overlay
+ adapter patch, installs the `edith-smoke-v0.1` dataset (packing workspace
tarballs), registers `edith` in fetched datasets' split-mount maps, runs
`uv sync`, and seeds `.env` from `evals/workbuddy/.env.example`.

### Dataset setup

Upstream's fetch script needs bash ≥ 4; on macOS fetch archives directly:

```bash
cd evals/workbuddy/vendor/workbuddy-bench/datasets
curl -fSLO https://huggingface.co/datasets/tencent/workbuddy-bench/resolve/main/wb-bench-code-v1.0.tar.gz
tar -xzf wb-bench-code-v1.0.tar.gz && rm wb-bench-code-v1.0.tar.gz
# subsets: code (~196MB) · web · office (~3MB) · sec (~479MB)
cd - && npm run eval:workbuddy:setup   # re-run to register edith in the new dataset
```

### Model configuration

`evals/workbuddy/vendor/workbuddy-bench/.env` (never committed):

```bash
WB_EDITH_BACKEND_URL=http://host.docker.internal:11434/v1
WB_EDITH_BACKEND_KEY=ollama-no-key-required
```

Other backends: add `configs/models/<provider>/<slug>.yaml` via the overlay
(`evals/workbuddy/overlay/configs/models/`), point `backend_url_env` /
`backend_key_env` at env names, put values in `.env`, re-run setup.

## Build the harness mount

```bash
npm run eval:workbuddy:build
# → workbuddy-bench/harness/edith:<EDITH package.json version>
```

Re-run after any EDITH source change you want benchmarked (it re-packs the
working tree).

## Docker verification

```bash
docker info && docker image ls workbuddy-bench/harness/edith
```

## Dry run (always first)

```bash
npm run eval:workbuddy:dry            # resolves edith-local-smoke, prints manifest
bash evals/workbuddy/scripts/eval.sh dry <job>   # any job
```

## Runs

```bash
npm run eval:workbuddy:smoke    # edith-local-smoke: infra proof, 1 tiny task
npm run eval:workbuddy:code     # edith-code-smoke: real Code-subset task(s)
bash evals/workbuddy/scripts/eval.sh run <job>   # any configs/jobs/<job>.yaml
```

Scale the code job by editing `evals/workbuddy/overlay/configs/jobs/edith-code-smoke.yaml`
(`task_selection`) and re-running setup.

## Results

```bash
npm run eval:workbuddy:report
```

Raw outputs: `evals/workbuddy/vendor/workbuddy-bench/results/<job>/<timestamp>/`
— per-trial `result.json`, `agent/edith-output.txt`, `agent/trajectory.json`,
`verifier/` logs, `reward.json`. Keep summaries in
`docs/evals/WORKBUDDY-RESULTS.md`; raw results are git-ignored.

## Debugging

| Symptom | Look at |
|---|---|
| trial exception | `results/<job>/<ts>/<trial>/exception.txt`, `trial.log` |
| agent behavior | `<trial>/agent/edith-output.txt` (JSONL events + result envelope) |
| verifier outcome | `<trial>/verifier/test_output.txt`, `reward.json` |
| harness mount missing | `npm run eval:workbuddy:build` |
| model unreachable | `curl http://localhost:11434/v1/models` on the host; the container reaches it as `host.docker.internal` |
| config resolution | `bash evals/workbuddy/scripts/eval.sh dry <job>` (full manifest) |

Manual in-container reproduction (what the harness does):

```bash
docker run --rm --add-host host.docker.internal:host-gateway \
  -v <extracted-mount>:/opt/edith:ro python:3.12-slim bash -c '
  ln -s /opt/edith/bin/edith /usr/local/bin/edith
  export EDITH_OPENAI_BASE_URL=http://host.docker.internal:11434/v1 EDITH_OPENAI_MODEL=qwen3:8b
  edith run --json --approve-all -p "…" '
```

## Upgrading WorkBuddy

1. Edit `WORKBUDDY_SHA` in `evals/workbuddy/scripts/setup.sh`.
2. `rm -rf evals/workbuddy/vendor/workbuddy-bench && npm run eval:workbuddy:setup`.
3. If the adapter patch no longer applies, regenerate it against the new
   `harness_adapters.py` and re-check `HARNESS_AUTHORING.md` for interface
   drift (`install()`/`run()` signatures, kwargs from `prepare_job.py`).
4. Re-run: dry → smoke → code. Update pins in `WORKBUDDY-RESULTS.md`.

## Upgrading the EDITH harness version

1. Bump `version` in `package.json`.
2. Add `evals/workbuddy/overlay/configs/harnesses/edith/versions/<v>.yaml`
   (copy `0.1.0.yaml`, adjust `EDITH_VERSION` and, if needed, `settings_file`).
3. `npm run eval:workbuddy:setup && npm run eval:workbuddy:build`.
4. Point job YAMLs at `edith/<v>`.

## Version pins

| Component | Pin |
|---|---|
| workbuddy-bench | `625b2233093ae4f23e76be28c1f341d41cc70373` (setup.sh) |
| Harbor | `v0.18.0` (upstream `pyproject.toml [tool.uv.sources]`) |
| Python | ≥ 3.12 (upstream requirement; uv-managed) |
| EDITH harness | `edith/0.1.0` (= package.json version) |
| Docker | Desktop / Engine with compose v2 (image-backed volumes need ≥ Harbor v0.13 semantics) |
