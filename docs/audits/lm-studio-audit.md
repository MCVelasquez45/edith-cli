# LM Studio Audit

Date: 2026-08-08

## Verified

| Item | Finding | Evidence |
| --- | --- | --- |
| Application installed | YES | `/Applications/LM Studio.app` |
| Application version | 0.4.20+1 | `Info.plist` |
| Homebrew cask | Not installed via Homebrew | `brew info --cask lm-studio` reports not installed |
| CLI available | YES | `/Users/markvelasquez/.lmstudio/bin/lms` |
| Local app running | YES | Process list and `lsof` show LM Studio app |
| HTTP server listening | YES | `lsof` shows `LM Studio` on `*:1234` |
| OpenAI-compatible models endpoint | YES | `GET http://127.0.0.1:1234/v1/models` |
| Native models endpoint | YES | `GET http://127.0.0.1:1234/api/v0/models` |
| Internal server | YES | `127.0.0.1:41343` from `~/.lmstudio/.internal/http-server.json` and `lsof` |
| MCP config | Present but empty | `~/.lmstudio/mcp.json` contains empty `mcpServers` |
| Credentials directory | Present | `~/.lmstudio/credentials/lmstudio-hub.json`; value not read or printed |

## API Exposure

Verified endpoints:

```text
http://127.0.0.1:1234/v1/models
http://localhost:1234/v1/models
http://127.0.0.1:1234/api/v0/models
```

Security finding:

- `lsof` reports LM Studio bound as `*:1234`, not localhost-only.
- LM Studio internal server `127.0.0.1:41343` is localhost-only.

Configuration keys from `~/.lmstudio/.internal/http-server-config.json`:

```text
autoStartOnLaunch
cors
fileLoggingMode
justInTimeModelLoading
logIncomingTokens
logLinesLimit
logSensitiveData
networkInterface
port
verbose
```

The verified configured public API port is `1234`. Host/network interface value was not printed directly; socket evidence shows wildcard bind.

## Available Models

| Provider | Model/API ID | Family/arch | Size | Quantization | Context | Tool/function capability | State | API accessibility | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LM Studio | `qwen/qwen3-vl-8b` | qwen3_vl, VLM | files: 5.0 GB + 388 MB | 4bit | max 262,144; loaded 13,056 | VERIFIED metadata `tool_use` | loaded | `/v1/models`, `/api/v0/models` | Current loaded model |
| LM Studio | `qwen/qwen3-vl-4b` | qwen3_vl, VLM | 2.9 GB | 4bit | max 262,144 | VERIFIED metadata `tool_use` | not-loaded | `/v1/models`, `/api/v0/models` | Locally present |
| LM Studio | `trading-strategy-tester-weights` | llama, LLM | 2.3 GB | unknown from endpoint | max 131,072 | VERIFIED metadata `tool_use` | not-loaded | `/v1/models`, `/api/v0/models` | Local GGUF |
| LM Studio | `mistral-7b-instruct-v0.1` | llama, LLM | 3.9 GB | Q4_K_S | max 32,768 | UNKNOWN | not-loaded | `/v1/models`, `/api/v0/models` | Local GGUF |
| LM Studio | `text-embedding-nomic-embed-text-v1.5` | nomic-bert, embeddings | unknown | Q4_K_M | max 2,048 | N/A | not-loaded | `/v1/models`, `/api/v0/models` | Embeddings model |
| LM Studio | `mlx-community/gpt-oss-20b-MXFP4-Q8` | unknown | directory present | unknown | unknown | unknown | unknown | Not listed by API endpoint | Directory present under models, but not listed in active endpoint output |

## API Behavior

Verified:

- `GET /v1/models` returns an OpenAI-compatible model list.
- `GET /api/v0/models` returns richer LM Studio metadata including state, context, type, quantization, and capabilities.
- `POST /v1/completions` returned a valid OpenAI-compatible completion envelope for `qwen/qwen3-vl-8b`.

Not verified:

- Useful non-empty answer generation. A one-token completion returned an empty choice with `finish_reason:"length"`.
- Streaming success. A concurrent streaming probe failed during the earlier parallel test.
- Authentication requirements beyond local access. No auth header was required for `/v1/models` or `/api/v0/models`.
- Tool/function calling execution. Metadata reports `tool_use` for several models, but no tool call round trip was tested.

## CLI Behavior

- `lms` exists.
- `lms server status` reported `The server is not running` while the HTTP server was reachable and `lsof` showed the app listening on `*:1234`.
- A broader `lms` listing command hung and was interrupted.

## Inferred

- EDITH should integrate with LM Studio through HTTP, not the `lms` CLI, for provider operations.
- EDITH must normalize both OpenAI-compatible `/v1` responses and LM Studio native `/api/v0` metadata if it wants accurate loaded/not-loaded state and capabilities.

## Unknown

- Exact LM Studio server network-interface setting value.
- Whether the wildcard bind is intentional.
- Whether just-in-time loading will produce acceptable latency for not-loaded models.
- Whether LM Studio streaming and tool calling work reliably for the listed models.

## Blockers

- Binding to `*:1234` should be reviewed before EDITH trusts LM Studio in local-only mode.
- Successful non-empty chat/streaming probes should be run before using LM Studio as a default provider.

## Recommendations

- Treat LM Studio as an optional OpenAI-compatible provider with a richer native discovery path.
- Add a future `edith doctor lm-studio` check that flags wildcard binds, lists loaded state, and tests a bounded chat completion.
- Do not use LM Studio credential files directly.
