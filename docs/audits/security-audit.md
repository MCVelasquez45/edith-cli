# EDITH Security Audit

Date: 2026-08-08

## Verified Findings

| Area | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| Local service exposure | LM Studio binds to `*:1234` | High before local-only agent use | `lsof` |
| Local service exposure | Orca binds to `*:6768` | Medium; purpose not audited | `lsof` |
| Local service exposure | ControlCenter binds to `*:5000` and `*:7000` | Medium; not identified as EDITH dependency | `lsof` |
| Ollama exposure | Ollama binds to `127.0.0.1:11434` | Low | `lsof` |
| Credentials in environment | Multiple credential variable names present | High if logged or passed to tools | `env | cut -d= -f1` |
| MCP credentials | Credential-bearing MCP configs exist | High | Redacted `.mcp.json` inspection |
| ChatGPT MCP config | GitHub credential present | High | Value intentionally omitted |
| Existing AI CLIs | Claude processes running with `--dangerously-skip-permissions` | High for those sessions | Filtered process list |
| Existing AI CLIs | Codex process running with bypass approvals/sandbox in one session | High for that session | Filtered process list |
| Ollama private key | `~/.ollama/id_ed25519` exists and is mode `600` | Medium | File listing only; value not read |

## Required Future Security Boundaries

EDITH must not become an agent with filesystem and shell powers until these boundaries exist:

| Boundary | Recommendation |
| --- | --- |
| Filesystem access | Default to current working directory; require explicit expansion to additional roots; never traverse home by default for editing. |
| Shell execution | Command approval gate with parsed command display, timeouts, output caps, and cwd display. |
| Destructive command detection | Deny or require elevated confirmation for `rm`, `git reset`, `git checkout --`, chmod/chown, package uninstall, service stop/start, credential edits, and shell-profile writes. |
| Repository boundaries | Detect git root; isolate context and edits to the active repo unless user approves cross-repo reads/writes. |
| Secret redaction | Redact env vars, config values, URLs with tokens, bearer headers, private keys, and known token patterns in logs and model context. |
| Environment handling | Pass minimal env to subprocesses; never forward all user env to models or external tools. |
| API credentials | Store credential references by env var name or secure keychain reference, not raw values in EDITH config. |
| MCP permissions | Server allowlist, per-tool policy, credential-presence warnings, side-effect classification, disabled-by-default auto-start. |
| OpenClaw permissions | No OpenClaw integration until official install and interface are verified; consequential actions require confirmation and audit. |
| Network access | Local-only mode by default; explicit approval for remote MCP, cloud providers, package downloads, and telemetry. |
| Sandboxing | Separate read-only context gathering from write/execute tools; consider OS sandbox or subprocess wrapper for command tools. |
| Audit logging | Append-only local audit with redacted inputs/outputs, command, cwd, timestamp, approval decision, and exit status. |
| Tool allowlists/denylists | Start with deny-by-default for MCP and shell tools; classify known tools as read, write, destructive, network, credentialed. |

## Inferred

- EDITH should not inherit the permissive behavior of currently running Claude/Codex sessions.
- EDITH should make local service exposure visible in `edith doctor` before enabling local providers.
- A provider-only chat mode can be enabled earlier than agent mode because it requires fewer capabilities.

## Unknown

- Whether LM Studio wildcard bind is intentionally configured.
- Whether Orca `*:6768` is protected by authentication.
- Whether project-scoped MCP servers perform their own permission checks.
- Whether any shell startup files export raw credentials; the audit only matched relevant lines and did not print values.

## Blockers

- Agent capabilities are not ready until command approval, secret redaction, MCP permissioning, and audit logging are designed.
- LM Studio wildcard bind requires manual review or automatic warning before local-only claims.

## Recommendations

- Phase 2 should implement `doctor` and provider read-only diagnostics before shell/file/MCP action tools.
- EDITH config should distinguish:
  - `chat` mode,
  - `repo-read` mode,
  - `agent-with-approval` mode,
  - `unsafe/unrestricted` mode, if ever supported.
- Never store raw credentials in EDITH-owned files.
