# EDITH CLI Audit Summary

Last updated: 2026-08-09

> **SUPERSEDED (2026-08-22).** The "100% VERIFIED" milestone below describes feature-level verification of the CLI orchestrator, not product maturity — the runtime is a regex router with no persistent sessions. For the current evidence-based assessment use `docs/product/EDITH-PRODUCT-MATURITY.md`; for architecture use `docs/architecture/TARGET-AGENT-ARCHITECTURE.md` and `docs/architecture/AGENT-SYSTEM-INVENTORY.md`. Retained for history only.

## Current Milestone

```text
EDITH FULL INFRASTRUCTURE: 100% VERIFIED
```

This summary captures the repository milestone. Live runtime availability still depends on the local machine and should be checked with:

```bash
edith doctor
```

## Verified Infrastructure Areas

- Native EDITH conversational TUI
- LM Studio provider discovery and local-model streaming
- Ollama provider discovery and local-model streaming
- OpenCode interactive coding mode
- OpenCode non-interactive delegation on disposable coding tasks
- Codex delegation
- Claude Code delegation
- EDITH MCP client/server foundation
- Native workspace and Git tools
- System time/date/timezone awareness
- General web search, current/news search, official-source search, documentation lookup, and web fetch
- SSRF/private-network/file URL fetch protections
- Google OAuth personal profile with macOS Keychain token storage
- Google Calendar, Gmail, Drive, Docs, Tasks, and Contacts connectors
- GitHub and GitLab context connectors
- Cross-source Calendar/Gmail correlation
- Personal briefing engine
- Confirmation policy, audit logging, and secret redaction

## Public Repository Security Review

Current tree scan:

- No live OAuth access tokens or refresh tokens found.
- No live OAuth client secret JSON found.
- No private keys found.
- No real GitHub/GitLab/OpenAI-style tokens found.
- Test fixtures contain synthetic placeholder values.

Tracked cleanup:

- Obsolete `opencode.local.json.backup-*` files were removed from Git.
- Backup patterns and OAuth credential patterns are ignored.

History scan:

- Detected only a synthetic GitHub token fixture in tests.
- No real credential was identified during the public-release scan.

## Security Notes

- Google tokens are stored in macOS Keychain.
- OAuth client credentials must remain outside Git.
- Personal context is local-first and not automatically delegated to external agents.
- Writes and destructive operations are confirmation-gated.
- MCP tool use is allowlisted.
- Web fetch blocks localhost, private networks, link-local addresses, metadata endpoints, and `file://` URLs.
- Audit records avoid token and credential values.

## Known Operational Considerations

- `edith doctor` may warn when optional profiles, providers, or agents are not connected on a given machine.
- LM Studio network binding should be reviewed if it is not localhost-only.
- Optional search providers such as Brave and SearXNG require local configuration.
- No open-source license has been declared yet.

