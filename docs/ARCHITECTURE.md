# EDITH Architecture

_Last updated: 2026-08-22 — reflects the TrueForge-backed product shipped by the E2E build (the regex-router architecture this document previously described was retired in the same build)._

EDITH is a local-first AI coding agent and assistant. The product is one command:

```bash
$ edith
```

EDITH owns and hides all of its machinery — the TrueForge runtime, model providers, the capability service, session databases, and tool registries are internal.

## Core Flow

```text
                         USER
                           │
                           ▼
                ┌─────────────────────┐
                │        EDITH        │  src/app/            product UX (single pane)
                │                     │  src/routing/        governance (classify → egress)
                │  UX · governance ·  │  src/sessions/       session index (titles, recency)
                │  approvals · keys   │  src/workspace/      workspace awareness
                └──────────┬──────────┘  src/runtime/        supervisor · client · events
                           │
                           ▼
                ┌─────────────────────┐
                │      TrueForge      │  supervised child process, standalone,
                │  agent loop ·       │  SQLite under ~/.edith/runtime,
                │  sessions · context │  loopback only ([::1]/127.0.0.1)
                │  compaction ·       │
                │  approval protocol  │
                └──────────┬──────────┘
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          MODELS         TOOLS       SPECIALISTS
        Ollama         EDITH capability   Claude Code
        LM Studio      service (loopback  Codex
        OpenAI-compat  streamable-http    OpenCode
        NVIDIA (proxy) MCP, 19+ tools)    (subprocess adapters)
```

## Major Subsystems

### Runtime ownership (`src/runtime/`)

- `supervisor.js` — detects, adopts, starts, health-checks, restarts, and shuts down the TrueForge server. Users never manage it. State in `~/.edith/runtime/state.json`; logs in `~/.edith/logs/trueforge.log`. Handles TrueForge's `[::1]`-only bind by probing both loopback hosts.
- `client.js` — typed HTTP client for the TrueForge API (providers, agents, sessions, streaming turns via SSE, cancel).
- `models.js` — discovers what is actually serving (Ollama, LM Studio, generic OpenAI-compatible endpoints), builds TrueForge provider manifests, and maps model classes (`local-fast`, `local-reasoning`, `coding`, `cloud-reasoning`) onto concrete models.
- `model-proxy.js` — loopback key-injection proxy: authenticated providers are registered against this proxy so API keys are injected per-request from EDITH's environment/Keychain and **never enter TrueForge's plaintext persistence**.
- `events.js` — normalizes raw TrueForge turn events into EDITH's product event model (`THINKING / STREAMING / TOOL_RUNNING / WAITING_APPROVAL / COMPLETED / FAILED / CANCELLED`), including accumulation of streamed tool-call argument chunks.
- `agent-session.js` (`EdithRuntime`) — the orchestrator: provisions providers/agents, opens sessions, runs turns with streaming, drives the approval-resume protocol, and cancels cleanly. Sets context-compaction thresholds from the model's real context window.

### Governance (`src/routing/`)

EDITH remains the policy decision point. Every turn is classified (`request-analysis.js`) and gated (`egress-policy.js`) **before** it reaches the runtime: SECRET data never leaves local execution; cloud agents receive only PUBLIC-classified, sanitized payloads. TrueForge executes inside these boundaries.

### Capability service (`src/capability/`)

TrueForge's MCP client is remote-transport only, so EDITH serves its tools over a loopback-only streamable-http MCP service (`server.js`). `toolset.js` defines the coding-agent tools — list/read/search, git, create/edit/write/move/delete, shell, tests/lint/typecheck — each with a safety class:

- `READ` — auto-runs
- `WRITE` — follows policy (`--strict` gates these too)
- `DESTRUCTIVE` — always requires human approval (enforced through TrueForge's per-tool approval protocol; destructive shell commands are split into a dedicated gated tool)

All paths are confined to the workspace; secret-bearing paths are refused; outputs are redacted and bounded.

### Product UX (`src/app/`)

- `edith-app.js` — the interactive single-pane app: compact header (workspace · branch · local/cloud · model), `●` activity lines, streamed answers, y/N approval prompts, Ctrl+C cancels the turn (never the session), automatic runtime recovery, `/help /model /sessions /new /skills /tools /status /context /details /verbose /doctor /exit`.
- `turn-view.js` — renders normalized events; compact tool summaries (match counts, `$ cmd` blocks, line deltas), friendly errors with remediation, `/details` for full output.
- `headless.js` — `edith run -p "<task>"`: one agent turn for scripts/CI (JSONL events + result envelope with `--json`; destructive tools denied unless `--approve-all`; exit codes 0/1/2/124).

### Sessions (`src/sessions/`) and workspace (`src/workspace/`)

TrueForge persists conversations (turns, events, compaction) in SQLite; EDITH's `SessionStore` keeps product metadata — titles, workspace association, recency — powering `edith --continue`, `edith --resume <id>`, and `edith sessions`. `workspace.js` detects repo root, branch, dirty state, project profile, commands, and workspace instructions (`EDITH.md`/`AGENTS.md`/`CLAUDE.md`), producing a bounded context block; anything deeper is retrieved by the agent through tools.

### Skills (`src/skills/`, `skills/`)

`SKILL.md` files in three tiers — core (shipped), user (`~/.edith/skills`), workspace (`.edith/skills`) — with name shadowing. Instructions list only name+description; bodies load on demand via the `read_skill` tool. The format matches TrueForge's skill system for a later migration to sandbox-mounted skills.

### Specialists (`src/agents/`)

Claude Code, Codex, and OpenCode remain subprocess specialists. The agent can delegate self-contained deep tasks through the `delegate_specialist` capability tool; power users retain direct access (`edith ask …`, `edith code`).

### Preserved EDITH-owned layers

Keychain-backed auth (`src/auth/`), personal-context connectors (`src/context/`, read-only), network policy (`src/network/`), audit log, and secret redaction (`src/security/redact.js`) are unchanged and deliberately outside TrueForge.

## Diagnostics and observability

- `edith doctor` — runtime install/health, session DB, local providers and model capability, cloud posture, workspace, tools, skills, sessions, specialists, auth; every failure carries a fix.
- `~/.edith/logs/edith.jsonl` — per-turn telemetry (model, duration, tool/approval counts, outcome), secret-redacted.
- `edith runtime status|stop|restart` — manual runtime control when needed.

## Acceptance status

See `qa/EDITH-E2E-PRODUCT-GATE.md` (final assessment 2026-08-22: 33 PASS, 1 credentials-blocked PARTIAL) and `product/EDITH-PRODUCT-MATURITY.md`. Historical architecture audits under `architecture/` describe the pre-build system and are retained as decision records.
