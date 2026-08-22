# TRUEFORGE FIT ANALYSIS

_Last updated: 2026-08-22 · Decision doc. Compares EDITH (`/Users/markvelasquez/orca/edith-cli`) against TrueForge upstream (`github.com/truefoundry/trueforge`, cloned read-only at `~/orca/reference/trueforge`, `@0.1.4`). Every row is backed by file evidence from `CURRENT-AGENT-ARCHITECTURE.md` and the TrueForge source audit._

> **Primary question:** _Should TrueForge become the runtime underneath EDITH, or does EDITH already contain enough equivalent infrastructure that adopting TrueForge would create unnecessary duplication?_
>
> **Short answer:** EDITH does **not** contain an equivalent runtime. What EDITH calls a "runtime" is a regex intent-router with LLM text-synthesis and no session persistence, no model tool-calling, no context management, no subagents, no sandbox, and no skills — with a second, fully **dead** runtime (`src/runtime/*`) alongside it. TrueForge implements exactly that missing layer, at STABLE maturity. Adoption is therefore **not** duplication — it is filling a gap. **But** TrueForge does not replace EDITH's two genuinely differentiated assets — **local-first egress governance** and its **local-first / personal-context posture** — and it arrives as a **server + SPA** with heavier infra. The recommendation is **Option A (TrueForge as runtime under EDITH), executed as a staged migration**, with EDITH's governance re-expressed as a policy layer around TrueForge, not discarded.

---

## 1. TrueForge maturity snapshot (verified in source, not README)

| Capability | Maturity | Evidence |
| --- | --- | --- |
| Agent execution loop (FSM, `iterationLimit` 25, Vercel AI `streamText`, parallel tools) | **STABLE** | `trueforge-core/src/core/runtime/AgentThread.ts`, `core/llm/VercelAILLM.ts` |
| Session persistence (Kysely; SQLite `better-sqlite3` WAL / Postgres `pg`) | **STABLE** | `db/sqlite/client.ts`, `db/postgres/client.ts`, `*session_store*` migrations |
| Context management + **compaction** (50k-token trigger, structured summary) | **STABLE** | `core/capabilities/builtins/ContextCompaction.ts` |
| Deferred tool loading (4 meta-tools, avoids premature OAuth) | **STABLE** | `core/runtime/DeferredTool.ts` |
| Large-result offloading (to sandbox, preview + path) | **STABLE (needs sandbox)** | `core/...large_tool_response` |
| MCP: streamable-http/SSE, tool selector policy | **STABLE** | `core/mcp/remoteMcpClient.ts`, `ToolSelectorPolicy.ts` |
| MCP auth: header + **OAuth DCR/PKCE**, in-chat auth | **IMPLEMENTED** | `packages/trueforge/src/mcp/auth/mcpDcr.ts`, `apis/mcpOAuth.ts` |
| Skills (git-backed `SKILL.md`, progressive disclosure) | **IMPLEMENTED (needs sandbox)** | `core/sandbox/skills/SkillMounter.ts` |
| Tool approvals / HITL / ask-user / **Generative UI** | **STABLE** | `agent-session/builtinsFromSpec.ts`, `builtins/AskUserQuestion.ts`, `builtins/OpenUI.ts` |
| Sandbox — **Daytona** (cloud) | **STABLE (catalog default)** | `DaytonaProvider.ts`, `sandbox-catalog.yaml` |
| Sandbox — **Local** (seatbelt/seccomp) | **IMPLEMENTED, probe-gated, ahead of docs** | `sandbox/local/provider/LocalSandboxProvider.ts` (`isSupported()` in `main.ts`) |
| Subagents (one level, isolated context) | **STABLE** | `core/capabilities/builtins/DynamicSubAgents.ts` |
| Streaming (resumable SSE, Redis fan-out when hosted) | **STABLE** | `apis/turns.ts`, `runtime/event-subscription/redis.ts` |
| HTTP API (`/api/v1`, OpenAPI, Swagger) | **STABLE** | `packages/trueforge/src/app.ts`, `routes/*` |
| TypeScript SDK (Fern-generated, Bearer, SSE helpers) | **STABLE** | `packages/trueforge-sdk/src/Client.ts` |
| UI (React 19 + Vite SPA on assistant-ui; 4 themes/layouts) | **STABLE** | `packages/frontend`, `packages/trueforge-ui` |
| Model routing; **local models via `custom` OpenAI-compatible** | **routing STABLE; local models IMPLEMENTED, unit-tested, undocumented, no e2e** | `core/llm/VercelAILLM.ts` (`compatibleModel`), `tests/unit/apis/modelProviders.test.ts` (`localhost:11434`) |
| Auth (OIDC PKCE; standalone = no-auth localhost) | **STABLE** | `packages/trueforge/src/auth/middleware.ts` |
| Secrets at rest | **⚠ NO encryption** — plaintext in SQLite/Postgres | audit §12 (`crypto` used only for PKCE) |
| Tracing (OpenTelemetry instrumented) | **IMPLEMENTED but exporter-less OOTB** | `core/tracing/*` |
| Retries | **Targeted only** (MCP/sandbox/NATS); **no global LLM retry** | audit §13 |
| Automatic per-turn model selection | **PLANNED** | `docs/roadmap.mdx` |

