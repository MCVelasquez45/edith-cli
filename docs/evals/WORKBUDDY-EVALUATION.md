# WorkBuddy Bench — EDITH Integration Evaluation (GO/NO-GO Gate)

Date: 2026-08-22
Evaluator: automated architecture audit (EDITH repo + upstream source read)

## Subjects

| Side | Identity |
|---|---|
| EDITH | `edith-cli` `main` @ `a9bec91`, 177/177 tests passing, clean tree |
| WorkBuddy Bench | `Tencent/workbuddy-bench` @ `625b2233093ae4f23e76be28c1f341d41cc70373` (2026-08-20) |
| Harbor | pinned by upstream at tag `v0.18.0` (`[tool.uv.sources]` in `pyproject.toml`) |

## What WorkBuddy is

A four-layer (bench → harness → model → job) agent-CLI benchmark built on the Harbor
orchestration framework. A *harness* is the agent CLI under evaluation, implemented as a
`BaseInstalledAgent` subclass that Harbor instantiates inside a Docker task container and
drives via `install()` / `run(instruction, environment, context)`. The CLI itself is
delivered as a read-only "split-mount" image (one image per harness version), so task
images never change when the harness does. Verification runs through
`workbuddy_bench.judge:CompositeVerifier`; results land under `results/<job>/<ts>/<trial>/`
with `reward.json` (numeric score) and rich diagnostics.

Four datasets ship via HuggingFace: Code (80 tasks), Web (70), Office (50), Security (60).

## Scorecard

| Category | Weight | Score | Evidence |
|---|---:|---:|---|
| EDITH CLI compatibility | 15 | 13 | Single programmatic agent core exists: `EdithRuntime` (`src/runtime/agent-session.js:33`) with `workspace` override, `runTurn({text, requestApproval})`, injectable approval callback. TUI is a thin layer over it. Missing piece was a first-class headless command — small additive change, no second engine needed. |
| Headless execution | 15 | 13 | All ANSI/raw-mode behavior is TTY-gated (`ui/terminal.js`, `input-composer.js`); non-zero `process.exitCode` on failure (`bin/edith.js:4`); `edith ask opencode --auto` already proves a non-interactive path. `edith run` implemented in this integration on the shared core. |
| Container compatibility | 15 | 12 | Pure-JS deps, no postinstall/native modules; all state/config paths honor `EDITH_DATA_DIR`/`EDITH_CONFIG_DIR`. One in-path blocker: hardcoded `/bin/zsh` in `src/tools/tool-engine.js` (fixed as part of integration). macOS Keychain (`/usr/bin/security`) and `/usr/bin/open` are only in the Google OAuth path, which the benchmark never exercises. |
| Model compatibility | 10 | 8 | EDITH registers OpenAI-compatible providers with TrueForge generically; base URLs are env-overridable (`EDITH_OLLAMA_BASE`, `EDITH_LMSTUDIO_BASE`). WorkBuddy supports `model_connection: direct` with env-named backend URL/key, so a local Ollama/LM Studio endpoint reaches the container via `host.docker.internal`. Docked 2: EDITH's discovery was probe-based (Ollama/LM Studio shapes only); a generic `EDITH_OPENAI_BASE_URL` provider is added for arbitrary OpenAI-compatible endpoints (incl. WorkBuddy's proxy). |
| Tool-loop compatibility | 15 | 14 | Real multi-step loop is EDITH's architecture: TrueForge turn → loopback MCP capability service → `read_file`/`edit_file`/`run_command`/git tools → observe → continue. Stage-B POC 12/12 proved genuine reason→tool→observe cycles with a local model. Approval gates are injectable (`requestApproval`), so headless auto-approval needs no core change. |
| Benchmark value | 10 | 9 | 260 real tasks across code/web/office/security with scripted + LLM-judge verification, per-trial trajectories, deterministic task containers, `--dry-run`, task subsetting (`task_selection`), sharding. Exactly the "did EDITH get better?" instrument we lack. |
| Maintainability | 10 | 8 | Adding a harness is designed-for: `configs/harnesses/<family>/` + one agent class + one entry in `HARNESS_ADAPTERS` (`runner/harness_adapters.py`) — the error message itself documents this extension point. Harbor pinned by tag. Cost: our harness lives as an overlay applied to a pinned upstream checkout; upstream bumps require re-validating the overlay (procedure documented). |
| Licensing / distribution risk | 10 | 7 | License is Apache-2.0-derived **with an EU territorial restriction** ("NOT INTENDED FOR USE WITHIN THE EUROPEAN UNION", prevails over all else). Integration is fully separable: zero Tencent code vendored into EDITH; the bench lives in a git-ignored pinned checkout, EDITH-authored overlay files are our copyright. Classification: **CLEAR FOR OUR PROPOSED TECHNICAL USE** (local, non-EU, non-redistributed evaluation tooling). **REQUIRES HUMAN/LEGAL REVIEW** before: any EU use, redistribution of the bench, or shipping benchmark-derived artifacts. Not a blocker for this use. |

**Total: 84 / 100**

## P0 blocker check

| P0 candidate | Status |
|---|---|
| Cannot execute EDITH headlessly | NO — shared core is programmatic; `edith run` is a thin additive entry |
| Cannot run inside Docker | NO — pure JS, env-driven paths; zsh hardcode fixed (one line class of change) |
| Cannot access task workspace | NO — `EdithRuntime({workspace})` + capability service confine to workspace |
| Cannot execute tools | NO — loopback MCP toolset incl. shell/file/git |
| Cannot return a usable result | NO — final text + exit code; output teed by harness to `/logs/agent` |
| License clearly prohibits intended use | NO — permits use/modification/derivatives; EU clause not applicable to local non-EU use |
| Integration destabilizes EDITH core | NO — additive CLI command + shell portability fix; TUI and headless share one runtime |

## Decision

```
GO  (84/100, no unresolved P0 blocker)
```

## Chosen integration boundary (license- and architecture-driven)

```
EDITH repo (MIT, ours)                     pinned upstream checkout (git-ignored)
┌─────────────────────────────┐            ┌──────────────────────────────┐
│ src/…       one agent core  │            │ evals/workbuddy/vendor/      │
│ evals/workbuddy/            │  overlay   │   workbuddy-bench @ 625b223  │
│   overlay/  (our files) ────┼───copy────▶│   + configs/harnesses/edith  │
│   scripts/  setup/dry/smoke │            │   + agents/edith_agent.py    │
│   datasets/ edith-smoke     │            │   + adapter registry entry   │
└─────────────────────────────┘            └──────────────────────────────┘
```

No Tencent source is committed to EDITH. The overlay (all EDITH-authored) is copied into
the pinned checkout at setup time; `harness_adapters.py` gets a one-entry patch applied by
script with a change notice, satisfying §4 of the upstream license for local modified use.

## Reconsideration triggers

- Upstream moves the harness extension point or Harbor major-bumps → re-run this audit.
- Any plan to redistribute the integrated bench or run it in the EU → legal review first.
