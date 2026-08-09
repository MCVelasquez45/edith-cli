# EDITH CLI Audit Summary

Date: 2026-08-08

## Audit Summary

Verified environment:

- macOS 26.6 on Apple Silicon, MacBook Pro Mac16,1, Apple M4, 16 GB memory.
- zsh current/configured shell.
- Homebrew installed at `/opt/homebrew`.
- Node v26.5.0, npm 11.17.0, pnpm 11.10.0, yarn 1.22.22, Bun 1.3.14.
- Python 3.14.6 via `python3`; no `python` command.
- Existing global AI CLIs: Claude Code, Codex CLI, Ollama CLI, LM Studio `lms`, and `clawdbot`.
- No `edith` command exists.

## Local Models

Verified local model inventory:

| Provider | Model | State | Context | Tool metadata |
| --- | --- | --- | --- | --- |
| Ollama | `qwen3:8b` | installed | 40,960 | `tools`, `completion`, `thinking` |
| LM Studio | `qwen/qwen3-vl-8b` | loaded | max 262,144; loaded 13,056 | `tool_use` |
| LM Studio | `qwen/qwen3-vl-4b` | not loaded | max 262,144 | `tool_use` |
| LM Studio | `trading-strategy-tester-weights` | not loaded | max 131,072 | `tool_use` |
| LM Studio | `mistral-7b-instruct-v0.1` | not loaded | max 32,768 | unknown |
| LM Studio | `text-embedding-nomic-embed-text-v1.5` | not loaded | max 2,048 | N/A |

## Ollama

Verified:

- Installed via Homebrew formula, version 0.32.5.
- Running as `/opt/homebrew/bin/ollama serve`.
- Listening on `127.0.0.1:11434`.
- HTTP API `/api/version` and `/api/tags` reachable.
- `qwen3:8b` installed.

Not fully verified:

- Useful non-empty answering.
- Streaming.
- Actual tool-call execution.

## LM Studio

Verified:

- App installed at `/Applications/LM Studio.app`, version 0.4.20+1.
- `lms` CLI exists at `~/.lmstudio/bin/lms`.
- HTTP server reachable on port 1234.
- `/v1/models` and `/api/v0/models` work.
- `qwen/qwen3-vl-8b` currently loaded.

Security finding:

- LM Studio listens on `*:1234`, not localhost-only.

Not fully verified:

- Useful non-empty answering.
- Streaming.
- Actual tool-call execution.

## OpenClaw

Verified:

- No `openclaw` executable found.
- No OpenClaw process found.
- No OpenClaw listener found.
- Local Orca docs mention OpenClaw as a future adapter target and explicitly say `clawdbot` must not be reused as OpenClaw.

Conclusion:

- OpenClaw integration is blocked until official OpenClaw is installed and verified.

## MCP

Verified:

- MCP infrastructure exists across Codex, ChatGPT, LM Studio, Claude/Cursor/VS Code surfaces, and project `.mcp.json` files.
- Active MCP-related processes include Codex MCP servers and npx-spawned Salesforce, HubSpot, and GitHub MCP servers.
- Configured servers include Render, Figma, GitHub, Massive, Salesforce, HubSpot, KnowledgeOS, Playwright, WordPress, and Codex MCP server.

Security:

- Credential-bearing MCP configs and environment variables exist.
- One ChatGPT MCP config contains a GitHub credential value; not reproduced in audit docs.

## Shell / Global CLI

Recommendation:

- Future `edith` should be distributed as a Node package with a `bin` entry, resolving through `/opt/homebrew/bin` when globally installed.
- Avoid aliases and shell-profile edits.
- Later, add a Homebrew formula if the CLI stabilizes.

## Security Findings

Before agent capabilities:

- Add command approval.
- Add destructive command detection.
- Add scoped filesystem access.
- Add MCP allowlists and per-tool policy.
- Add secret redaction.
- Add audit logging.
- Warn on non-localhost provider binds.

## Recommended EDITH Architecture

Recommended shape:

```text
EDITH CLI
  |-- Terminal UI
  |-- Provider interface
  |     |-- Ollama adapter
  |     `-- LM Studio adapter
  |-- Session/config/diagnostics
  `-- Tool policy boundary
        |-- MCP client/router
        `-- future OpenClaw adapter, blocked until verified
```

EDITH should own terminal UX, routing, config, diagnostics, session history, provider normalization, and tool policy. It should delegate inference and model storage to Ollama/LM Studio and delegate tool integrations to MCP servers where safe.

## Blockers

- OpenClaw is not installed or verified.
- MCP action use is unsafe until policy/redaction/audit exists.
- LM Studio wildcard bind needs review.
- Provider streaming and non-empty generation require follow-up verification.

## Unknowns

- Whether Ollama and LM Studio streaming work reliably.
- Whether local tool/function calling works end to end.
- Whether LM Studio wildcard bind is intentional.
- Whether OpenClaw official install exposes MCP, HTTP, WebSocket, IPC, or CLI on this machine.
- Exact PATH in non-zsh/IDE terminals.

## Recommended Phase 2

1. Verify non-empty Ollama and LM Studio chat plus streaming with serial probes.
2. Decide and approve a Node CLI scaffold only after audit acceptance.
3. Build `edith doctor` first.
4. Add read-only provider discovery and model inventory.
5. Add provider abstraction.
6. Defer MCP tool execution until security policy is implemented.
7. Defer OpenClaw until installed and verified.

EDITH IMPLEMENTATION READINESS: NOT READY

Reasons: OpenClaw is absent; MCP/tool security is not designed; provider streaming and useful generation are not fully verified; LM Studio is exposed on a wildcard bind.
