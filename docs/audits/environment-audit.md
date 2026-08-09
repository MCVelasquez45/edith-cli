# EDITH CLI Environment Audit

Date: 2026-08-08
Host context: macOS local machine, current workspace `/Users/markvelasquez/orca/edith-cli`

## Verified

| Component | Installed? | Version | Executable path | Relevant configuration | Notes |
| --- | --- | --- | --- | --- | --- |
| macOS | YES | 26.6, build 25G72 | N/A | `sw_vers` | Darwin kernel `25.6.0`, arm64 |
| Hardware | YES | MacBook Pro, Mac16,1, Apple M4, 10 cores, 16 GB memory | N/A | `system_profiler SPHardwareDataType` | Serial number intentionally omitted |
| CPU architecture | YES | arm64 | N/A | `uname -a`, `arch` | Apple Silicon verified |
| Current shell | YES | zsh | `/bin/zsh` | `$SHELL`, `$0` | Current and configured shell are zsh |
| Homebrew | YES | 6.0.15 | `/opt/homebrew/bin/brew` | prefix `/opt/homebrew` | Apple Silicon Homebrew prefix |
| Git | YES | 2.50.1 Apple Git-155 | `/usr/bin/git` | N/A | System Git |
| GitHub CLI | YES | 2.96.0 | `/opt/homebrew/bin/gh` | N/A | Homebrew path |
| Node.js | YES | v26.5.0 | `/opt/homebrew/bin/node` | N/A | Homebrew path |
| npm | YES | 11.17.0 | `/opt/homebrew/bin/npm` | prefix `/opt/homebrew` | `npm bin -g` is unavailable in this npm version |
| pnpm | YES | 11.10.0 | `/opt/homebrew/bin/pnpm` | `PNPM_HOME=/Users/markvelasquez/Library/pnpm` | Configured in `.zshrc` |
| yarn | YES | 1.22.22 | `/opt/homebrew/bin/yarn` | N/A | Globally installed npm package |
| Bun | YES | 1.3.14 | `/Users/markvelasquez/.bun/bin/bun` | Bun completions in `.zshrc` | User-local install |
| Python | YES | Python 3.14.6 | `/opt/homebrew/bin/python3` | N/A | `python` command not found |
| pip | YES | pip 26.1.2 | `/opt/homebrew/bin/pip3` | N/A | `pip` command not found |
| pipx | YES | 1.15.0 | `/opt/homebrew/bin/pipx` | PATH additions in `.zshrc` and `.zprofile` | User-local bin added twice |
| uv | YES | 0.8.23 | `/Users/markvelasquez/.local/bin/uv` | User-local install | In PATH |
| Docker CLI | YES | 28.5.1 | `/usr/local/bin/docker` | N/A | CLI verified only; daemon state not audited |

Evidence commands:

```text
sw_vers
uname -a
arch
system_profiler SPHardwareDataType
command -v brew git gh node npm pnpm yarn bun python3 pip3 pipx uv docker
<tool> --version
npm config get prefix
```

## Shell And PATH

Verified shell configuration files:

| File | Exists | Relevant findings |
| --- | --- | --- |
| `~/.zshrc` | YES | Adds `.local/bin` twice, PNPM_HOME, LM Studio CLI path, Antigravity bin, OpenJDK 17, Homebrew bin/sbin, Bun completions. Contains MCP credential environment exports; values were not printed. |
| `~/.zprofile` | YES | Repeats `brew shellenv` six times, loads nvm, adds `.local/bin`. |
| `~/.bashrc` | NO | Not found in audited shell-file list. |
| `~/.bash_profile` | NO | Not found in audited shell-file list. |
| `~/.profile` | NO | Not found in audited shell-file list. |

PATH observations:

- VERIFIED: Homebrew global executables resolve from `/opt/homebrew/bin`.
- VERIFIED: npm global root is `/opt/homebrew/lib/node_modules`; npm global prefix is `/opt/homebrew`.
- VERIFIED: LM Studio CLI path is added by `.zshrc`: `/Users/markvelasquez/.lmstudio/bin`.
- VERIFIED: `.local/bin` appears multiple times in shell config and contains some AI CLI duplicates.
- VERIFIED: `claude` resolves from both `/opt/homebrew/bin/claude` and `/Users/markvelasquez/.local/bin/claude`.
- VERIFIED: `codex` resolves from `/opt/homebrew/bin/codex` and `/Users/markvelasquez/.nvm/versions/node/v20.19.3/bin/codex`.

