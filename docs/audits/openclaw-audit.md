# OpenClaw Audit

Date: 2026-08-08

## Verified

| Item | Finding | Evidence |
| --- | --- | --- |
| `openclaw` executable | NOT FOUND | `type openclaw`, `command -v openclaw`, filesystem search |
| OpenClaw app | NOT FOUND | `/Applications` search |
| OpenClaw running process | NOT FOUND | Filtered `ps aux` output |
| OpenClaw listening service | NOT FOUND | `lsof` listener inventory |
| OpenClaw repository/docs on machine | YES | `~/orca/orca-ai-core/INSTALL_OPENCLAW.md`, `~/orca/orca-ai-core/docs/OpenClaw.md` |
| Related but separate CLI | YES, `clawdbot` | `/opt/homebrew/bin/clawdbot`, package metadata |

## Local Documentation Evidence

`~/orca/orca-ai-core/INSTALL_OPENCLAW.md` states:

- OpenClaw was not found during earlier Orca sprints.
- `clawdbot` was found but is a different local gateway.
- Orca must not reuse `clawdbot` as OpenClaw.
- Future verification should use official `openclaw --version` and `openclaw mcp --help` after installation.

`~/orca/orca-ai-core/docs/OpenClaw.md` describes an intended adapter architecture:

- Connect to a running OpenClaw gateway at `ORCA_OPENCLAW_ENDPOINT`.
- Default documented endpoint in Orca config references `http://localhost:8790`.
- Map OpenClaw capabilities to MCP `ToolSpec`s.
- Enforce permissioning and confirmation gates.
- Audit every action.

This is local architecture documentation, not verified installed OpenClaw behavior.

## `clawdbot` Finding

Verified package metadata:

```text
name: clawdbot
version: 2026.1.24-3
bin: clawdbot -> dist/entry.js
description: WhatsApp gateway CLI (Baileys web) with Pi RPC agent
```

`clawdbot --version` printed a credential-sync status line and version. No credential values were printed in audit docs.

## Integration Mechanism Assessment

| Mechanism | Status | Evidence |
| --- | --- | --- |
| CLI | UNKNOWN / NOT AVAILABLE | No `openclaw` binary found |
| HTTP API | UNKNOWN / NOT AVAILABLE | No OpenClaw listener found; no `localhost:8790` listener observed |
| WebSocket | UNKNOWN | No verified docs or listener found |
| MCP | INFERRED ONLY | Local docs reference `openclaw mcp serve`; not installed or verified |
| Local IPC/socket | UNKNOWN | No OpenClaw socket found during audit |
| Plugin | UNKNOWN | No OpenClaw plugin config found |
| SDK/library | UNKNOWN | No installed package verified |

## Inferred

- OpenClaw is not ready for EDITH integration on this Mac.
- If OpenClaw is later installed, MCP appears to be the preferred integration path according to local Orca documentation, but this remains unverified until the real OpenClaw binary/docs/API are inspected.
- `clawdbot` should not be treated as an OpenClaw substitute.

## Unknown

- Official OpenClaw install state outside searched locations.
- Current official OpenClaw API/CLI surface.
- Whether OpenClaw exposes MCP, REST, WebSocket, local IPC, or another supported interface on this machine.
- Permission model and credentials required by actual OpenClaw.

## Blockers

- No verified OpenClaw installation.
- No verified OpenClaw endpoint or MCP server.
- No safe integration mechanism can be selected based on current local evidence.

## Recommendations

- Do not implement an OpenClaw bridge in EDITH Phase 2 unless OpenClaw is installed and verified first.
- Keep OpenClaw behind a future adapter boundary with explicit capabilities, confirmation gates, and audit logs.
- Require a separate OpenClaw verification pass after installation:

```text
openclaw --version
openclaw mcp --help
openclaw mcp serve --help
lsof listener check
config file redaction review
```
