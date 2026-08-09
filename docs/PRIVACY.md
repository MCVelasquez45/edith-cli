# Privacy

EDITH is local-first. The default design keeps private context on the user's machine and limits what leaves the system.

## Local Processing

Personal context is retrieved through connectors and synthesized by local models whenever practical.

## External Agents

Codex, Claude Code, and OpenCode are specialist agents. EDITH should not automatically send them personal calendar, email, Drive, Docs, contacts, or task data.

## Web Search

Search queries should contain only the minimum external terms needed. EDITH should not send private email bodies, calendar contents, personal documents, contacts, secrets, or environment variables to search providers.

## Google Data

Google data retains source provenance internally. Public docs and examples must not include private account identifiers or private content.

## Logs

Audit logs store metadata, not secret material. Session and audit storage apply redaction patterns for common tokens.

