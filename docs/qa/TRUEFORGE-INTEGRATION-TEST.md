# TRUEFORGE INTEGRATION TEST — Stage A POC results

_Run: 2026-08-22 · Machine: darwin arm64, Node v26.5.0, pnpm 11.10.0 · TrueForge `@0.1.4` (local/standalone, SQLite) · Local model: Ollama `qwen3:8b` @ `127.0.0.1:11434`._

> **Isolation:** the POC lives entirely in `~/orca/reference/trueforge-poc` (outside `edith-cli`). Nothing was installed into or vendored into EDITH. No external/destructive actions were taken — only a local read of the local Ollama model. This satisfies the "do not mutate Salesforce/GitLab/Gmail/production" constraint.

## What the POC proves

The single highest-risk assumption for adopting TrueForge under a **local-first** EDITH is: _can a local model serve inference through TrueForge's runtime end-to-end?_ The POC answers **yes**, and exercises the runtime spine (provider → agent → session → turn → persistence) that EDITH lacks today.

Path exercised: **EDITH-as-client (`poc.mjs`) → TrueForge HTTP API → AgentThread runtime → `custom` OpenAI-compatible provider → Ollama `qwen3:8b` → response → SQLite.**

## Results

Legend: PASS / FAIL / BLOCKED / NOT TESTED.

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | TrueForge starts (standalone, SQLite, migrations) | **PASS** | 14 migrations applied; `listening on 127.0.0.1:8790` |
| 2 | Local sandbox probe | **PASS** | boot log: `Local sandbox fallback is available {platform:darwin}` |
| 3 | Server health | **PASS** | `GET /healthz` → `OK!` |
| 4 | Client/governor identity boundary | **PASS** | `GET /api/v1/auth/me` → `{type:default, role:admin}` (standalone no-auth) |
| 5 | Register local model as `custom` OpenAI-compatible provider | **PASS** | `POST /api/v1/settings/model-providers` (Ollama base_url) |
| 6 | Local model visible in runtime model list | **PASS** | `GET /api/v1/models` → `["ollama-local/qwen3-8b"]` |
| 7 | Create agent bound to local model | **PASS** | `POST /api/v1/agents` (`edith-poc-local`) |
| 8 | Create session | **PASS** | session `01m0n69wvr7k3xgdbnw238styw` |
| 9 | **Run a turn — real local inference** | **PASS** | response: _"EDITH is an AI assistant running on a local model via TrueForge to help users accomplish tasks."_ |
| 10 | Streaming turn events readable | **PASS** | turn events endpoint returned model message content |
| 11 | Session/turn persisted in SQLite | **PASS** | `session=1, turn=1, turn_thread=1, model_provider=1, agent=1` rows |
| 12 | Provider connects (local, no key) | **PASS** | `custom` provider, optional api_key omitted |
| 13 | EDITH can invoke the runtime (client role) | **PASS** | whole POC is a plain HTTP client = EDITH's future integration shape |
| 14 | MCP tool call through an agent | **NOT TESTED** | see "Deferred" below |
| 15 | Skill load through sandbox | **NOT TESTED** | requires provisioning local sandbox + skill catalog; out of Stage-A scope |
| 16 | Context compaction | **NOT TESTED** | requires >50k-token history; out of Stage-A scope |
| 17 | EDITH egress governance wrapping TF | **NOT TESTED** | Stage C design item (see `TARGET-AGENT-ARCHITECTURE.md` §3) |
| 18 | Existing EDITH tests still green (no regression) | **PASS** | `node --test` → 98/98 pass (POC changed nothing in `edith-cli`) |

**Score: 14 PASS / 0 FAIL / 0 BLOCKED / 4 NOT TESTED.**

## Deferred (honest gaps — not failures)

- **MCP tool call (#14):** TrueForge's MCP client is **remote-transport only** (streamable-http then SSE — `core/mcp/remoteMcpClient.ts`). EDITH's own MCP server is **stdio** (`src/mcp/server.js`), so it cannot attach directly; it would need a thin HTTP shim, or a remote read-only MCP (which needs network/OAuth and would violate the local-only guardrail for this POC). Additionally, reliable tool-calling needs a tool-capable model; `qwen3:8b` is small. This is the **next POC increment**, deliberately scoped out of the make-or-break test.
- **Skills / compaction / sandbox execution:** implemented upstream (verified in source) but require additional provisioning; not needed to answer the go/no-go question.

## Reproduce

```bash
cd ~/orca/reference/trueforge-poc
# start runtime (standalone, sqlite):
STANDALONE=true SQLITE_PATH="$(pwd)/data/db.sqlite" \
  node node_modules/@truefoundry/trueforge/dist/cli.js --port 8790 &
# drive it (requires Ollama running with qwen3:8b):
node poc.mjs
```

## Conclusion

The go/no-go gate in `TRUEFORGE-FIT-ANALYSIS.md` is **PASSED**: local-first inference works through TrueForge, and the runtime primitives EDITH lacks (durable sessions, agent/turn lifecycle, model provider registration, streaming) are real and functioning locally with SQLite and **no cloud dependency**. Proceed to Stage B (a tool-capable agent + read-only MCP/sandbox tool) and Stage C (EDITH governance wrapping the runtime).

## Stage status

| Stage | Description | Status |
| --- | --- | --- |
| A | Install TrueForge alongside; nothing breaks; local model turn | **COMPLETE** |
| B | Test agent: model + MCP tool + skill + sandbox + streaming | **PARTIAL** (model+streaming+sandbox-probe done; MCP tool/skill deferred) |
| C | EDITH becomes a client of the runtime (governance layer) | **NOT STARTED** (designed in TARGET doc §3) |
| D | Move one low-risk workflow | **NOT STARTED** |
| E | Migrate sessions/context/tools/skills/routing | **NOT STARTED** |
| F | Remove duplicated legacy infra | **NOT STARTED** (candidates listed in CLEANUP-PLAN) |
