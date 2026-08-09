# Ollama Audit

Date: 2026-08-08

## Verified

| Item | Finding | Evidence |
| --- | --- | --- |
| Installed | YES | `command -v ollama` -> `/opt/homebrew/bin/ollama` |
| Version | 0.32.5 | `ollama --version`; `curl http://127.0.0.1:11434/api/version` |
| Install method | Homebrew formula | `brew info ollama` |
| Running | YES | `lsof` shows `/opt/homebrew/bin/ollama serve` listening |
| API host/port | `127.0.0.1:11434` | `lsof`; `curl http://127.0.0.1:11434/api/version` |
| API bind scope | Localhost-only | `lsof` shows `TCP 127.0.0.1:11434 (LISTEN)` |
| API model discovery | YES | `GET /api/tags` returned one model |
| CLI model commands | Not verified in sandbox | `ollama list`, `ollama ps`, `ollama show` failed with `connect: operation not permitted` |
| Autostart hints | Available via Homebrew caveats | `brew info ollama` shows `brew services start ollama` option |

## Available Models

| Provider | Model | Model ID | Family | Size | Quantization | Context | Tool/function capability | Current availability | API accessibility | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ollama | qwen3:8b | `qwen3:8b` | qwen3 | 5,225,388,164 bytes | Q4_K_M | 40,960 | VERIFIED metadata includes `tools`; also `completion`, `thinking` | Installed | `GET /api/tags` verified | Family capability is metadata-reported; no successful tool call was executed |

Raw capability evidence from `/api/tags`:

```text
capabilities: completion, tools, thinking
details: format gguf, family qwen3, parameter_size 8.2B, quantization_level Q4_K_M, context_length 40960, embedding_length 4096
```

## API Behavior

Verified:

- `GET /api/version` returned `{"version":"0.32.5"}`.
- `GET /api/tags` returned `qwen3:8b`.
- Minimal `/api/generate` request was accepted and completed after loading the model.

Not verified:

- Useful non-empty answer generation. A one-token probe returned an empty response with `done_reason:"length"`, which verifies request handling but not answer quality.
- Streaming completion. A concurrent streaming probe failed during the earlier parallel test; no serial streaming success was established.
- Tool/function calling execution. Metadata reports tool capability, but no tool-call round trip was tested.

## Relevant Environment Variables

The current environment did not expose Ollama-specific variable names in the audited variable-name list. Values were not printed for any credential-like variables.

## Inferred

- Ollama is a viable EDITH provider candidate because model discovery and basic API reachability are verified on a localhost-only port.
- EDITH should talk to the HTTP API, not depend on `ollama list`, because the CLI connection failed under the current sandbox while `curl` worked.

## Unknown

- Whether Ollama is managed by Homebrew services, launchd, or manually launched. The process command shows `ollama serve`; no Ollama LaunchAgent was found.
- Whether additional Ollama models exist outside the active manifest inventory.
- Whether Qwen3 tool calling works through Ollama in this install.
- Whether streaming works reliably; the audit did not establish a successful stream.

## Blockers

- Before EDITH uses Ollama for agent work, run a successful non-empty chat response and streaming response outside the current sandbox constraints.

## Recommendations

- Implement provider diagnostics around HTTP endpoints first: `/api/version`, `/api/tags`, then a bounded generation probe.
- Treat Ollama tool-calling capability as `VERIFIED_METADATA` until an actual tool call round trip is tested.
- Keep the default host configurable; do not hard-code `11434` despite this machine currently using it.
