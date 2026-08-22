# ADR: WorkBuddy Bench as EDITH's agent-evaluation layer

Status: Accepted · Date: 2026-08-22

## Context

EDITH's test ladder stopped at unit tests (node --test) and agent-loop tests
(Stage-B POC). Nothing measured whether EDITH performs *real engineering
work* — multi-file edits, test-driven repair, tool selection — or whether a
change to EDITH made it better or worse. We needed a repeatable instrument:

```
EDITH + harness version + model + dataset + sandbox = scored run
```

## Decision

Adopt **Tencent WorkBuddy Bench** (pinned `625b223`, Harbor `v0.18.0`) as the
evaluation layer, with EDITH as a first-class harness:

1. `edith run` — a headless CLI entry over the **same** `EdithRuntime` core as
   the TUI (one agent runtime, multiple interfaces).
2. An **overlay** integration: EDITH-authored files
   (`evals/workbuddy/overlay/`, one-entry registry patch, smoke dataset)
   copied by `setup.sh` into a git-ignored pinned checkout. Zero Tencent code
   in the EDITH repo.
3. Split-mount harness image `workbuddy-bench/harness/edith:<version>` packing
   the EDITH app + node_modules + private Node runtime.
4. Model access through EDITH's generic OpenAI-compatible provider
   (`EDITH_OPENAI_*` env), keeping providers pluggable and local models
   first-class.

## Alternatives considered

- **SWE-bench (+harness)** — code-only, heavy per-instance images, no harness
  CLI conventions matching EDITH's shape; WorkBuddy's four subsets and
  installed-agent design fit better.
- **Custom in-repo benchmark** — no external comparability, and we would own
  sandboxing/verification infrastructure Harbor already provides. Retained as
  a *dataset* idea (edith-smoke is the seed), not an infrastructure project.
- **Fork WorkBuddy into EDITH** — rejected: licensing coupling (EU-restricted
  license in-tree) and a permanent maintenance burden vs. a 1-file patch.

## Why WorkBuddy

Designed-for harness extension (config dir + one `BaseInstalledAgent` class +
one registry entry; upstream's own error message documents it), pinned Harbor,
real datasets with deterministic verifiers, dry-run and task-subset support,
local-model-friendly connection modes (`direct` / `local_proxy`).

## Integration boundary

EDITH repo carries only EDITH-authored artifacts. The bench checkout is
reproducible from `(WORKBUDDY_SHA, overlay/, patches/)` via
`npm run eval:workbuddy:setup`. The benchmark is tooling — it is not part of
EDITH's production startup path and adds no runtime dependency.

## License considerations

Upstream: Apache-2.0-derived with an EU territorial restriction (prevailing).
Separable overlay keeps EDITH MIT-clean. Local, non-EU, non-redistributed
evaluation use classified CLEAR; EU use or redistribution requires legal
review. Modified upstream file carries a change notice (§4 compliance).

## Consequences

- (+) Release-gate candidate: unit → agent-loop → WorkBuddy smoke → subsets.
- (+) A/B capability: same task/model, EDITH vs claude-code/codebuddy-code.
- (−) An overlay to re-validate on upstream bumps (procedure in runbook).
- (−) Benchmark runs need Docker + a serving model; not part of default CI.
- (−) Token/cost accounting not yet backfilled (EDITH events lack usage).

## Upgrade strategy

Bump `WORKBUDDY_SHA` in `setup.sh`, re-clone, re-apply overlay/patch, re-run
dry → smoke → code. Harness versions are additive `versions/<v>.yaml` files
tied to EDITH's package version.

## Rollback strategy

Delete `evals/workbuddy/` and the `eval:workbuddy:*` npm scripts. `edith run`
stays — it is a product feature independent of the benchmark. No other EDITH
surface is touched.
