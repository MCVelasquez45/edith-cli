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
