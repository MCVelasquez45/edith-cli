# Development

## Setup

```bash
npm ci
npm link
```

## Test

```bash
npm test
```

## Live Diagnostics

```bash
edith doctor
```

`npm test` validates code paths and policies. `edith doctor` reports live local integration status.

## Source Areas

```text
bin/                 CLI entrypoint
src/cli.js           command dispatcher
src/native/          native EDITH TUI and agent core
src/providers/       LM Studio and Ollama
src/agents/          OpenCode, Codex, Claude Code
src/mcp/             MCP client/server
src/network/         search/fetch/docs and URL policy
src/context/         connectors, query engine, briefing
src/auth/            Google OAuth, Keychain, policy
src/tools/           tool registry and workspace utilities
test/                Node test suite
```

## Guidelines

- Keep runtime behavior covered by tests.
- Do not commit credentials or personal data.
- Prefer small, policy-aware integrations over broad permissions.
- Keep documentation aligned with implemented commands.

