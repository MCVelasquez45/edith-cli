# Agent Delegation

EDITH is the orchestrator. Specialist agents are resources underneath EDITH.

## Supported Agents

### OpenCode

OpenCode provides the dedicated coding-agent TUI.

```bash
edith code
```

EDITH can also delegate bounded non-interactive tasks through OpenCode where the installed OpenCode CLI supports it.

### Codex

Codex is integrated as a specialist CLI agent with structured output.

```bash
edith ask codex "Reply with exactly OK"
```

### Claude Code

Claude Code is integrated as a specialist CLI agent when authenticated and available.

```bash
edith ask claude "Reply with exactly OK"
```

## Privacy Boundary

Personal context is not automatically sent to Codex, Claude Code, or OpenCode. Delegation that includes personal data requires explicit policy support.

## Native TUI Delegation

Inside `edith`, natural requests such as "Ask Codex to review this" route through EDITH and return the result to the EDITH session.

