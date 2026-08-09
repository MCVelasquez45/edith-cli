# MCP Audit

Date: 2026-08-08

## Verified MCP Clients / Config Surfaces

| Client/surface | Location | Status | Notes |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | Present | Remote Render MCP server configured with bearer token env var name only |
| Codex plugin staging | `~/.codex/plugins/.../.mcp.json` | Present | Figma HTTP MCP config in staging bundle |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | Present | Preferences only in audited config; no `mcpServers` in printed config |
| Claude 3p | `~/Library/Application Support/Claude-3p/claude_desktop_config.json` | Present | Minimal enterprise config |
| ChatGPT | `~/Library/Application Support/ChatGPT/mcp.json` | Present | GitHub credential present; value intentionally omitted from docs |
| LM Studio | `~/.lmstudio/mcp.json` | Present | Empty `mcpServers` object |
| Cursor | `~/.cursor/.../mcps` | Present | Multiple project MCP directories found; contents not exhaustively audited |
| VS Code | `~/Library/Application Support/Code/logs/.../mcpGateway.log` | Present logs | MCP gateway logs found |

## MCP Server Inventory

| MCP Server | Location | Language/runtime | Transport | Purpose | Client(s) | Status | Security notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Render | `~/.codex/config.toml` | Remote HTTP | HTTP | Render MCP | Codex | Configured | Uses `RENDER_API_KEY` env var; value not printed |
| Figma | `~/.codex/plugins/.../.mcp.json` | Remote HTTP | HTTP + OAuth resource | Figma MCP | Codex plugin staging | Config present | OAuth flow implied |
| GitHub | `~/Library/Application Support/ChatGPT/mcp.json` | Unknown | Config only | GitHub MCP | ChatGPT | Config present | Credential present; value must be rotated if exposed |
| Massive | `~/Desktop/polygonio-mcp/.mcp.json` | Remote HTTP | HTTP | Market data | Project-scoped MCP client | Config present | No secret in file |
| Salesforce | `~/Desktop/sf-sandbox-core/.mcp.json` | Node via `npx` | stdio | Salesforce MCP | Project-scoped | Config present and running processes observed | Env credential/config present |
| HubSpot | `~/Desktop/sf-sandbox-core/.mcp.json` | Node via `npx` | stdio | HubSpot MCP | Project-scoped | Config present and running process observed | Env credential present |
| GitHub stdio | `~/Desktop/sf-sandbox-core/.mcp.json` | Node via `npx` | stdio | GitHub MCP | Project-scoped | Config present and running process observed | Env credential present |
| KnowledgeOS | `~/projects/orca-voice-knowledge/.mcp.json` | Python module | stdio | Knowledge server | Project-scoped | Config present | PYTHONPATH env present |
| Playwright | `~/orca/projects/LinkedIn/.mcp.json` | Node via `npx` | stdio | Browser automation | Project-scoped | Config present | `--save-session`; can retain browser state |
| WordPress | `~/orca/joe-stocker-fundraiser/.mcp.json` | Node via `npx tsx` | stdio | WordPress integration | Project-scoped | Config present | WP credentials present |
| Codex MCP server | Active process | Node/native Codex | stdio/process | Codex MCP server | Claude/Codex sessions likely | Running | Multiple `codex mcp-server` processes observed |

## Running MCP-Related Processes

Verified by filtered `ps aux`:

- Multiple `node /opt/homebrew/bin/codex mcp-server` processes.
- Multiple native Codex `codex mcp-server` processes.
- `npx`-spawned Salesforce MCP server.
- `npx`-spawned HubSpot MCP server.
- `npx`-spawned GitHub MCP server.

## Security Findings

- Credential-bearing MCP configs exist across ChatGPT, project `.mcp.json` files, and shell environment.
- A GitHub credential value was present in a ChatGPT MCP config during inspection. It is intentionally not copied here. Treat as credential present and consider rotation if there is any chance the audit output or terminal scrollback was exposed.
- MCP servers include high-impact external systems: GitHub, Salesforce, HubSpot, WordPress, browser automation, market data.
- Browser automation MCP with saved session state must be gated carefully before EDITH can invoke tools.

## Inferred

- EDITH should not own all tool integrations directly. It should become an MCP client/router with policy, approval, and auditing, and reuse existing MCP servers where appropriate.
- EDITH needs project-scoped MCP config discovery because several `.mcp.json` files live in project directories, not just global config.

## Unknown

- Exact MCP protocol versions used by each server.
- Which clients currently activate each config.
- Runtime health of every configured MCP server; the audit did not start unknown servers.
- Whether any MCP server has unrestricted filesystem or shell permissions.

## Blockers

- EDITH must have a permission model before invoking MCP tools.
- EDITH must redact env values and tool outputs by default.
- EDITH should not auto-load every discovered MCP server; explicit allowlisting is required.

## Recommendations

- Build MCP support as an explicit client subsystem with:
  - project-scoped discovery,
  - disabled-by-default server activation,
  - per-tool allowlist/denylist,
  - credential presence detection without value display,
  - human approval for side-effecting tools,
  - audit logs.
- Treat browser, GitHub write, Salesforce, HubSpot, and WordPress tools as consequential by default.
