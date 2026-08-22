# EDITH E2E PRODUCT DIRECTIVE

_Recorded: 2026-08-22 · Source: product owner directive. This document locks in the product requirement that governs all EDITH + TrueForge work from Sprint 2 onward. It complements — does not replace — `../architecture/TARGET-AGENT-ARCHITECTURE.md` (ownership split, governance contract, config hierarchy) and `EDITH-PRODUCT-MATURITY.md` (evidence-based gates)._

---

## The product

EDITH must become a **complete end-to-end local AI assistant and coding agent**. The benchmark is the overall product feel of **Claude Code CLI and Codex CLI** — not their syntax, not their branding, not their source.

The user experience in one line:

```bash
$ edith
```

…opens a polished interactive agent that understands the current workspace, reasons about tasks, reads files, searches code, edits files, runs commands, uses tools and MCP, delegates when appropriate, streams what it is doing, asks for approval when required, keeps context, resumes sessions, handles errors cleanly, and feels like **one cohesive product**.

The user should never feel like they are operating `EDITH + TrueForge + Ollama + MCP + OpenCode + Claude + Codex + scripts`. They are using **EDITH**. Everything else is implementation infrastructure.

## Agent, not command router

Current behavior (`input → regex → intent → handler → result`) is not the final product. The target loop:

```text
User Request → Persistent Agent Session → Understand Workspace + Context
→ Reason → Choose Capability → Act → Observe → Reason Again → … → Final Response
```

TrueForge provides the runtime for this loop and **largely disappears from normal UX**. `edith` boots the product: validates environment, ensures the runtime is available, initializes/resumes the workspace and session, discovers capabilities, opens the interactive agent. The user never runs `trueforge start`; EDITH owns that lifecycle.

## Visual design reference (canonical mockup)

The product owner supplied a visual target for the interactive agent. Its grammar is authoritative for Sprint 4 (Interactive CLI Product) and should shape rendering primitives built earlier:

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ ◆ EDITH   AI ASSISTANT & CODING AGENT    ~/orca/edith-cli │ ⎇ main │ local ● qwen3:8b │
╰──────────────────────────────────────────────────────────────────────────╯

> Figure out why the authentication tests are failing and fix them.

✦ Planning
  I'll analyze the auth flow, run the tests, identify the issue, and fix it.

▸ Inspecting workspace
  Detected Node.js project • 892 files • TypeScript

▸ Read src/auth/session.ts
▸ Read src/auth/token.ts
▸ Search "refreshToken"
  Found 8 matches in 3 files

▸ Running tests...
  ┌────────────────────────────────────────────┐
  │ $ npm test -- auth                         │
  │ 2 failed, 18 passed                 2.34s  │
  └────────────────────────────────────────────┘

▸ Analyzing failures...
  Found 2 likely causes in session refresh logic

▸ Edit src/auth/session.ts
  +18 -7

▸ Re-running tests...
  ┌────────────────────────────────────────────┐
  │ $ npm test -- auth                         │
  │ 20 passed                           1.87s  │
  └────────────────────────────────────────────┘

✓ Complete
  Fixed authentication session refresh handling.

