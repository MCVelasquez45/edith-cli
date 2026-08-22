# EDITH harness — mechanism notes

EDITH-authored overlay file for the pinned workbuddy-bench checkout.

## How EDITH runs a task

`EdithAgent.run()` execs, as the configured agent user, inside the task container:

```bash
edith run --json --approve-all --model <model> --prompt <instruction> \
  2>&1 </dev/null | tee /logs/agent/edith-output.txt
```

`edith run` is EDITH's headless entry: it drives the same agent core as the
interactive TUI (TrueForge runtime + loopback MCP capability service, both
started container-locally) through a full reason → tool → observe loop, prints
one JSON result envelope `{state, text, sessionId, model, events}` with
`--json`, and exits 0 only when the turn completes.

## Addressing

EDITH speaks the OpenAI wire protocol through its generic provider env:

| Env | Meaning |
|---|---|
| `EDITH_OPENAI_BASE_URL` | full base incl. `/v1` — proxy URL (local_proxy) or backend URL (direct) |
| `EDITH_OPENAI_API_KEY` | `{trial}::{route}` under local_proxy; backend key under direct |
| `EDITH_OPENAI_MODEL` | route slug (local_proxy) or real backend model id (direct) |
| `EDITH_OPENAI_CONTEXT_LENGTH` | advisory context window from the bench config |

The API key never enters TrueForge persistence: EDITH registers keyed
providers through its loopback key-injection proxy.

## Config preset

`settings_file` (versions/<v>.yaml) is parsed host-side and written to
`$EDITH_CONFIG_DIR/config.json` — EDITH's native config file. Keys merge over
EDITH's built-in defaults; keep the preset minimal and deterministic.

## Split-mount

The mount ships `/opt/edith/{bin/edith,app,node}`: launcher script, the EDITH
app with production node_modules (better-sqlite3 linux prebuilds included),
and a private Node 22 runtime. `install()` symlinks the launcher onto PATH and
fails loudly if the mount is missing — EDITH is not on npm, so there is no
registry fallback. Task-image requirements: git (installed by `install()` when
missing). Node in the task image is optional (launcher fallback only).

## Building the mount

The Docker build context needs `edith-src.tar.gz` (EDITH working tree).
Generate + build via the EDITH repo:

```bash
npm run eval:workbuddy:build   # tars EDITH src, runs build-harness-mounts.sh --harness edith/<v>
```

## Known limitations

- Token usage is not yet backfilled into Harbor context (EDITH's normalized
  event stream does not carry usage). Trajectory steps (tool calls + final
  message) are emitted.
- `context_compact_pct` has no EDITH analogue (no auto-compaction knob yet).
- Sampling params (`temperature`, ...) only apply under `local_proxy` (proxy
  injection); direct mode uses backend defaults.