## Existing AI CLI Inventory

| Command | Installed? | Executable | Version | Installation method | Notes |
| --- | --- | --- | --- | --- | --- |
| `claude` | YES | `/opt/homebrew/bin/claude`; duplicate user-local entries | 2.1.197, Claude Code | npm global package `@anthropic-ai/claude-code@2.1.197` | Process list shows running Claude Code sessions, some with `--dangerously-skip-permissions`. |
| `codex` | YES | `/opt/homebrew/bin/codex`; duplicate nvm Node path | `codex-cli 0.147.0` | npm global package `@openai/codex@0.147.0` | Process list shows active Codex sessions and `codex mcp-server` processes. |
| `ollama` | YES | `/opt/homebrew/bin/ollama` | CLI/client 0.32.5 | Homebrew formula `ollama` | CLI could not connect inside sandbox, but HTTP API is reachable by `curl`. |
| `lms` | YES | `/Users/markvelasquez/.lmstudio/bin/lms` | CLI printed commit `71bd99c`; version command also warned about Ollama connection | LM Studio app CLI path | `lms server status` reported not running despite HTTP server listening on port 1234. |
| `lmstudio` | NO | Not found | N/A | N/A | `lms` is present instead. |
| `openclaw` | NO | Not found | N/A | N/A | No executable or process found. |
| `clawdbot` | YES | `/opt/homebrew/bin/clawdbot` | 2026.1.24-3 | npm global package `clawdbot@2026.1.24-3` | Package description: WhatsApp gateway CLI with Pi RPC agent; not OpenClaw. |

## Local Services

Verified listeners from `lsof -nP -iTCP -sTCP:LISTEN`:

| Service/process | Bind | Port | Status | Security note |
| --- | --- | --- | --- | --- |
| Ollama | `127.0.0.1` | 11434 | Listening | Localhost-only |
| LM Studio | `*` | 1234 | Listening | Exposed beyond localhost; needs review before EDITH depends on it |
| LM Studio internal | `127.0.0.1` | 41343 | Listening | Localhost-only |
| Orca | `127.0.0.1` | 63647 | Listening | Localhost-only |
| Orca | `*` | 6768 | Listening | Exposed beyond localhost; purpose not audited |
| Voicebox | `127.0.0.1` | 17493 | Listening | Localhost-only |
| MongoDB | `127.0.0.1`, `::1` | 27017 | Listening | Localhost-only |
| ControlCenter | `*`, IPv6 `*` | 5000, 7000 | Listening | Exposed beyond localhost; not identified as EDITH dependency |
| polygonio-mcp agent | `127.0.0.1` | 5001, 8001 | Listening | Localhost-only Python services |

## Inferred

- EDITH should assume zsh on this machine, but must not depend on zsh-specific installation because the project goal includes bash, VS Code terminals, and compatible shells.
- A Node-based global CLI would fit the existing global installation pattern because npm global packages already provide `claude`, `codex`, `clawdbot`, `yarn`, and other CLIs from `/opt/homebrew/bin`.
- PATH duplication and multiple `brew shellenv` lines are not blockers, but EDITH installation should avoid adding more duplicate shell config entries.

## Unknown

- Exact PATH order at login shells outside the current Orca-managed terminal.
- Docker daemon status.
- Whether bash or IDE terminals load a different PATH than the current zsh environment.
- Whether memory pressure from running LM Studio plus Ollama affects acceptable EDITH performance; benchmarking was intentionally out of scope.

## Blockers

- None for audit documentation.
- For implementation, global command installation must avoid modifying shell config until a distribution strategy is approved.

## Recommendations

- Prefer an npm package with a `bin` entry for future `edith`, installed under the existing npm/Homebrew prefix, or a Homebrew formula once stable.
- Include `edith doctor` checks for duplicate PATH entries, missing `python` alias expectations, AI service reachability, and exposed service binds.
- Do not require users to edit shell config manually unless global package installation fails.