> Ask anything or / for commands...
```

Design-system elements the mockup establishes:

| Element | Treatment |
| --- | --- |
| Header bar | Product mark + "AI ASSISTANT & CODING AGENT", right-aligned segments: workspace path · git branch · execution locality (`local`) · model id with live-status dot |
| Activity lines | One icon + colored verb phrase per step (plan ✦, workspace 📁, read 📄, search 🔍, run ⌨, analyze 💡, edit ✏); secondary detail indented in muted text |
| Command execution | Bordered box containing the `$ command`, a one-line result summary (failures in red, passes in green), and right-aligned wall-clock duration |
| Edits | `Edit <path>` followed by `+N -M` diff stat (green/red) |
| Completion | `✓ Complete` in green with a one-sentence outcome |
| Prompt | `>` accent-colored, placeholder "Ask anything or / for commands..." |
| Palette | Dark background; purple/violet accents for identity and prompts; green for success/local-online; red for failures; muted gray secondary text |

Progressive disclosure throughout: important activity visible, noise hidden unless requested. No raw JSON, no `INFO:` logs in normal interaction (debug mode may expose them).

## Requirements checklist (each is a gate row)

- **Workspace awareness** — on launch inside a repo, EDITH knows: path, git repo/branch/status, language, package manager, key config, available commands, project instructions, skills, MCP capabilities, EDITH config. Context built progressively, never whole-repo dumps.
- **Streaming** — token streaming, tool activity, status changes, tool results, approval prompts, errors, completion state. Never dump-at-end.
- **Tool-call UX** — consistent visual grammar (see mockup). Verbose raw JSON only in debug mode.
- **Plan/execution feel** — lightweight visible plans for large tasks; simple tasks stay simple.
- **File operations** — real agent tools: read / read range / search file / search repo / list dir / create / edit / patch / move / delete-with-approval / diff / git status.
- **Shell** — controlled shell tool supporting build, test, lint, typecheck, git inspection, package managers, scripts; fundamental loop = reason → run → inspect output → adapt → run again.
- **Safety/approvals** — read/safe ops proceed automatically; destructive ops require approval (`Allow once / Allow for session / Deny`). EDITH governance is authoritative; TrueForge cannot bypass it.
- **Diff experience** — per-edit diff visibility without dumping whole files; eventually review/accept/revert.
- **Sessions** — start, resume (`edith --resume` / `--continue` / `edith sessions` / `/session`), list, rename, switch, archive, workspace association, compaction.
- **Model experience** — `/model` shows capability classes (Local Fast, Local Reasoning, Cloud Fast, Cloud Reasoning, Coding); provider/model IDs are the advanced view, never the primary one.
- **Local-first** — with no internet/cloud, EDITH still opens and the workspace agent works via local TrueForge + Ollama/LM Studio. Cloud enhances, never defines.
- **Specialists** — Claude Code / Codex / OpenCode become delegated specialists behind EDITH **later** (Sprint 8 in the directive framing); not a Sprint-1/2 concern.
- **Commands** — natural language first; command families (`/help /model /session /agents /skills /tools /mcp /status /context /permissions /config /doctor /exit`) audited against what exists, not implemented blindly.
- **`edith doctor`** — validates version, Node, TrueForge runtime, DB, local/cloud providers, Keychain, MCP, workspace, skills, permissions, runtime health, with remediation.
- **Product states** — explicit: IDLE, THINKING, PLANNING, TOOL_RUNNING, WAITING_APPROVAL, STREAMING, COMPLETED, FAILED, CANCELLED — rendered consistently.
- **Interrupts** — Ctrl+C cancels current generation/tool without killing the session; user can redirect mid-task; agent recovers cleanly.
- **Errors** — human-readable failure + remediation by default; stack traces behind `/details`/debug.
- **Performance** — fast startup, immediate UI, streaming, parallel safe discovery, cached workspace metadata, lazy capability loading. TrueForge embedded/managed so launch preserves a CLI-agent feel, not a server-stack boot.
- **Design system** — centralized rendering primitives (headers, prompts, activity, tool calls, success/warning/error, approvals, diffs, status, secondary text, keyboard hints). No scattered ad-hoc colors.

## E2E acceptance test (definition of done)

```bash
cd ~/orca/test-project
edith
> Find why the tests are failing and fix them.
```

EDITH autonomously: understands workspace → inspects git → searches → reads → hypothesizes → runs tests → observes failures → edits → re-runs → iterates until green or blocked → shows progress → summarizes → preserves session. Then:

```bash
edith --resume
> What did we change?
```

EDITH knows. **That** is done — not "TrueForge API responds". Tracked in `../qa/EDITH-E2E-PRODUCT-GATE.md`.

## Sprint framing (directive ↔ existing 11-sprint roadmap)

The directive's 9-sprint framing maps onto the roadmap in `TARGET-AGENT-ARCHITECTURE.md` §0.3 without conflict:

| Directive sprint | Roadmap sprint(s) | Focus |
| --- | --- | --- |
| 1 Foundation Cleanup | S1 | Tier-A cleanup — **complete** (103/103 tests) |
| 2 TrueForge Agent Core | S2 | real reason→tool→observe→reason loop, local-first |
| 3 E2E Coding-Agent Tools | S3 (+parts of S2) | files, search, edit, shell, git awareness, diff |
| 4 Interactive CLI Product | S9 (pulled earlier) | streaming/activity/interrupt/approval UX vs. Claude Code & Codex benchmark |
| 5 Persistent Agent | S4 | sessions, resume, compaction, workspace continuity |
| 6 Skills + MCP | S5, S6 | extensible capabilities, workspace awareness |
| 7 Security + Governance | S7 | EDITH governance wraps full agent execution path |
| 8 Specialist Delegation | S8 | Claude Code / Codex / OpenCode behind EDITH |
| 9 Product Hardening | S10, S11 | doctor, lifecycle, recovery, migrations, packaging, tests |

Standing rule for every decision: do not preserve architecture merely because "it works today" if it is marked for replacement by the TrueForge agent loop; do not prematurely remove anything the current EDITH experience still depends on.
