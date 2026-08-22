# EDITH PRODUCT MATURITY SCORECARD

_Last updated: 2026-08-22 · Evidence-based assessment of the gap between today's EDITH and the production-grade, local-first, Orca-wide AI product defined in `../architecture/TARGET-AGENT-ARCHITECTURE.md` §0. Scores use code-level evidence from `../architecture/AGENT-SYSTEM-INVENTORY.md` and the current test suite (98/98 green). Do not inflate scores._

## Scale

```text
0 = nonexistent      no code exists
1 = experiment       code exists but is dead, orphaned, or a prototype
2 = functional       works in the happy path; gaps in persistence/recovery/coverage
3 = reliable         works consistently; tested; survives common failures
4 = production ready gated, observable, recoverable, documented
5 = enterprise-grade hardened, upgradeable, auditable, multi-workspace
```

## Scorecard

| Capability | Current | Target | Evidence |
| --- | ---: | ---: | --- |
| Chat agent | **2** | 5 | Cockpit chat works (`native/agent-core.js` + LLM synthesis) but intelligence is ~70 regex patterns → hard-coded handlers, not conversation-driven reasoning |
| Agent loop | **1** | 5 | No live loop. `runtime/agent.js` plan→execute loop is orphaned (tests only); live path is route→handler→respond with no observation/re-reasoning |
| Local inference | **3** | 5 | Ollama + LM Studio clients wired through provider router; covered by `provider-router.test.js`; `doctor` detects availability; endpoints duplicated in 6+ places (D2) |
| Cloud inference | **2** | 5 | NVIDIA provider works behind egress gate; single approved model hardcoded in 2 files (D9); no fallback, no Anthropic/OpenAI path |
| Sessions | **1** | 5 | Nothing persists. Live cockpit history is in-memory only; `runtime/session.js` JSON store exists but is never used by the live path (D5) |
| Context management | **1** | 5 | In-memory turn history only; no compaction, no restoration, no durable context |
| Skills | **0** | 5 | No `skills/` directory, no SKILL.md support, no skills runtime anywhere in the repo |
| Tools | **2** | 5 | Deterministic tools work and are tested (`workspace-tools`, `system-tools`) but exist across 3 divergent surfaces (D6); no dynamic agent selection of tools |
| MCP | **2** | 5 | Allowlisted client + registry + 3-tool server work; 4 divergent MCP registries across EDITH/Claude/Codex/`.mcp.json` (D4) |
| Workspace awareness | **1** | 5 | Git/workspace tools read the current repo, but there is no workspace/context abstraction — single-repo assumptions are implicit |
| Specialist delegation | **2** | 5 | Claude Code / Codex / OpenCode adapters work via subprocess (`src/agents/*`), but delegation is manual/wrapper-level, not EDITH-chosen |
| Security | **3** | 5 | Data classification + egress policy live and tested; SECRET-never-leaves enforced in `egress-policy.js`; no tool capability scopes yet |
| Governance | **3** | 5 | Egress decisions audited (`audit.js` append-only); policy is code-enforced; no per-tool permission boundaries or approval flow |
| Secrets | **3** | 5 | macOS Keychain via `auth/token-store.js` is solid; redaction exists but as 6 divergent regex sets (D7) — consolidation in progress (A5) |
| Approvals | **1** | 5 | `auth/action-policy.js` gates Google write actions; no general human-approval workflow for agent/tool actions |
| Observability | **1** | 5 | Append-only audit log only; no latency/token/error metrics, no per-request tracing, no runtime health surface |
| Reliability | **2** | 5 | `doctor.js` diagnostics + 98 passing tests; no health checks, provider fallback, crash/session recovery, or migration handling |
| Testing | **2** | 5 | 98 unit/behavior tests, all green; no integration, E2E, security, migration, or smoke suites |
| Installation | **1** | 5 | `npm` + `bin/edith.js` from a checked-out repo; no installer, first-run experience, or packaging |
| Updates | **0** | 5 | No update, migration, or version-management mechanism exists |
| Recovery | **0** | 5 | Nothing to recover and no recovery code: no durable state, no crash/session recovery, no rollback |
| Voice | **0** | 5 | No voice code exists in the repo (verified by search); earlier docs claiming a voice interface were aspirational |
| UX | **2** | 5 | Cockpit TUI recently redesigned (input composer, progress renderer, tested); command-oriented rather than conversational; no session navigation or approval UX |

**Summary: median score 2 (functional CLI orchestrator). The largest gaps to the product north star are persistence (sessions/context/recovery: 0–1), agent intelligence (loop/skills: 0–1), and product lifecycle (install/update/voice: 0–1) — exactly the areas TrueForge is being adopted to supply, plus product work TrueForge cannot supply (voice, install, UX).**

---

## Release gates — the definition of "done"

"100%" is not a statement; it is these gates passing. EDITH is production-ready only when **all** gates are green.

### Runtime Gate

- [ ] Persistent sessions survive process restart and resume correctly
- [ ] Agent dynamically selects and executes a tool without a hard-coded intent handler
- [ ] Skills load from a canonical skills structure and change agent behavior
- [ ] Context compaction keeps long sessions within model limits without losing task state
- [ ] Responses stream end-to-end (runtime → EDITH surface)
- [ ] Runtime errors recover without killing the EDITH process

### Security Gate

- [ ] Secrets are never persisted outside macOS Keychain (including inside TrueForge's DB)
- [ ] Egress rules enforced on every request path, including agent-initiated tool calls
- [ ] Tool scopes enforced — an agent cannot invoke a tool outside its granted capability set
- [ ] Destructive actions require human approval before execution
- [ ] One shared secret redactor used by every logging/output path (no divergent regex sets)
- [ ] Security test suite exists and passes

### Reliability Gate

- [ ] Restart recovery: EDITH restores prior session state after a crash or kill
- [ ] Provider failure fallback: cloud outage degrades to local models, not to failure
- [ ] Corrupted session data is detected and quarantined, not fatal
- [ ] Dependency health (Ollama/LM Studio/TrueForge/keychain) detected at startup and reported by `doctor`
- [ ] Clean shutdown persists all durable state
- [ ] Structured diagnostics available for every failure class

### Product Gate

- [ ] First-run experience configures a working local-only EDITH with no manual file editing
- [ ] Normal chat experience: conversational, workspace-aware, resumable
- [ ] Works across multiple Orca workspaces from one installed platform
- [ ] Session management: name, list, switch, resume
- [ ] Configuration follows defaults → machine → user → workspace → session, documented and validated
- [ ] Upgrade path with migrations and rollback
- [ ] Product documentation covers install, configure, use, diagnose, uninstall

### QA Gate

- [ ] Unit suite green
- [ ] Integration suite green (EDITH ↔ TrueForge ↔ local model)
- [ ] E2E suite green (user-visible flows)
- [ ] Security suite green
- [ ] Migration tests green
- [ ] Release smoke test green

## Gate ↔ sprint mapping

| Gate | Primarily earned in |
| --- | --- |
| Runtime | Sprints 2–5 |
| Security | Sprints 6–7 (foundation: Sprint 1 A5) |
| Reliability | Sprint 11 (foundations in 3–4) |
| Product | Sprints 6, 9 |
| QA | Continuous; completed in Sprint 11 |
