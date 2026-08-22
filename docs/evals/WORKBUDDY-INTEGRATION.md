# WorkBuddy Bench × EDITH — Integration Guide

WorkBuddy Bench (Tencent) is EDITH's agent-evaluation layer: it runs EDITH as
a harness inside Docker task sandboxes, drives it with real engineering tasks,
verifies the outcome with scripted verifiers, and produces repeatable scores.

```
EDITH + harness version + model + dataset + sandbox = repeatable scored run
```

## Why WorkBuddy

- Evaluates **whole-agent behavior** (multi-step tool loops against real
  repos), not single functions — exactly the gap in EDITH's test ladder above
  unit and agent-loop tests.
- 260 tasks across Code/Web/Office/Security with deterministic verifiers.
- Harness extension is a designed-for, ~3-touch surface (config dir + one
  Python class + one registry entry); Harbor stays pinned, never forked.
- Full audit: `docs/evals/WORKBUDDY-EVALUATION.md` (GO at 84/100).

## Integration boundary

No Tencent source is vendored into EDITH. The bench lives in a git-ignored
pinned checkout; EDITH-authored overlay files are copied in at setup time.

```
EDITH repo (MIT)                              git-ignored pinned checkout
┌────────────────────────────────┐            ┌─────────────────────────────────┐
│ src/…            one agent core│            │ evals/workbuddy/vendor/         │
│  ├─ app/edith-app.js   (TUI)   │            │   workbuddy-bench @ 625b223     │
│  └─ app/headless.js (edith run)│  overlay   │   ├─ configs/harnesses/edith/   │
│ evals/workbuddy/               │ ──copy───▶ │   ├─ agents/edith_agent.py      │
│  ├─ overlay/     (our files)   │            │   ├─ adapter registry (+1 entry)│
│  ├─ patches/     (1 registry)  │            │   └─ datasets/edith-smoke-v0.1  │
│  ├─ datasets/edith-smoke-v0.1  │            │        + wb-bench-* (HF)        │
│  └─ scripts/ setup·build·eval  │            └─────────────────────────────────┘
└────────────────────────────────┘
```

## Runtime architecture

```
scripts/run.sh --job edith-local-smoke
      │  resolve manifest (bench→harness→model→job deep-merge)
      ▼
Harbor v0.18.0 (pinned)
      │  builds task image · mounts workbuddy-bench/harness/edith:<v> read-only
      ▼
Docker task sandbox (/workspace, non-root `dev` user)
      │  EdithAgent.install(): symlink /opt/edith/bin/edith → PATH
      │  EdithAgent.run():
      ▼
edith run --json --approve-all --model <m> --prompt <task instruction>
      │  EdithRuntime (same core as the TUI)
      │   ├─ TrueForge runtime  (container-local, port 8619)
      │   ├─ loopback MCP capability service (workspace tools)
      │   └─ generic OpenAI-compatible provider:
      │        EDITH_OPENAI_BASE_URL / _API_KEY / _MODEL
      ▼
model backend (direct: host Ollama via host.docker.internal,
               or local_proxy: WorkBuddy host proxy)
      ▼
reason → tool → observe loop → workspace modified → JSON result envelope
      │  teed to /logs/agent/edith-output.txt → ATIF trajectory.json
      ▼
CompositeVerifier (pytest_injected et al.) → reward.json / score.json
```

## Harness architecture

One agent core, two front doors: `edith` (TUI) and `edith run` (headless) both
drive `EdithRuntime` (`src/runtime/agent-session.js`). The benchmark never
touches EDITH's production startup path.

`edith run` contract (stable; the harness depends on it):

- stdout: answer text, or with `--json` JSONL events + final envelope
  `{event:"result", state, exitCode, text, sessionId, model, events}`
- exit codes: `0` completed · `1` failed · `2` usage error · `124` cancelled/timeout
- approvals: gated (destructive) tools are **denied** by default; the harness
  passes `--approve-all` because the Docker sandbox is the safety boundary.

## Model architecture

EDITH stays provider-agnostic. The benchmark path uses the generic
OpenAI-compatible provider (`src/runtime/models.js`):

| Env | Meaning |
|---|---|
| `EDITH_OPENAI_BASE_URL` | full base incl. `/v1` |
| `EDITH_OPENAI_MODEL` | model id (skips discovery probe) |
| `EDITH_OPENAI_API_KEY` | optional; injected via EDITH's loopback key proxy, never persisted |
| `EDITH_OPENAI_CONTEXT_LENGTH` | advisory context length |
| `EDITH_OPENAI_LOCATION` | `CLOUD` opts into egress governance for remote endpoints |

Connection modes: `direct` (run.sh maps the model config's
`backend_url_env`/`backend_key_env` onto the EDITH env vars) and `local_proxy`
(EDITH addresses WorkBuddy's host proxy; api key carries `{trial}::{route}`
for per-trial request attribution).

## Security considerations

- Tasks are untrusted: they run in Harbor's Docker sandbox as non-root `dev`,
  with the harness mounted read-only. No host Docker socket, no HOME mounts.
- Only two env values cross into the container for the model path (base URL +
  key); `.env` stays in the git-ignored vendor checkout; templates carry
  placeholders only.
- EDITH's key proxy keeps API keys out of TrueForge's SQLite persistence.
- `--approve-all` is confined to the sandboxed benchmark invocation; the
  interactive product keeps its approval gates.

## Licensing considerations

Upstream license is Apache-2.0-derived **with an EU territorial restriction**
("NOT INTENDED FOR USE WITHIN THE EUROPEAN UNION", prevailing clause).
Mitigations: nothing vendored into EDITH; overlay files are EDITH-authored;
the one modified upstream file carries a change notice (license §4). Local,
non-EU, non-redistributed evaluation use is treated as CLEAR; **any EU use or
redistribution requires human/legal review first.** See the evaluation report.

## Known limitations

- Token/cost backfill into Harbor context is not implemented (EDITH's event
  stream doesn't carry usage yet); trajectories carry steps, not token counts.
- Sampling params apply only under `local_proxy`; direct mode uses backend
  defaults.
- `local_proxy` mode is configured but the first verified runs used `direct`.
- Upstream `scripts/dataset/fetch-dataset.sh` needs bash ≥ 4 (macOS ships
  3.2) — the runbook documents a curl fallback. Upstream defect, not EDITH's.
