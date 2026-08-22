# EDITH E2E PRODUCT GATE

_Created: 2026-08-22 · Acceptance gate for the product defined in `../product/EDITH-E2E-PRODUCT-DIRECTIVE.md`. EDITH is **not** production-ready until this gate passes. Statuses: PASS / PARTIAL / FAIL / BLOCKED / NOT IMPLEMENTED._

**The gate test:** `cd ~/orca/test-project && edith` → "Find why the tests are failing and fix them." → EDITH autonomously understands the workspace, inspects git, searches, reads, hypothesizes, runs tests, edits, re-runs until green or blocked, shows progress, summarizes, preserves the session. Then `edith --resume` → "What did we change?" → EDITH knows.

## Baseline assessment — 2026-08-22 (post Tier-A cleanup, pre Sprint 2)

Assessed against the current live path: native cockpit (`src/native/*`) with regex intent routing, LLM text synthesis, in-memory 24-message history. Stage-A TrueForge POC passed (`TRUEFORGE-INTEGRATION-TEST.md`) but nothing TrueForge-backed is wired into `edith` yet.

| Capability | Status | Evidence / gap |
| --- | --- | --- |
| `edith` launches interactive agent | PARTIAL | `edith` opens the native cockpit (`src/cli.js:31`), but it is a regex router with LLM synthesis, not the target agent product |
| Workspace detected | PARTIAL | `detectWorkspace()` in `src/native/workspace-tools.js:122`; no progressive workspace context (language, package manager, project instructions, skills, MCP) |
| Git context detected | PARTIAL | branch/status/diff context via workspace tools; not fed to a reasoning loop |
| Natural conversation | PARTIAL | LLM synthesis exists, but regex intent routing constrains what conversation can trigger |
| Token streaming | PASS | provider `streamChat` streams to terminal (`src/native/agent-core.js:838`) |
| Agent loop | NOT IMPLEMENTED | no model tool-calling in `edith`; `route()` + hardcoded handlers. Target runtime proven: Stage-B POC ran a real reason→tool→observe→reason loop on qwen3:8b through TrueForge (12/12) |
| File read | PARTIAL | read-only workspace tools with secret redaction; regex-triggered, not agent-selected |
| File search | PARTIAL | workspace search exists; same limitation |
| File edit | PARTIAL | `src/tools/tool-engine.js` can write/patch with approval flag, but is a disjoint surface not reachable from conversation |
| Shell execution | NOT IMPLEMENTED | no controlled shell tool; only fixed git subprocess calls; shell work is delegated to external CLIs |
| Tool-result reasoning | NOT IMPLEMENTED | absent in `edith`; proven through TrueForge in Stage-B POC (multi-step: list_files → observe → read_file → observe → answer) |
| Multi-step execution | PARTIAL | hardcoded `executePlan` handler sequences only |
| Approval prompt | PARTIAL | confirmation gating in `src/tools/policy.js`; not a live in-loop approval protocol (Allow once / session / Deny) |
| Interrupt/cancel | FAIL | no SIGINT handling in the cockpit; Ctrl+C kills the whole process |
| Error recovery | PARTIAL | provider fallback exists; errors are not consistently rendered with remediation |
| Persistent session | NOT IMPLEMENTED | in-memory 24-message history only; nothing survives exit |
| Resume session | NOT IMPLEMENTED | no `--resume` / `--continue` / session store |
| Context compaction | NOT IMPLEMENTED | target: TrueForge ContextCompaction |
| Local model | PASS | Ollama + LM Studio first-class (`src/providers/*`); verified through TrueForge in Stage-A POC |
| Cloud model | PASS | approved NVIDIA cloud model behind egress governance (PUBLIC-only, sanitized) |
| Skills | NOT IMPLEMENTED | none in repo; target: TrueForge git-backed SKILL.md |
| MCP | PARTIAL | stdio client + self server with 3 read-only tools; not usable by an agent loop. Integration shape proven in Stage-B POC: local streamable-http MCP server registered in TF, tools discovered and called by the agent |
| Diff visibility | PARTIAL | `src/tools/diff.js` + bounded git diff context; no per-edit diff UX |
| Git awareness | PARTIAL | status/branch/diff readable; no agent reasoning over it |
| `edith doctor` | PARTIAL | `runDoctor` validates local providers + security findings; does not cover TrueForge runtime, DB, Keychain, MCP, workspace, skills |
| Clean shutdown | PARTIAL | nothing corrupts (nothing persists); no deliberate lifecycle |
| Restart recovery | NOT IMPLEMENTED | no state to recover; follows session persistence |
| Regression suite | PASS | 103/103 `node --test` (2026-08-22) |
| E2E suite | NOT IMPLEMENTED | no automated end-to-end product test |

**Summary: 4 PASS · 14 PARTIAL · 1 FAIL · 10 NOT IMPLEMENTED.**

## How this gate gets green (sprint mapping)

- Sprint 2 (TrueForge Agent Core): Agent loop, Tool-result reasoning → target PASS in POC, then cut-in.
- Sprint 3 (Coding-Agent Tools): File read/search/edit, Shell, Multi-step, Diff visibility, Git awareness.
- Sprint 4 (Interactive CLI Product): launch experience, streaming/activity rendering, Approval prompt, Interrupt/cancel, Error recovery.
- Sprint 5 (Persistent Agent): Persistent session, Resume, Context compaction, Restart recovery, Clean shutdown.
- Sprint 6 (Skills + MCP): Skills, MCP.
- Sprint 9 (Hardening): `edith doctor`, E2E suite, Regression suite kept green throughout.

