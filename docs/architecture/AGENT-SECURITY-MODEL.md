# AGENT SECURITY MODEL

_Last updated: 2026-08-22 · Current EDITH security posture and how it must be preserved under a TrueForge runtime. Evidence in `CURRENT-AGENT-ARCHITECTURE.md`._

## 1. Filesystem permissions
- **Current:** workspace-scoped, read-only by default. `src/tools/path.js#resolveWorkspacePath` confines reads to the workspace; likely-secret files are refused and secret-like values redacted (`native/workspace-tools.js` — verified by tests `refuses to read likely secret-bearing files`, `redacts secret-like values`). Writes/destructive ops are confirmation-gated.
- **Under TrueForge:** TF's file execution happens in a **sandbox**. Default catalog sandbox is **cloud Daytona** — unacceptable for local-first/private data. Use the **local** sandbox (seatbelt/seccomp, verified available on this machine) or none. Keep EDITH's workspace-boundary + secret-file refusal in front of any TF file tool.

## 2. Network permissions
- **Current:** outbound HTTP/HTTPS to public web only; `src/network/policy.js` blocks localhost, private networks, link-local, cloud metadata endpoints, and `file://` (SSRF guard). Local model endpoints (`127.0.0.1:1234/11434`) are the only allowed private hosts, via the provider clients.
- **Under TrueForge:** preserve the SSRF guard for any web/fetch tool. TF's own egress (model/MCP calls) must be subordinate to EDITH's egress policy (§5).

## 3. MCP permissions
- **Current:** per-server `allowTools` allowlist enforced in `src/mcp/client.js#callTool`; only read-only tools exposed by the `self` server. `mcp add/remove` intentionally disabled.
- **Under TrueForge:** use TF's tool-selector policy (`@read-only` / `@write` / `@destructive` tags, `ToolSelectorPolicy.ts`) and **require approval** for `@write`/`@destructive` (see §6). MCP OAuth tokens: TF persists them **unencrypted in its DB** — mitigate (§4).

## 4. Provider credentials & secrets
- **Current (good):**
  - Google OAuth access/refresh tokens in **macOS Keychain** (`auth/token-store.js`, service `edith.google`).
  - `NVIDIA_API_KEY`, `BRAVE_SEARCH_API_KEY`, OAuth client id/secret: **env / `~/.config/edith`**, never committed (`.env.example` documents names only).
  - GitHub/GitLab: no EDITH-managed secret — delegated to `gh`/`glab` keyrings; EDITH strips `GITHUB_TOKEN`/`GH_TOKEN` from spawned env.
- **⚠ TrueForge gap:** TF stores provider API keys, MCP header tokens, and OAuth tokens **as plaintext columns/JSON in SQLite/Postgres — no application-level encryption at rest** (`crypto` used only for PKCE). 
- **Rule under TrueForge:** **do not migrate secrets into TF's store.** EDITH keeps Keychain/env as the source of truth and **injects credentials into TF at runtime** (per-turn / per-agent), or restricts TF's SQLite to `0600` on an encrypted volume. Never commit `.env`; never print secret values (only names).

## 5. Egress / data-governance boundary (EDITH-owned; TF has none)
The core privacy control. Preserve exactly:
- `classifyData()` → `DataClass` ∈ {PUBLIC, LOCAL, PERSONAL, SENSITIVE, SECRET}.
- `egressDecision()`: **SECRET never leaves the machine**; non-local processors require **PUBLIC-only** input; `local-first` mode forbids any external processor except the single approved cloud model.
- `sanitizeExternalPayload()` redacts before any egress.
- **Integration rule:** EDITH classifies first, then selects a **local-model TF agent** for non-PUBLIC data and only a **cloud-model TF agent** for sanitized PUBLIC data. TF must never be handed data above its agent's egress class.

## 6. Human-approval boundaries
- **Read operations:** may execute without approval (calendar/email/tasks/files/git status, web search).
- **Require explicit approval (destructive / outward-facing):** delete GitLab issue, merge MR, write/modify/delete Salesforce or any external record, send email, delete/overwrite files, deploy, modify infrastructure, any Google write (create/update/send/share/delete).
- **Current:** confirmation-gated in prose/policy (`answerMutationBlocked`, `auth/action-policy.js`); delegation to external agents blocks on SECRET/PERSONAL/SENSITIVE data.
- **Under TrueForge:** promote these to TF's live approval protocol — `require_approval_for_tools` selectors → `ToolApprovalRequiredEvent` → EDITH surfaces allow/deny → persisted before execution (applies in Code Mode too). This turns prose policy into an enforced runtime gate.

## 7. Dangerous actions register
| Action | Class | Gate |
| --- | --- | --- |
| Read local file in workspace | read | none (boundary + secret refusal) |
| Read calendar/email/tasks | read (PERSONAL) | none; stays local |
| Web search/fetch | read (PUBLIC) | SSRF guard |
| Delegate to Claude/Codex/OpenCode | egress | blocked if SECRET/PERSONAL/SENSITIVE; sanitized + audited otherwise |
| Cloud model call | egress | PUBLIC-only + sanitize + local-first policy |
| Google/GitLab/Salesforce write, email send, MR merge, deploy | destructive/outward | **explicit approval** (TF approval event) |
| Sandbox code execution | exec | local sandbox only; no secrets injected into sandbox |

## 8. Observability (security-relevant)
- **Current:** `src/audit.js` append-only audit with redaction (processor selection, egress decisions, delegations, MCP calls, auth events).
- **Under TrueForge:** add TF structured logging (Winston) + OpenTelemetry spans (LLM/tool/latency/tokens/session). **Configure an OTel exporter** (none ships by default) and ensure **no secrets are logged**. Keep EDITH's audit trail for egress/governance events as the authoritative privacy record.

## 9. Standalone-mode caveat
TrueForge standalone has **no auth** and is localhost-only by design (`Auth is disabled; browser login is off`). Acceptable for a single-user local EDITH **only** if bound to `127.0.0.1` and never exposed. Any shared/hosted deployment must enable OIDC and address the at-rest-encryption gap first.
