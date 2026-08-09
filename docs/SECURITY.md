# Security Model

EDITH coordinates powerful local and external systems. Its security model is based on scoped capabilities, explicit confirmation, and local-first data handling.

## Secrets

- OAuth tokens are stored in macOS Keychain.
- OAuth client files stay outside Git.
- `.gitignore` excludes common OAuth credential filenames.
- Audit/session storage redacts common secret patterns.

## Confirmation Policy

Action classes:

- Read: may run automatically
- Reversible write: confirmation-gated
- Sensitive/external write: explicit confirmation required
- Destructive: explicit confirmation required

OAuth authorization does not imply permission to execute every action automatically.

## Workspace Boundary

Native workspace tools validate paths and prevent reads outside the workspace. Likely secret-bearing files are refused or redacted.

## Network Boundary

Web fetch blocks unsafe destinations including localhost, private networks, link-local addresses, metadata endpoints, and `file://` URLs. Redirects are revalidated.

## MCP Boundary

MCP servers and tools are allowlisted. EDITH does not automatically expose all discovered MCP servers to local models.

## Personal Context Boundary

Calendar, email, Drive, Docs, contacts, and task data should remain local by default. EDITH does not automatically send personal context to Codex, Claude Code, OpenCode, or web providers.

## Audit Events

EDITH records safe metadata for significant tool/auth events. It should not log access tokens, refresh tokens, client secrets, passwords, raw email bodies, or large document contents.