**Hard constraints TrueForge imposes:** Node **≥22.14** (native `better-sqlite3` v13), **pnpm** workspace, and — for skills / large-result offload / Code Mode — a **sandbox** (cloud Daytona by default; local sandbox is experimental/opt-in).

---

## 2. Capability-by-capability comparison

Legend for **Fit**: `REPLACES` (TF should own it) · `COMPLEMENTS` (TF adds, EDITH keeps a role) · `DUPLICATES` (both do it; pick one) · `DOES NOT APPLY` · `NOT YET VERIFIED`.

| Capability | EDITH implementation | TrueForge implementation | Overlap | Better owner | Migration cost | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| **Agent execution loop** | Regex router + hardcoded handlers; LLM synthesis only; no model tool-calling (`native/agent-core.js:155,228,828`) | FSM loop, 25-step, parallel tools (`AgentThread.ts`) | Low (different paradigms) | **TrueForge** | High (rewrite routing→loop) | **REPLACES** |
| **Session persistence** | `SessionStore` JSON — **orphaned/dead**; live path is in-memory 24-msg (`runtime/session.js`, `agent-core.js:29`) | Kysely SQLite/Postgres, turns/threads/events (`db/*`) | None (EDITH has none live) | **TrueForge** | Low–Med | **REPLACES** |
| **Conversation state** | In-memory array, pruned (`agent-core.js:932`) | Append-only context log, copy-on-fork (`AgentThread.ts`) | Low | **TrueForge** | Med | **REPLACES** |
| **Context compaction** | None | 50k-token structured summary (`ContextCompaction.ts`) | None | **TrueForge** | Low | **REPLACES (net-new)** |
| **MCP discovery/exec** | Client + 1 self server, 3 read-only tools, allowlist (`mcp/*`) | Remote http/SSE, selector policy, deferred loading | Partial | **TrueForge** | Med | **REPLACES + MIGRATE** |
| **MCP authentication** | None (self server only) | Header + OAuth DCR/PKCE, in-chat (`mcp/auth/*`) | None | **TrueForge** | Low | **REPLACES (net-new)** |
| **Skills / SKILL.md** | **None in repo** | Git-backed, sandbox-mounted (`SkillMounter.ts`) | None | **TrueForge** | Med (needs sandbox) | **COMPLEMENTS (net-new)** |
| **Tool registry** | 3 disjoint surfaces, hand-synced (`tools/registry.js`, `native/*-tools.js`, `mcp/server.js`) | Unified builtins + MCP tools + selector policy | Med | **TrueForge** | Med | **REPLACES + CONSOLIDATE** |
| **Tool approvals / HITL** | Policy prose + confirmation gating; not a live approval protocol in the loop | `ToolApprovalRequiredEvent` allow/deny, persisted (`builtinsFromSpec.ts`) | Low | **TrueForge** | Low | **REPLACES** |
| **Sandbox execution** | None (delegates to Codex/OpenCode subprocess sandboxes) | Daytona (cloud) STABLE; Local experimental | None | **TrueForge (local mode)** | Med–High | **COMPLEMENTS (guarded)** |
| **Subagents** | None (delegates to external CLIs instead) | `create_sub_agent`, isolated (`DynamicSubAgents.ts`) | None | **TrueForge** | Low | **COMPLEMENTS (net-new)** |
| **Streaming** | Provider `streamChat` → terminal; repetition guard (`agent-core.js:839`) | Resumable SSE, Redis fan-out (`apis/turns.ts`) | Partial | **TrueForge** | Low | **REPLACES** |
| **CLI interface** | `bin/edith.js` + native cockpit TUI | `--port`/`--help` server launcher only | None (roles differ) | **EDITH** | n/a | **KEEP (EDITH)** |
| **HTTP API** | None | `/api/v1` OpenAPI (`app.ts`) | None | **TrueForge** | Low | **COMPLEMENTS (net-new)** |
| **SDK** | None | Fern TS client (`trueforge-sdk`) | None | **TrueForge** | Low | **COMPLEMENTS (net-new)** |
| **UI** | Terminal TUI (`ui/terminal.js`, `native/cockpit-view.js`) | React SPA + embeddable UI SDK | Low (TUI vs web) | **EDITH (TUI) / TF (web opt.)** | n/a | **KEEP + optional COMPLEMENT** |
| **Model routing — cloud** | LM Studio/Ollama/NVIDIA direct REST (`providers/*`) | Vercel AI adapters (openai/anthropic/google/…) | Med | **TrueForge** | Med | **REPLACES** |
| **Model routing — LOCAL** | First-class (`lm-studio`, `ollama`) | `custom` OpenAI-compatible base_url (unit-tested vs Ollama; **undocumented, no e2e, no catalog preset**) | Med | **TrueForge (conditionally)** | Med + **validation** | **REPLACES if POC passes** |
| **Egress / data governance** | `routing/*` — DataClass, egress policy, SECRET-never-leaves, PUBLIC-only cloud, sanitization | **None** | None | **EDITH** | n/a | **KEEP (EDITH-owned)** |
| **Auth (Google/personal)** | OAuth PKCE + **macOS Keychain** (`auth/*`) | OIDC (server login); MCP OAuth; **no keychain, no at-rest encryption** | Low (different purpose) | **EDITH** | n/a | **KEEP (EDITH)** |
| **Secrets at rest** | macOS Keychain (`token-store.js`) | Plaintext in DB (**⚠ regression**) | None | **EDITH** | n/a | **KEEP (EDITH)** |
| **Personal-context connectors** | Google/GitHub/GitLab read-only (`context/*`) | Not built-in (would be MCP servers) | None | **EDITH (or as MCP)** | Med | **KEEP / re-expose as MCP** |
| **External coding agents** | Claude/Codex/OpenCode subprocess (`agents/*`) | Not its job (TF runs its own loop) | None | **EDITH** | n/a | **KEEP (EDITH)** |
| **Logging/audit** | `audit.js` append + redaction | Winston structured + OTel spans | Med | **TrueForge** | Low | **CONSOLIDATE** |
| **Observability/tracing** | None | OTel instrumented (exporter-less OOTB) | None | **TrueForge** | Low | **COMPLEMENTS (net-new)** |