Update this table with dated re-assessments as sprints land; never mark a row PASS without a reproducible check.

---

## Final assessment — 2026-08-22 (post E2E product build, TrueForge-backed runtime, legacy retired)

Assessed against the shipped path: `edith` → `EdithRuntime` (src/runtime/agent-session.js) → supervised TrueForge (standalone, SQLite under `~/.edith/runtime`) → loopback MCP capability service (19+ tools) → Ollama `qwen3:8b`. Regex router and legacy runtime removed (MIGRATE→VERIFY→REMOVE; commit d53a685). All live checks below were reproduced on this machine on 2026-08-22.

| Capability | Status | Evidence (reproducible) |
| --- | --- | --- |
| `edith` launches interactive agent | PASS | scripted run of `bin/edith.js`: header → agent turn → ✓ Done (single-pane app, src/app/edith-app.js) |
| TrueForge lifecycle automatic | PASS | supervisor live gate: cold start 1.25s, `[::1]` bind handled, reuse, adopt, clean shutdown; `edith runtime status\|stop\|restart` |
| Workspace detected | PASS | root/branch/project/package-manager/instructions in agent context (test/workspace.test.js); shown in header |
| Git awareness | PASS | git_status/diff/log/branch tools; branch+dirty in context block; agent used git_log correctly in live check |
| Natural conversation | PASS | no intent regex anywhere on the path; model-driven turns |
| Real agent loop | PASS | live: reason → search_files → list_directory → read_file → answer (3 tool round-trips) with planted-fact proof |
| Token streaming | PASS | live deltas rendered (91 answer chars streamed; 1266 reasoning deltas separated) |
| Tool streaming | PASS | live tool-call/tool-result events with args (chunked-args accumulation verified in test/runtime-events.test.js) |
| File read | PASS | read_file incl. line ranges; secret-path refusal; redaction (test/capability-toolset.test.js) |
| File search | PASS | search_code / search_files (rg with grep fallback) |
| File edit | PASS | E2E: agent fixed src/cart.js with edit_file (exact-match, uniqueness-guarded) |
| Shell execution | PASS | run_command (destructive/system classes refused → gated tool); E2E ran npm test |
| Test execution | PASS | run_tests auto-detects project command; E2E red→green |
| Multi-step reasoning | PASS | E2E: run tests → read → edit → re-run → summarize |
| Persistent session | PASS | TrueForge SQLite + EDITH session index; codeword recalled across full restart |
| Resume session | PASS | `edith --continue` E2E: "What did we change?" answered correctly from memory |
| Context compaction | PASS | live: agent.context.overwrite summaries in thread_context_log at configured threshold; EDITH sets threshold at 60% of model context (default 50k exceeded qwen3's 40k window) |
| Local model | PASS | Ollama qwen3:8b end-to-end everywhere above |
| Cloud model | PARTIAL (BLOCKED on credentials) | full path implemented — key-injection proxy, PUBLIC-only egress gate, sanitization, edith-cloud agent — but no NVIDIA_API_KEY exists on this machine to live-verify an actual cloud turn |
| Skills | PASS | core/user/workspace SKILL.md tiers; live: agent loaded workspace skill via read_skill and followed it exactly |
| MCP | PASS | loopback streamable-http capability service; TrueForge handshake + 19-tool discovery live |
| Approval flow | PASS | live deny (file preserved) and allow (file deleted) through TF approval-resume protocol; y/N native prompt; E2E deny via binary |
| Ctrl+C cancellation | PASS | PTY E2E: mid-generation \x03 → "Cancelled — session preserved" → redirect turn succeeded |
| Diff visibility | PASS | edit results report replacements + line delta; git_diff on demand; /details full output |
| Error recovery | PASS | friendly errors w/ remediation (turn-view tests); in-app runtime recovery loop |
| Runtime recovery | PASS | supervisor restart/adopt tests; app re-starts runtime mid-session on failure |
| `edith doctor` | PASS | directive-format output with per-failure remediation; exit code reflects issues |
| Clean shutdown | PASS | capability service + key proxies closed on exit; supervisor shutdown SIGTERM→wait→SIGKILL tested |
| Specialist delegation | PASS | delegate_specialist through the live TF loop (stub adapter); real adapters health-checked in doctor (all 3 installed) |
| Security governance | PASS | EDITH is the policy decision point per turn (classify → egress → agent select/block) |
| Egress policy | PASS | SECRET never leaves; cloud requires PUBLIC-only + sanitization (test/runtime-governance.test.js, test/hybrid-routing.test.js) |
| Secret handling | PASS | Keychain auth untouched; provider keys via loopback injection proxy — never in TrueForge plaintext persistence; secret-path/output redaction |
| E2E coding task | PASS | fixture repo: "find why tests fail and fix" → red→green with correct one-line fix + summary |
| E2E resume | PASS | restart + `--continue`: change recalled with reasoning |
| Local-only E2E | PASS | all E2E runs executed with `env -u NVIDIA_API_KEY` |
| Full regression suite | PASS | 148/148 `node --test` (2026-08-22, post legacy removal) |

**Summary: 33 PASS · 1 PARTIAL (cloud live-turn, blocked on credentials — code path complete and unit/governance-tested).**

The single PARTIAL is a credentials gap, not an implementation gap: registering `NVIDIA_API_KEY` upgrades it to a live check with no code change (`edith` will register the provider through the key proxy and `/model cloud-reasoning` becomes selectable).
