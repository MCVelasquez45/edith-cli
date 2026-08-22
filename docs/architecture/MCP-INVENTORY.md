# MCP INVENTORY

_Last updated: 2026-08-22 · Every MCP surface EDITH knows about, plus TrueForge's MCP layer. Evidence in `CURRENT-AGENT-ARCHITECTURE.md` §9 and the TrueForge source audit._

## 1. MCP servers/registries in play

| MCP Server / Registry | Purpose | Config location | Transport | Auth | Consumers | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **EDITH `self`** | Expose `edith_status`, `list_local_models`, `ask_local_model` (all read-only) | `src/config.js` `mcp.servers.self` (+ `~/.config/edith/config.json`) | stdio (`bin/edith.js mcp-server`) | none (local) | EDITH MCP client, any external MCP client | **Active** (only server EDITH ships) |
| **Claude Code MCP** | Claude's own tool servers | `~/.claude.json`, `~/.claude/settings.json` | (Claude-managed) | (Claude-managed) | Claude Code subprocess | **External** — EDITH probes, refuses to import (`cli.js:357`) |
| **Codex MCP** | Codex's own tool servers | `~/.codex/config.toml` | (Codex-managed) | (Codex-managed) | Codex subprocess | **External** — probed, not imported |
| **Project MCP** | Per-repo servers | `./.mcp.json` | varies | varies | whichever tool reads it | **External** — probed, not imported |
| **TrueForge MCP** (if adopted) | Remote MCP servers with tool-selector policy | TF settings/catalog (`mcp-catalog.yaml`, DB) | **streamable-http → SSE** (remote only; **no stdio**) | header token **or** OAuth (DCR + PKCE), in-chat auth | TF agent loop | **Available** upstream (IMPLEMENTED) |

## 2. Key facts

- EDITH's MCP client (`src/mcp/client.js`) supports **stdio + streamable-HTTP**, enforces a per-server `allowTools` allowlist, times out, and audits each call.
- EDITH **deliberately does not unify** the four registries. `edith mcp add/remove` throws on purpose (`cli.js:317`); `mcp discover` reports found configs but imports nothing. Divergence between the four is by design but real (**D4** in the inventory).
- TrueForge MCP is **remote-transport only** — this is why EDITH's stdio `self` server can't attach to TF without an HTTP shim (see `TRUEFORGE-INTEGRATION-TEST.md` #14).
- TrueForge ships an MCP **catalog** of ~14 presets (linear, notion, github, sentry, stripe, jira, …) with OAuth DCR support — far beyond EDITH's single read-only self-server.

## 3. Should a canonical MCP registry exist?

**Yes — recommended, with adapters, not a forced single format.**

| Consumer | Native MCP format | Can consume a generated config? |
| --- | --- | --- |
| EDITH | `config.mcp.servers` (JSON) | Yes (it's already EDITH's own format) |
| Claude Code | `~/.claude.json` | Yes (generate from canonical) |
| Codex | `~/.codex/config.toml` | Yes (generate TOML) |
| TrueForge | DB + `mcp-catalog.yaml` | Yes (settings API / catalog YAML) |

Proposed canonical source: `config/mcp.yaml` (or `config/mcp/registry.ts`) → small generators emit each client's native format. **Guardrail:** only generate where the target format is safely representable; do **not** merge secrets into any committed file (headers/OAuth resolved at runtime).

> Do not implement the generator until Stage E — but once TrueForge owns execution, its settings API + catalog is the natural home for the canonical registry, with generators for the still-independent Claude/Codex configs.

## 4. Recommended end state

- **One runtime MCP registry: TrueForge** (remote servers, OAuth, selector policy).
- EDITH's read-only `self` tools re-exposed either as TF builtins or via an HTTP shim.
- Claude/Codex keep their own MCP configs (they are independent subprocess agents) but those configs are **generated** from the canonical source to stop drift.
- Personal-context connectors (Google/GitHub/GitLab) optionally re-published as MCP servers so TF agents can reach them under EDITH's governance.
