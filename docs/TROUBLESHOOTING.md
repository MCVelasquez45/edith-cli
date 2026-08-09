# Troubleshooting

## Run Doctor

```bash
edith doctor
```

Doctor is the live source of truth for local providers, agents, MCP, web, auth, and context connectors.

## GitHub CLI Reports Invalid GITHUB_TOKEN

If `gh auth status` reports an invalid `GITHUB_TOKEN` but a keyring account is valid, unset the stale environment variable for GitHub CLI commands:

```bash
env -u GITHUB_TOKEN gh auth status
```

Do not print or commit token values.

## LM Studio

Verify the local server is running and reachable:

```bash
edith providers
edith models
```

If LM Studio is listening beyond localhost, review LM Studio networking settings before using sensitive workflows.

## Ollama

Verify Ollama is running:

```bash
edith providers
```

## Google Auth

Check status:

```bash
edith auth status
```

Tokens are stored in macOS Keychain. OAuth client config should be outside Git.

## Web Search

Check:

```bash
edith doctor
```

DuckDuckGo HTML and Official Source providers require no API key. Brave and SearXNG are optional.

## MCP

```bash
edith mcp status
edith mcp test self
```

EDITH does not auto-import every MCP server on the machine.