---

## 3. What TrueForge does NOT replace (must be preserved)

1. **EDITH identity, CLI, and native cockpit TUI** — the product surface. TrueForge's UI is a web SPA; EDITH's is a terminal. Keep EDITH's.
2. **Local-first egress governance** (`src/routing/*`) — DataClass classification, `egressDecision`, SECRET-never-leaves, PUBLIC-only-to-cloud, `sanitizeExternalPayload`. **TrueForge has no equivalent.** This is EDITH's core privacy differentiator and must wrap TrueForge's model/tool selection.
3. **macOS Keychain secret storage** — TrueForge stores secrets **unencrypted** in its DB. EDITH's Keychain-backed Google tokens are a security regression if moved into TrueForge's store. Keep EDITH's auth/token layer.
4. **External coding-agent delegation** (Claude Code / Codex / OpenCode) — different role (software-engineering agents), correctly kept as subprocess specialists. TrueForge should **not** try to replace them.
5. **Read-only personal-context connectors** — either kept in EDITH or re-exposed to TrueForge as MCP servers; the read-only, credential-separated posture must survive.

> **Architecture principle honored:** do not make TrueForge replace Claude Code, Codex, or OpenCode merely because it exists. Those are engineering agents; TrueForge is the runtime; EDITH is the product/identity.

---

## 4. Option evaluation

### Option A — TrueForge becomes EDITH's runtime ✅ (recommended, staged)
EDITH keeps identity/CLI/voice/commands/workflows/**egress governance**/**Keychain auth**/personal-context/external-agent delegation. TrueForge owns agent loop, sessions, context/compaction, tools, skills, approvals, subagents, sandbox, streaming, model execution.

- **Pros:** fills every runtime gap with STABLE code; deletes EDITH's dead runtime and unifies tool/session/streaming; gains sessions, compaction, subagents, real MCP+OAuth, skills, approvals for free; SDK gives EDITH a clean client boundary.
- **Cons/risks:** local models only lightly supported in TF (must validate); egress governance must be re-expressed as a layer in front of TF (non-trivial — see below); adds a local server process + Node 22.14 + native module; secrets-at-rest and sandbox-default-cloud need mitigation.
- **The governance integration crux:** EDITH's egress policy decides *which processor* may see *which data class*. Under Option A, EDITH must remain the **policy decision point**: it classifies the request, then either (a) selects the TF agent/model whose provider is local vs cloud, and/or (b) sanitizes payloads before handing the turn to TF. TF's per-agent single-model design maps cleanly onto "local agent" vs "public-research agent" — EDITH picks which TF agent to invoke based on DataClass. This keeps **one** orchestration layer (TF) while EDITH stays the governor.

