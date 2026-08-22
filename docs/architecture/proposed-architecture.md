# Proposed EDITH Architecture

Date: 2026-08-08
Status: **SUPERSEDED (2026-08-22)** — replaced by `TARGET-AGENT-ARCHITECTURE.md` (product north star + TrueForge runtime plan). Retained for history only; do not use for decisions.

## Evidence-Based Recommendation

EDITH should be a terminal orchestration layer with provider adapters and a strict tool-permission boundary.

```text
EDITH CLI
  |
  |-- Terminal UI
  |-- Session / config / diagnostics
  |-- Provider interface
  |     |-- Ollama adapter
  |     |-- LM Studio adapter
  |     `-- future providers
  |
  |-- Tool policy boundary
        |-- MCP client/router
        |-- future OpenClaw adapter, only after install verification
        `-- shell/filesystem tools, only after approval/audit design
```

## What EDITH Should Own

| Responsibility | Recommendation | Evidence |
| --- | --- | --- |
| Terminal UI | Own | No EDITH CLI exists; existing CLIs are separate products |
| Conversation loop | Own | Needed to route providers and maintain sessions |
| Provider routing | Own | Ollama and LM Studio expose different APIs |
| Model selection | Own metadata/routing; delegate model storage | Ollama/LM Studio already manage model files |
| Streaming | Own normalized interface | Provider streaming protocols differ and need verification |
| Session history | Own EDITH sessions | Avoid coupling to Claude/Codex/LM Studio histories |
| Repository context | Own read/index policy | Existing tools do this, but EDITH needs its own boundaries |
| File operations | Own only behind approval and audit | Security audit requires explicit boundary |
| Diff rendering | Own | Terminal agent UX requirement |
| Shell execution | Own only through approval subsystem | Must not inherit unsafe modes from running tools |
| MCP client | Own routing/policy; delegate server capabilities | Many MCP servers already exist |
| OpenClaw bridge | Defer | OpenClaw not installed |
| Configuration | Own | Must keep provider endpoints, local-only mode, and tool policy explicit |
| Diagnostics | Own | Needed before enabling provider/tool features |

## What EDITH Should Delegate

| Capability | Delegate to | Reason |
| --- | --- | --- |
| Local model storage/downloads | Ollama, LM Studio | Already installed and managing models |
| Local inference execution | Ollama, LM Studio | APIs verified reachable |
| Existing external tool integrations | MCP servers | Multiple configured servers already exist |
| Browser automation | MCP Playwright or future OpenClaw, gated | High-risk; should not be hand-rolled |
| OpenClaw automation | OpenClaw, if installed later | No verified install now; local docs say adapter only |

## Provider Architecture

The provider abstraction fits the verified environment.

```text
interface Provider {
  id
  health()
  listModels()
  getModelMetadata(modelId)
  chat(messages, options)
  streamChat(messages, options)
  supportsTools(modelId)
}
```

Adapter-specific notes:

- Ollama adapter:
  - discovery: `GET /api/tags`
  - health: `GET /api/version`
  - chat: native `/api/chat`
  - model metadata: `details`, `capabilities`
  - stream shape: NDJSON, pending successful verification
- LM Studio adapter:
  - discovery: `/v1/models` plus `/api/v0/models`
  - health: `/v1/models`
  - chat: OpenAI-compatible `/v1/chat/completions`
  - richer state: `/api/v0/models`
  - stream shape: OpenAI-compatible SSE, pending successful verification

## Global `edith` Command Strategy

Recommended future distribution:

1. Node package with a `bin` entry named `edith`, because this machine already uses npm global CLIs from `/opt/homebrew/bin`.
2. Avoid shell aliases and PATH edits.
3. Add Homebrew formula later for native Mac distribution once stable.

Required commands:

```text
edith
edith --help
edith --version
edith models
edith doctor
edith config
edith resume
```

Do not create the global command until implementation is approved.

## Terminal UI Direction

Because Node is verified and already used for Claude/Codex/npm global CLIs, EDITH can reasonably evaluate Node terminal UI libraries in Phase 2.

Candidate categories to investigate without installing during Phase 1:

- CLI command framework: Commander or similar.
- Interactive prompts: Ink, React-based TUI, or lower-level readline/prompt toolkit.
- Markdown rendering: terminal markdown renderer.
- Syntax highlighting and diffs: code highlighter plus unified diff renderer.

No framework is selected in Phase 1.

## Security Architecture

Before agent mode:

- deny-by-default tool access,
- local-only provider mode,
- command approval prompts,
- destructive command detection,
- redacted audit log,
- scoped filesystem roots,
- MCP server allowlists,
- per-tool side-effect classification,
- provider endpoint bind-scope warnings.

## OpenClaw Architecture

Current state rejects the hypothesis that EDITH can integrate with OpenClaw now:

- No `openclaw` binary found.
- No OpenClaw process found.
- No OpenClaw listener found.
- Only local docs describe intended future integration.

Future validated shape, if official OpenClaw is installed:

```text
EDITH CLI
  |
  `-- Tool policy boundary
        |
        `-- OpenClaw adapter
              |
              `-- verified OpenClaw interface: MCP preferred if official docs and binary confirm it
```

## Readiness Decision

EDITH implementation is not ready for full agent capabilities.

EDITH Phase 2 is ready only for:

- project scaffolding if approved,
- read-only `doctor`,
- provider health checks,
- model inventory,
- provider abstraction,
- basic chat prototype after successful non-empty generation is verified.
