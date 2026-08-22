# AGENT SYSTEM INVENTORY

_Last updated: 2026-08-22 · Every component in `/Users/markvelasquez/orca/edith-cli` that touches agents/models/tools/state, with an Active/Duplicate/Disposition judgment. Evidence in `CURRENT-AGENT-ARCHITECTURE.md`._

## Legend
- **Active?** Yes = wired into the shipping `edith` binary · No = dead/orphaned · Dev = tests/dev only.
- **Disposition:** KEEP · REPLACE (by TrueForge) · CONSOLIDATE · REMOVE · INVESTIGATE.

## Components

| Component | Purpose | Location | Active? | Used by | Duplicate? | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| CLI entry | Command dispatch | `bin/edith.js`, `src/cli.js` | Yes | user | No | **KEEP** |
| Native cockpit (real runtime) | Regex router + handlers + LLM synthesis | `src/native/agent-core.js` | Yes | `native` cmd | No | **REPLACE** loop; keep identity/UX shell |
| Native cockpit UI | TUI render/input | `src/native/cockpit-view.js`, `input-composer.js`, `progress-renderer.js`, `interactive-cli.js` | Yes | cockpit | No | **KEEP** |
| **Legacy runtime** | Plan→execute→respond loop | `src/runtime/agent.js` | **No (orphaned)** | tests only | Yes (of cockpit) | **REMOVE** |
| **Legacy session store** | JSON persistence `~/.edith/sessions` | `src/runtime/session.js` | **No (orphaned)** | tests only | Yes (unused) | **REMOVE** (TF owns sessions) |
| **Legacy context** | Conversation context for legacy runtime | `src/runtime/context.js` | **No (orphaned)** | tests only | Yes | **REMOVE** |
| Provider router | Local/cloud model routing | `src/providers/index.js` | Yes | cockpit, chat, ask | Partial (vs opencode.local.json) | **REPLACE** (TF model routing) |
| LM Studio provider | Local inference client | `src/providers/lm-studio.js` | Yes | router | Yes (opencode.local.json) | **CONSOLIDATE** → TF `custom` provider |
| Ollama provider | Local inference client | `src/providers/ollama.js` | Yes | router | Yes (opencode.local.json) | **CONSOLIDATE** → TF `custom` provider |
| NVIDIA provider | Cloud inference (PUBLIC-only) | `src/providers/nvidia.js` | Yes | router, egress | No | **REPLACE** (TF provider) — keep egress gate |
| Egress/governance | Data classification + egress policy | `src/routing/request-analysis.js`, `egress-policy.js` | Yes | cockpit | No | **KEEP** (EDITH-owned, TF has none) |
| Planner / processor registry | Processor selection | `src/routing/planner.js`, `processor-registry.js` | Yes | cockpit | Partial | **REPLACE** selection; keep egress decision |
| Agent registry + adapters | Delegate to Claude/Codex/OpenCode | `src/agents/registry.js`, `claude.js`, `codex.js`, `opencode.js`, `process.js` | Yes | cockpit, `ask` | No | **KEEP** (specialist SE agents) |
| MCP client | Call MCP servers (allowlisted) | `src/mcp/client.js` | Yes | `mcp` cmd | Partial (TF MCP) | **REPLACE** (TF MCP) |
| MCP registry | Server config | `src/mcp/registry.js` | Yes | mcp client | Yes (4 registries) | **CONSOLIDATE** |
| EDITH MCP server | Expose 3 read-only tools | `src/mcp/server.js` | Yes | external MCP clients | No | **KEEP** (or re-expose via TF) |
| Tool catalog | Tool metadata/risk | `src/tools/registry.js` | Yes | `tools list`, prompts | Yes (3 surfaces) | **CONSOLIDATE** → TF tools |
| Tool impls | Filesystem/git/time/system | `src/native/workspace-tools.js`, `system-tools.js` | Yes | cockpit | Yes (vs catalog) | **CONSOLIDATE** → TF tools |
| Tool policy/path/diff | Risk taxonomy, path guard | `src/tools/policy.js`, `path.js`, `diff.js` | Yes | tools | No | **KEEP** (guard logic) |
| Context connectors | Google/GitHub/GitLab read-only | `src/context/connectors/*` | Yes | cockpit | No (but 2 Google stacks) | **KEEP**; unify Google stacks; optionally expose as MCP |
| Context engine/briefing | Normalize + synthesize context | `src/context/query-engine.js`, `briefing.js`, `models.js`, `registry.js` | Yes | cockpit | No | **KEEP** |
| Auth (Google OAuth) | PKCE loopback OAuth | `src/auth/google-oauth.js`, `google-scopes.js`, `registry.js`, `action-policy.js`, `errors.js` | Yes | `auth` cmd, connectors | No | **KEEP** (TF has no equiv) |
| Token store | macOS Keychain | `src/auth/token-store.js` | Yes | auth | No | **KEEP** (TF stores plaintext) |
| Network providers | Web search/fetch/weather/docs | `src/network/providers.js`, `policy.js` | Yes | cockpit | No | **KEEP** (or expose as MCP) |
| Audit log | Append-only audit + redaction | `src/audit.js` | Yes | many | Partial (6 redactors) | **CONSOLIDATE** redaction; keep audit |
| Config | Layered config + defaults | `src/config.js` | Yes | most | Yes (model config sprawl) | **KEEP** + make canonical source |
| Doctor | Diagnostics | `src/doctor.js` | Yes | `doctor` cmd | No | **KEEP** |
| `opencode.local.json` | OpenCode model/provider/permission config | repo root | Yes | OpenCode subprocess | Yes (dup of providers) | **INVESTIGATE** → generate from EDITH config |
| Tests | Unit/behavior | `test/*` | Dev | CI | Some test dead code | **KEEP**; drop tests for removed `runtime/*` |

