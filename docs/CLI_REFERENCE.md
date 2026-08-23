# CLI Reference

This page documents commands implemented by the current CLI.

## Interactive

```bash
edith
```

Launches the native EDITH conversational TUI.

Normal conversation is typed directly into the composer. EDITH starts in a compact cockpit showing workspace, model, runtime, tool count, and agent availability.

Multiline paste is atomic when the terminal supports bracketed paste: EDITH waits for the paste end marker before generating. Blank lines, lists, code blocks, and Unicode are preserved. A trailing `\\` on a typed line keeps the existing continuation behavior. Pasted blocks that begin with `/` are treated as user content when they contain newlines; slash commands execute only as an explicitly submitted single-line command.

EDITH shows compact action/status events for tools, then streams one assistant response:

```text
> What's the weather in Mesa?
● Checking weather
✓ Weather updated

EDITH:
...
```

Session commands:

```text
/help                    Show session commands
/model [name]            Show or switch model (classes: local-fast, local-reasoning, coding, cloud-reasoning)
/sessions                List sessions for this workspace
/session rename <title>  Rename the current session
/new                     Start a fresh session
/skills                  List available skills
/tools                   List agent tools with safety class
/status                  Model, workspace, session, policy
/context                 Show the workspace context the agent sees
/details                 Full tool output from the last turn
/verbose                 Toggle timings and runtime diagnostics
/doctor                  Run diagnostics
/exit                    Leave EDITH
```

```bash
edith --model <provider:model>   # start with a specific model or class (e.g. local-fast)
edith --continue                 # resume the latest session in this workspace
edith --resume <id>              # resume a specific session
edith --strict                   # require approval for write operations too
```

## Sessions

```bash
edith sessions                   # list sessions for this workspace
```

Sessions survive restarts and context compacts automatically. Resume with `edith --continue` or `edith --resume <id>`.

## Headless

```bash
edith run -p "<task>"            # run one agent turn without the TUI and exit
```

Flags: `--workspace DIR`, `--model SEL`, `--json` (JSONL events + final result object), `--approve-all` (allow gated tools — explicit, auditable opt-in), `--timeout SECONDS` (default 600), `--strict`. The prompt may also be piped on stdin. Exit codes: `0` completed · `1` failed · `2` usage error · `124` cancelled/timeout.

## Runtime

```bash
edith runtime status             # background runtime health (starts automatically with `edith`)
edith runtime stop
edith runtime restart
```

## Coding

```bash
edith code
edith code --model <provider/model>
```

Launches OpenCode as the specialist coding TUI.

## Chat

```bash
edith chat
edith chat --model <provider:model-id>
```

Starts direct streaming chat without the full EDITH agent loop.

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

## Authentication

```bash
edith auth status                                       # show authentication status
edith auth google --profile personal --scope calendar   # connect Google Workspace via local OAuth
edith auth google --profile personal --upgrade          # upgrade the personal profile for assistant actions
edith auth logout google                                 # remove local Google tokens
```

Tokens are stored in the macOS Keychain; non-secret metadata lives under `~/.config/edith`. Running `edith auth google` without OAuth client credentials prints setup instructions.
