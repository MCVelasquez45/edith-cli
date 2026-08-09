# EDITH Integration Readiness

Date: 2026-08-08

## Matrix

| Component | Installed | Running | API Verified | EDITH Ready | Blockers |
| --- | --- | --- | --- | --- | --- |
| Ollama | VERIFIED YES | VERIFIED YES | VERIFIED discovery/version/request acceptance | PARTIAL | Need non-empty chat, streaming, tool-call verification |
| LM Studio | VERIFIED YES | VERIFIED YES | VERIFIED `/v1/models`, `/api/v0/models`, request acceptance | PARTIAL | Wildcard bind on `*:1234`; need non-empty chat, streaming, tool-call verification |
| OpenClaw | VERIFIED NO | VERIFIED NO | NO | NO | Not installed; no interface verified |
| MCP | VERIFIED YES | VERIFIED some servers/processes | PARTIAL | NOT READY FOR ACTIONS | Needs allowlist, permission model, redaction, audit logging |
| Node | VERIFIED YES | N/A | N/A | YES | None for CLI runtime; choose supported engine range |
| Python | VERIFIED YES (`python3`) | N/A | N/A | PARTIAL | `python` absent; avoid assuming `python` command |
| Shell/PATH | VERIFIED zsh/Homebrew/npm globals | N/A | N/A | PARTIAL | PATH duplicates and multiple CLI duplicates; avoid shell-profile edits |

## Verified Provider Fit

| Provider | Discovery | Chat API | Streaming | Tool metadata | Tool execution | Auth |
| --- | --- | --- | --- | --- | --- | --- |
| Ollama | `/api/tags` | `/api/chat`, `/api/generate` accepted requests | UNKNOWN | `capabilities` includes `tools` | UNKNOWN | None required for localhost probe |
| LM Studio | `/v1/models`, `/api/v0/models` | `/v1/completions` accepted request; `/v1/chat/completions` timed out in first probe | UNKNOWN | `/api/v0/models` includes `tool_use` for several models | UNKNOWN | None required for local model endpoints |

## Provider Normalization Requirements

EDITH will need to normalize:

- Model discovery shape:
  - Ollama: `/api/tags` with `models[].details` and `capabilities`.
  - LM Studio: `/v1/models` minimal list; `/api/v0/models` rich local metadata.
- Chat completion:
  - Ollama native `/api/chat`.
  - LM Studio OpenAI-compatible `/v1/chat/completions`.
- Streaming:
  - Ollama NDJSON.
  - LM Studio Server-Sent Events / OpenAI-compatible chunks, pending verification.
- Tool calling:
  - Ollama metadata says `tools`; actual protocol test needed.
  - LM Studio native metadata says `tool_use`; actual OpenAI-compatible tool call test needed.
- Context windows:
  - Ollama model reports 40,960.
  - LM Studio models report 2,048 to 262,144 max depending on model; loaded Qwen3-VL-8B currently loaded at 13,056.
- Authentication:
  - Neither local endpoint required auth for audited discovery calls.
  - EDITH should still support optional headers for future providers.
- Error handling:
  - CLI and HTTP behavior diverge for both Ollama and LM Studio; EDITH should trust HTTP diagnostics over CLI wrappers for providers.

## Recommended Phase 2 Readiness Scope

Ready:

- Create provider abstraction design.
- Implement read-only diagnostics.
- Implement model inventory display.
- Implement provider config schema.

Not ready:

- Agentic shell/file modification.
- MCP tool invocation.
- OpenClaw bridge.
- Defaulting to LM Studio without bind-scope warning.

## Blockers

- OpenClaw is absent.
- MCP actions require security architecture first.
- Streaming and useful generation were not fully verified for either local provider in this audit.

## Unknown

- Exact model answer quality and latency.
- Whether local providers support robust structured output.
- Whether LM Studio wildcard bind is intentional.
- Whether OpenClaw official install will match local Orca docs.