## Duplication register (the technical-debt list)

| # | Duplicated thing | Locations | Can diverge? | Fix |
| --- | --- | --- | --- | --- |
| D1 | **Two runtimes** | `native/agent-core.js` (live) vs `runtime/*` (dead) | n/a (one dead) | Remove `runtime/*` |
| D2 | **Local model + provider config** | `config.js`, `providers/lm-studio.js`, `providers/ollama.js`, `opencode.local.json`, `.env.example`, `agents/opencode.js`, `mcp/server.js` | **Yes (HIGH)** | Single canonical config → derive others |
| D3 | **Provider-ID namespaces** | EDITH `lm-studio`/`ollama` vs OpenCode `lmstudio-local`/`ollama-local`; bridge field `openCodeProviderId` is **never read** | **Yes** | One mapping, actually consumed |
| D4 | **MCP registries** | EDITH `config.mcp`, `~/.claude.json`, `~/.codex/config.toml`, `./.mcp.json` | **Yes** | Canonical MCP registry (see MCP-INVENTORY) |
| D5 | **Session notions** | orphaned `SessionStore`, in-memory cockpit, OpenCode sessions, stateless Claude/Codex | **Yes (guaranteed)** | TF single session store |
| D6 | **Tool surfaces** | `tools/registry.js`, `native/*-tools.js`, `mcp/server.js` | **Yes (MED)** | One tool source → TF |
| D7 | **Secret-redaction regex** | `connectors/process.js`, `auth/token-store.js`, `native/workspace-tools.js`, `routing/egress-policy.js`, `runtime/session.js`, `audit.js` | **Yes** | One shared redactor |
| D8 | **Google REST client** | `context/connectors/google-base.js#googleFetch` vs `google-calendar.js#googleRequest` | **Yes** | Make Calendar extend `GoogleApiConnector` |
| D9 | **Approved cloud model literal** | `routing/egress-policy.js` + `routing/planner.js` (`'nvidia:z-ai/glm-5.2'`) | **Yes** | One constant |
| D10 | **`local-first` default** | `config.js`, `egress-policy.js`, `.env.example` | Low | One default in config |

## Not present (searched; corrects the original brief)
Salesforce, Slack, HubSpot: **no code in EDITH**. Skills: **no `skills/` dir**. These are candidates to add via TrueForge/MCP, not existing debt.
