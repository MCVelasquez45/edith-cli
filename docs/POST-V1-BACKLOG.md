# Post-v1 backlog

Deliberately deferred. Nothing here blocks the v1 release candidate.

## Benchmarks / evals
- `edith-code-smoke` and wider WorkBuddy Code-subset runs (infra proven by the scored smoke; scale `task_selection`).
- Additional WorkBuddy subsets (web / office / sec) — datasets fetch cleanly, unevaluated.
- Layer-3 LLM judge (`llm_judge`) — disabled everywhere today.

## Product / CLI
- Multiline composer editing (Shift+Enter soft newline; today multiline arrives via atomic paste).
- Slash-command autocomplete on Tab; input history persistence across sessions.
- Per-edit diff preview in approval prompts for write tools.
- Scroll-region (DECSTBM) pinned composer — current inline composer is stable; a true pinned bottom pane is a polish upgrade.
- Windows terminal QA (only macOS/Linux PTY verified).

## Runtime / infra
- Advanced SQLite migration framework (schema versioning beyond TrueForge's own).
- Full metrics dashboard / large observability system (telemetry JSONL exists; visualization deferred).
- Sandbox skill architecture; skill marketplace/sharing.
- Upgrade/rollback framework for the runtime supervisor.
- Large CI redesign (matrix, caching, PTY QA in CI).
- Voice input/output.

## Cloud
- NVIDIA NIM live verification — blocked on credential only; governance and routing paths are tested with the key absent (PARTIAL — credential-dependent cloud live verification).

## Security (sub-P1 improvements)
- Keychain-backed storage for any future long-lived cloud credentials.
- Broaden secret-redaction pattern corpus; periodic audit script.
