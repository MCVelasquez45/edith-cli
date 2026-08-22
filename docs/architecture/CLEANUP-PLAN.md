# CLEANUP PLAN

_Last updated: 2026-08-22 · Ordered, dependency-aware cleanup. Two tiers: **(A) do now — independent of TrueForge**, and **(B) migration-gated — only after the matching TrueForge stage passes**. Nothing here is deleted yet. Evidence in `AGENT-SYSTEM-INVENTORY.md` (duplication register D1–D10)._

## Classification legend
`SAFE TO REMOVE` · `MIGRATE FIRST` · `KEEP` · `INVESTIGATE`

---

## Tier A — cleanup that improves the repo even if TrueForge is never adopted

| # | Item | Classification | Reason | Dependency / risk | Debt ref |
| --- | --- | --- | --- | --- | --- |
| A1 | `src/runtime/agent.js` | **SAFE TO REMOVE** | Orphaned; no non-test importer; superseded by `native/agent-core.js` | Delete `test/*` that only cover it | D1 |
| A2 | `src/runtime/session.js` (`SessionStore`) | **SAFE TO REMOVE** | Orphaned; live path persists nothing; JSON store never used | Update `test/session.test.js` | D1/D5 |
| A3 | `src/runtime/context.js` | **SAFE TO REMOVE** | Orphaned helper for the dead runtime | none | D1 |
| A4 | Unused `openCodeProviderId` bridge field | **INVESTIGATE** | Declared on providers but **never read** — dead bridge between two ID namespaces | Either consume it or delete; decide the canonical mapping | D3 |
| A5 | 6 divergent secret-redaction regex sets | **MIGRATE FIRST** (consolidate) | `connectors/process.js`, `auth/token-store.js`, `native/workspace-tools.js`, `routing/egress-policy.js`, `runtime/session.js`, `audit.js` catch different token formats | Extract one `redactSecrets()`; make all callers use it; add tests **before** deleting the copies | D7 |
| A6 | Two Google REST client stacks | **MIGRATE FIRST** (consolidate) | `google-calendar.js#googleRequest` reimplements `google-base.js#googleFetch` | Make Calendar extend `GoogleApiConnector`; verify calendar tests | D8 |
| A7 | Hardcoded `'nvidia:z-ai/glm-5.2'` in 2 files | **MIGRATE FIRST** (consolidate) | Approved-cloud-model literal duplicated in `egress-policy.js` + `planner.js` | One exported constant | D9 |
| A8 | `local-first` default in 3 places | **INVESTIGATE** | `config.js`, `egress-policy.js`, `.env.example` | Single default in config; others read it | D10 |
| A9 | Model/provider config sprawl (6+ locations) | **INVESTIGATE** | LM Studio/Ollama endpoints + `qwen3-vl-4b` hardcoded across `config.js`, `providers/*`, `opencode.local.json`, `.env.example`, `agents/opencode.js`, `mcp/server.js` | Establish canonical config; derive `opencode.local.json` from it | D2 |
| A10 | Stale docs vs reality | **INVESTIGATE** | `AUDIT_SUMMARY.md` claims "100% VERIFIED infrastructure" but the runtime is a regex router with no live persistence; `docs/architecture/proposed-architecture.md` predates this audit | Reconcile with the new architecture docs; don't duplicate | — |

## Tier B — migration-gated (remove only after the TrueForge stage that replaces it passes its test)

| # | Item | Classification | Replaced by | Gate (must pass first) | Debt ref |
| --- | --- | --- | --- | --- | --- |
| B1 | `native/agent-core.js` `route()` + `executePlan()` + `answer*` handlers | **MIGRATE FIRST** | TF agent loop | Stage C: EDITH drives TF for real requests; parity on core routes | D1 |
| B2 | `src/providers/index.js` router + `lm-studio.js` / `ollama.js` clients | **MIGRATE FIRST** | TF model routing + `custom` providers | Stage A ✅ (POC proved local model via TF) + Stage E model migration | D2 |
| B3 | `src/routing/planner.js`, `processor-registry.js` (processor **selection**) | **MIGRATE FIRST** | TF model/agent selection | Stage C governance layer live | — |
| B4 | Tool catalog `tools/registry.js` + MCP `server.js` tool defs | **MIGRATE FIRST** | TF unified tools/builtins | Stage E tools migrated; parity list green | D6 |
| B5 | `src/mcp/client.js` + `registry.js` (as the primary MCP path) | **MIGRATE FIRST** | TF MCP (remote + OAuth) | Stage B MCP tool call works through TF | D4 |
| B6 | In-memory cockpit history as the state model | **MIGRATE FIRST** | TF sessions (SQLite) | Stage E sessions migrated | D5 |

## KEEP (do not remove — no TrueForge equivalent or different role)

| Item | Why |
| --- | --- |
| `bin/edith.js`, `src/cli.js`, `native/cockpit-view.js` + TUI | EDITH identity/UX |
| `src/routing/request-analysis.js`, `egress-policy.js` (**the egress decision**) | Governance — TF has none |
| `src/auth/*` (Google OAuth + macOS Keychain) | TF stores secrets plaintext |
| `src/agents/*` (Claude/Codex/OpenCode adapters) | Specialist SE agents; different role |
| `src/context/connectors/*`, `query-engine.js`, `briefing.js` | Read-only personal context (unify Google stacks per A6; optionally expose as MCP) |
| `src/network/providers.js`, `policy.js` | Web tools + SSRF guard |
| `src/tools/policy.js`, `path.js` | Risk taxonomy + workspace boundary |
| `src/audit.js` | Authoritative governance/egress audit trail |
| `src/config.js` | Becomes the canonical config source |
| `src/doctor.js` | Diagnostics |

## Execution order (safe, incremental — build/lint/test after each)

1. **A5, A6, A7, A8, A9** — consolidation refactors (no behavior change); run `node --test` (baseline 98/98) after each.
2. **A1–A3** — delete dead `runtime/*` + prune its tests; confirm 98→(98−removed) still green.
3. **A4, A10** — resolve the dead bridge and reconcile docs.
4. **Stage A** (TrueForge alongside) — ✅ already validated in `TRUEFORGE-INTEGRATION-TEST.md`.
5. **Stage B/C** — tool-through-TF + EDITH-governs-TF; then **B5, B1, B3**.
6. **Stage E** — migrate sessions/models/tools; then **B2, B4, B6**.
7. **Stage F** — remove remaining legacy only after each replacement's test is green.

## Dependency-analysis guard (before removing any npm dep)
EDITH has only 3 runtime deps (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `zod`). If MCP moves to TF, `@modelcontextprotocol/*` may become removable — but only after B5 lands and `mcp-server`/`self` exposure is re-homed. Run a static import check (`grep -rn "@modelcontextprotocol"`) and the test suite before dropping either.
