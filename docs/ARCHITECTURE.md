# EDITH Architecture

EDITH is a local-first orchestration CLI. It is not a replacement for every underlying tool; it coordinates local models, specialist agents, normalized tools, and personal context through one policy-aware terminal agent.

## Core Flow

```text
User
  -> EDITH native TUI
  -> Agent core
  -> Router
  -> local model, specialist agent, tool, or context connector
  -> policy/audit boundary
  -> response
```

## Major Subsystems

### Native Agent

`src/native/agent-core.js` owns conversational routing, session history, capability grounding, and response synthesis. `src/native/interactive-cli.js` provides the terminal interface.

### Providers

`src/providers/` discovers and streams local models from LM Studio and Ollama. EDITH does not hard-code model inventory; it queries live provider APIs.

### Agents

`src/agents/` integrates specialist agent CLIs:

- OpenCode for coding-agent TUI and delegated coding tasks
- Codex for structured CLI delegation
- Claude Code for structured CLI delegation

### Tools

`src/tools/` normalizes tool metadata, risk, permissions, and availability. Native workspace tools are read-oriented and path-scoped.

### MCP

`src/mcp/` implements EDITH-owned MCP client/server pieces. MCP tools are not exposed broadly by default; allowlists and policy boundaries apply.

### Network

`src/network/` implements search/fetch/docs providers and security policy. Fetch only allows public HTTP/HTTPS destinations and blocks local/private network targets.

### Personal Context

`src/context/` normalizes Google Workspace, GitHub, and GitLab data into domain objects consumed by EDITH and the briefing engine.

### Auth

`src/auth/` handles Google OAuth, profiles, Keychain storage, scope bundles, and action confirmation policy.

## Security Boundary

Policy is not a single switch. It is layered across:

- workspace path validation
- MCP server/tool allowlists
- network URL validation
- Google profile isolation
- confirmation requirements
- secret redaction
- audit logging
- external-agent isolation for personal context

## Data Movement

Personal context should remain local by default:

```text
Google/GitHub/GitLab
  -> EDITH connector
  -> normalized context
  -> local model synthesis
```

EDITH should not automatically send email, calendar, Drive, Docs, contacts, or tasks to Codex, Claude Code, OpenCode, or web search providers.

