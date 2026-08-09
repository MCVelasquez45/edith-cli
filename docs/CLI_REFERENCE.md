# CLI Reference

This page documents commands implemented by the current CLI.

## Interactive

```bash
edith
```

Launches the native EDITH conversational TUI.

Normal conversation is typed directly into the composer. EDITH shows compact action/status events for tools and delegation, then streams one assistant response:

```text
> What's the weather in Mesa?
● Checking weather
✓ Weather updated

EDITH:
...
```

Session commands:

```text
/help       Show session commands
/model      Show or switch local model
/models     List live local models
/agents     Show specialist agents
/tools      Show approved tools
/context    Show personal-context connector status
/brief      Build an on-demand personal brief
/status     Show current session status
/trace      Show the last route/tool trace
/verbose    Toggle operational timings
/doctor     Run live diagnostics
/clear      Clear conversation context
/exit       Leave EDITH
```

```bash
edith --model <provider:model>
```

Launches EDITH with a selected model when available.

## Coding

```bash
edith code
edith code --model <provider/model>
```

Launches OpenCode as the specialist coding TUI.

## Local Chat

```bash
edith chat
edith chat --model <provider:model-id>
```

Starts direct local streaming chat without the full EDITH agent loop.

## Inventory

```bash
edith models
edith providers
edith agents
edith tools list
```

## Diagnostics

```bash
edith doctor
edith context status
edith auth status
edith mcp status
```

## Automation Delegation

```bash
edith ask local "<prompt>"
edith ask codex "<prompt>"
edith ask claude "<prompt>"
edith ask opencode --auto "<prompt>"
```

These commands are useful for scripts and tests. Human use should normally start with `edith`.

## MCP

```bash
edith mcp list
edith mcp status
edith mcp inspect <server>
edith mcp tools <server>
edith mcp resources <server>
edith mcp prompts <server>
edith mcp test <server>
edith mcp discover
```

`edith mcp add` and `edith mcp remove` are intentionally not implemented yet.