### Option B — EDITH remains the runtime, borrow ideas only ❌
Keep the regex router; cherry-pick concepts (compaction, sessions) and hand-build them.
- **Pros:** no new infra, stays lean/local, no Node/pnpm/server change.
- **Cons:** re-implements from scratch what TF ships STABLE (sessions, compaction, MCP OAuth, subagents, skills, approvals) — years of work; the regex router remains a capability ceiling; leaves the dead `runtime/*` and the fragmentation untouched unless separately cleaned. **Rejected** unless the POC shows local models can't work through TF.

### Option C — Hybrid (two runtimes) ❌
EDITH keeps its loop for some routes; TF owns others.
- **Cons:** this is the explicitly-warned failure mode — **two session systems, two tool registries, two model routers**. EDITH already suffers from duplication; adding TF as a *parallel* runtime multiplies it. **Rejected.**
- **Note:** "EDITH governs, TF executes" is **not** Option C — it is Option A with a single runtime (TF) and a single governor (EDITH). The distinction is that EDITH must **not** keep its own competing agent loop/session store.

---

## 5. Decision

**Adopt Option A via staged migration, gated on a local-model POC.** EDITH becomes a **client + governor** of a local TrueForge runtime. The regex router and the dead `runtime/*` are retired once TF owns the loop and sessions. EDITH's egress governance and Keychain auth are preserved as the policy/credential layer around TF.

**Gate:** Stage A POC must prove local-first inference works end-to-end through TrueForge against Ollama/LM Studio. If it fails and can't be made to work, fall back to **Option B** (keep EDITH runtime, still do the non-TrueForge cleanup in `CLEANUP-PLAN.md`).

---

## 6. FINAL ANSWER — gain / lose / disappear

> _If we removed the custom EDITH orchestration code tomorrow and put TrueForge underneath EDITH, exactly what would we gain, lose, and what code could disappear?_

**We would GAIN (all STABLE upstream, today):**
- A real model-driven agent loop with parallel tool-calling (vs regex routing).
- Durable sessions (SQLite locally) — EDITH currently persists **nothing**.
- Context compaction, deferred tool loading, large-result offloading.
- Subagents, resumable streaming, tool approvals / ask-user / generative UI.
- Real MCP with OAuth (DCR/PKCE) and in-chat auth — vs EDITH's single read-only self-server.
- Git-backed skills.
- An HTTP API + typed SDK (clean client boundary for the cockpit) and an optional web UI.
- Structured logging + OTel tracing hooks.

**We would LOSE / put at risk (must be mitigated, not removed):**
- **Egress governance** — TF has none; must be re-implemented as a policy layer in front of TF or it's a privacy regression.
- **Keychain secret storage** — TF stores secrets **plaintext in its DB**; keep EDITH's Keychain layer.
- **Lean footprint** — from 2 runtime deps to a server + native `better-sqlite3` + Node ≥22.14 + pnpm.
- **Local-first sandbox** — TF's default sandbox is **cloud Daytona**; local sandbox is experimental. Skills/Code-Mode/large-result-offload depend on a sandbox.
- **Local-model certainty** — supported only via the undocumented `custom` provider; needs the POC to de-risk.

**Code that could DISAPPEAR after migration (with evidence):**
| Delete candidate | Why | Evidence |
| --- | --- | --- |
| `src/runtime/agent.js`, `src/runtime/session.js`, `src/runtime/context.js` | Already **dead** (no non-test importer); TF owns runtime+sessions | grep: only tests import them |
| `src/native/agent-core.js` `route()` + `executePlan()` + `answer*` handlers | Replaced by TF agent loop | `agent-core.js:155-826` |
| `src/routing/planner.js`, `processor-registry.js` (processor selection) | TF selects/executes models; EDITH keeps only the **egress decision** | `routing/*` |
| Duplicate tool surfaces `src/tools/registry.js` catalog + `mcp/server.js` tools | Unified under TF tools/builtins | §10 of current-arch |
| `src/providers/index.js` router | TF model routing replaces it (LM Studio/Ollama become TF `custom` providers) | `providers/*` |
| One of the two Google REST stacks; 4→1 secret-redaction helpers | Consolidation (independent of TF) | inventory |

**Code that must STAY:** `src/routing/request-analysis.js` + `egress-policy.js` (governance), `src/auth/*` (Keychain), `src/agents/*` (external CLIs), `src/context/connectors/*` (or re-exposed as MCP), `bin/edith.js` + cockpit TUI (identity/UX).

See `TARGET-AGENT-ARCHITECTURE.md` for the end state and `CLEANUP-PLAN.md` for the ordered SAFE-TO-REMOVE / MIGRATE-FIRST / KEEP / INVESTIGATE list.
