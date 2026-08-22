"""EdithAgent — EDITH (edith CLI) harness for WorkBuddy Bench.

EDITH-authored overlay file (copyright the EDITH project, MIT). Installed into
a pinned workbuddy-bench checkout by evals/workbuddy/scripts/setup.sh.

A ``BaseInstalledAgent`` driving the EDITH CLI headlessly, structured like
``CcAgent``/``CbcAgent`` (install → run → parse output → trajectory) so the
bench's split-mount conventions apply uniformly.

EDITH specifics (EDITH speaks OpenAI-compatible wire protocol):

- Addressing is via env. ``edith run`` resolves its model through EDITH's
  generic OpenAI-compatible provider, configured by ``EDITH_OPENAI_BASE_URL`` /
  ``EDITH_OPENAI_API_KEY`` / ``EDITH_OPENAI_MODEL``.
  - ``local_proxy``: base URL → the host proxy; api key carries
    ``{trial}::{route}`` so the proxy can attribute request logs; model is the
    route slug (the proxy rewrites body["model"] to the backend name).
  - ``direct``: base URL / key come from the harness env (run.sh maps the
    model config's ``backend_url_env``/``backend_key_env`` onto
    ``EDITH_OPENAI_BASE_URL``/``EDITH_OPENAI_API_KEY``); model is the real id.
- EDITH runs one turn per task: ``edith run`` drives a full internal
  reason → tool → observe loop (TrueForge runtime + loopback MCP capability
  service, both container-local) until the task turn completes.
- The settings preset (parsed JSON dict) is written to
  ``$EDITH_CONFIG_DIR/config.json`` (EDITH's native config file).
- Split-mount install: symlink the mounted ``edith`` launcher onto PATH. There
  is no npm fallback — EDITH is not published; a missing mount is an error.
"""

from __future__ import annotations

import base64
import copy
import json
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trajectories.agent import Agent
from harbor.models.trajectories.step import Step
from harbor.models.trajectories.tool_call import ToolCall
from harbor.models.trajectories.trajectory import Trajectory

from workbuddy_bench.agents._agent_user import ensure_agent_user

# `edith run --json` JSONL stream, tee'd here inside the container.
_OUTPUT_FILENAME = "edith-output.txt"


class EdithAgent(BaseInstalledAgent):
    """EDITH CLI agent (installed-CLI harness) for harbor."""

    SUPPORTS_ATIF: bool = True  # emits an ATIF trajectory.json (steps; no token metrics yet)

    def __init__(self, logs_dir: Path, *args, **kwargs):
        # Harness knobs (bench-defined kwargs, not EDITH env vars).
        self._edith_version: str | None = kwargs.pop("EDITH_VERSION", None)
        # Optional per-run wall clock passed to `edith run --timeout` (seconds).
        # Harbor's task-level timeout still applies on top.
        ts = kwargs.pop("EDITH_TIMEOUT_SECONDS", None)
        self._timeout_seconds: int | None = int(ts) if ts is not None else None
        # model.params: recorded for parity; EDITH's CLI has no per-call sampling
        # flags (direct mode uses backend defaults; local_proxy injects params).
        model_params = kwargs.pop("model_params", None) or {}
        self._max_output_tokens = model_params.get("max_output_tokens")
        self._temperature = model_params.get("temperature")  # unused by edith CLI
        # connection: {mode, proxy_url, model_route} injected by prepare_job.
        connection = kwargs.pop("connection", None) or {}
        self._conn_mode = str(connection.get("mode") or "direct")
        self._proxy_url = str(connection.get("proxy_url") or "")
        # Split-mount path (harness config ``mount.path``).
        self._mount_path = str(kwargs.pop("mount_path", None) or "/opt/edith")
        # Deterministic EDITH config preset → $EDITH_CONFIG_DIR/config.json.
        # Fail fast when missing so the version YAML cannot silently drop its
        # settings_file mapping (mirrors cc/cbc convention).
        sp = kwargs.pop("settings_preset", None)
        if not isinstance(sp, dict):
            raise ValueError(
                "edith settings_preset is missing — the harness version config "
                "must set `harness.settings_file` (each versions/<v>.yaml)."
            )
        self._settings_preset: dict = dict(sp)
        kwargs.pop("models_preset", None)  # not used: addressing is via env
        # Context window: forwarded to EDITH as EDITH_OPENAI_CONTEXT_LENGTH
        # (advisory model property). EDITH has no auto-compaction knob yet.
        cw = kwargs.pop("context_window", None)
        self._context_window: int | None = int(cw) if cw is not None else None
        kwargs.pop("context_compact_pct", None)  # no EDITH analogue yet
        kwargs.pop("instance_id", None)  # recorded by Harbor via config.json only
        self._session_id = self._trial_id_from_logs_dir(logs_dir)
        super().__init__(logs_dir, *args, version=self._edith_version, **kwargs)

    @staticmethod
    def _trial_id_from_logs_dir(logs_dir: Path | None) -> str:
        try:
            p = Path(logs_dir)
        except TypeError:
            return ""
        return p.parent.name if p.name == "agent" else ""

    @staticmethod
    def name() -> str:
        return "edith"

    def get_version_command(self) -> str | None:
        return 'export PATH="/usr/local/bin:$PATH"; edith --version'

    # ── install ──────────────────────────────────────────────────
    async def install(self, environment: BaseEnvironment) -> None:
        # System deps (root): git is required by EDITH's workspace awareness;
        # procps for process management. Node is NOT required in the task image —
        # the split-mount ships its own runtime (with a system-node fallback).
        await self.exec_as_root(
            environment,
            command=(
                "command -v git >/dev/null 2>&1 && command -v ps >/dev/null 2>&1 && exit 0; "
                "if command -v apk &> /dev/null; then"
                "  apk add --no-cache git bash procps;"
                " elif command -v apt-get &> /dev/null; then"
                "  apt-get update && apt-get install -y git procps;"
                " elif command -v yum &> /dev/null; then"
                "  yum install -y git procps-ng;"
                " fi;"
                " true"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        # Link the mounted launcher onto PATH. No package-registry fallback:
        # EDITH is not published, so a missing/broken mount must fail loudly.
        mount_bin = f"{self._mount_path.rstrip('/')}/bin"
        await self.exec_as_root(
            environment,
            command=(
                'export PATH="/usr/local/bin:$PATH"; '
                f'if [ -x "{mount_bin}/edith" ]; then '
                f'ln -sf "{mount_bin}/edith" /usr/local/bin/edith; '
                "else echo 'edith split-mount launcher missing (build it with "
                "scripts/harness/build-harness-mounts.sh --harness edith/<version>)' >&2; exit 1; fi && "
                "edith --version"
            ),
        )
        await ensure_agent_user(self, environment)

    # ── run ──────────────────────────────────────────────────────
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        instruction = self.render_instruction(instruction)
        escaped_instruction = shlex.quote(instruction)

        model = self.model_name  # route slug under local_proxy; real id under direct

        if self._conn_mode == "local_proxy":
            base_url = self._proxy_url
            api_key = self._get_env("EDITH_OPENAI_API_KEY") or "dummy-for-proxy"
            if self._session_id:
                api_key = f"{self._session_id}::{model}"
        else:
            base_url = self._get_env("EDITH_OPENAI_BASE_URL") or ""
            api_key = self._get_env("EDITH_OPENAI_API_KEY") or ""

        env: dict[str, str] = {
            "EDITH_OPENAI_BASE_URL": base_url,
            "EDITH_OPENAI_API_KEY": api_key,
            "EDITH_OPENAI_MODEL": model,
        }
        if self._context_window is not None:
            env["EDITH_OPENAI_CONTEXT_LENGTH"] = str(self._context_window)
        env = {k: v for k, v in env.items() if v}

        # EDITH state/config dirs must live in the agent user's real home.
        # Docker env values are not shell-expanded, and some task images bake an
        # unwritable HOME; re-derive it from passwd (same fix as cc_agent).
        home_fix = 'export HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"; '
        dirs_export = (
            home_fix
            + 'export EDITH_CONFIG_DIR="$HOME/.config/edith"; '
            + 'export EDITH_DATA_DIR="$HOME/.edith"; '
        )

        settings_json: dict = copy.deepcopy(self._settings_preset)
        settings_b64 = base64.b64encode(json.dumps(settings_json).encode()).decode()
        setup_cmd = (
            f"{dirs_export}"
            'mkdir -p "$EDITH_CONFIG_DIR" "$EDITH_DATA_DIR" && '
            f'echo {settings_b64} | base64 -d > "$EDITH_CONFIG_DIR/config.json"'
        )
        await self.exec_as_agent(environment, command=setup_cmd, env=env)

        # Headless, parseable output: `edith run --json` prints one JSON
        # envelope {state, text, sessionId, model, events:[{type,tool,state}]}
        # when the turn finishes. --approve-all: benchmark tasks run fully
        # autonomously inside the sandbox; EDITH's approval gate has no human.
        output_path = f"/logs/agent/{_OUTPUT_FILENAME}"
        flags = [
            "run", "--json", "--approve-all",
            "--model", shlex.quote(model),
        ]
        if self._timeout_seconds is not None:
            flags += ["--timeout", str(self._timeout_seconds)]
        run_cmd = (
            'export PATH="/usr/local/bin:$PATH"; '
            f"{dirs_export}"
            f"edith {' '.join(flags)} --prompt {escaped_instruction} "
            f"2>&1 </dev/null | tee {output_path}"
        )
        await self.exec_as_agent(environment, command=run_cmd, env=env)

    # ── post-run: parse the JSON envelope → ATIF trajectory ──────
    def populate_context_post_run(self, context: AgentContext) -> None:
        envelope = self._read_envelope()
        if envelope is None:
            return
        trajectory = self._build_trajectory(envelope)
        if trajectory:
            traj_path = self.logs_dir / "trajectory.json"
            try:
                with open(traj_path, "w", encoding="utf-8") as fh:
                    json.dump(trajectory.to_json_dict(), fh, indent=2, ensure_ascii=False)
            except (OSError, AttributeError) as exc:
                self.logger.debug("Failed writing trajectory.json: %s", exc)
        # Token counts: EDITH's envelope does not carry usage yet, so context
        # token fields stay unset. Known limitation (documented in
        # docs/evals/WORKBUDDY-INTEGRATION.md).

    def _read_envelope(self) -> dict | None:
        """Extract the last JSON object with a ``state`` key from the output.

        `edith run --json` pretty-prints one envelope; the tee'd stream may
        carry stray stderr lines around it, so scan candidate '{' lines from
        the end and raw-decode forward.
        """
        out = self.logs_dir / _OUTPUT_FILENAME
        if not out.is_file():
            self.logger.warning(
                "edith output not found: %s (check the /logs/agent mount)", out
            )
            return None
        try:
            text = out.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            self.logger.debug("Failed reading edith output: %s", exc)
            return None
        decoder = json.JSONDecoder()
        starts = [i for i, ch in enumerate(text) if ch == "{"]
        fallback: dict | None = None
        for start in reversed(starts):
            try:
                obj, _end = decoder.raw_decode(text, start)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            if obj.get("event") == "result":
                return obj
            # Crash mid-stream: keep the last stateful event as evidence.
            if fallback is None and "state" in obj:
                fallback = obj
        if fallback is not None:
            return fallback
        self.logger.warning("no edith result envelope found in %s", out)
        return None

    def _build_trajectory(self, envelope: dict) -> Trajectory | None:
        """Map the `edith run --json` envelope to an ATIF Trajectory.

        Envelope: {state, text, sessionId, model,
                   events: [{type: 'tool-call'|'tool-result'|..., tool, state}]}.
        """
        steps: list[Step] = []
        step_id = 1
        for ev in envelope.get("events") or []:
            if not isinstance(ev, dict) or ev.get("type") != "tool-call":
                continue
            steps.append(Step(
                step_id=step_id,
                source="agent",
                model_name=envelope.get("model") or self.model_name,
                message="",
                tool_calls=[ToolCall(
                    tool_call_id=f"call-{step_id}",
                    function_name=str(ev.get("tool") or ""),
                    arguments={},
                )],
            ))
            step_id += 1
        steps.append(Step(
            step_id=step_id,
            source="agent",
            model_name=envelope.get("model") or self.model_name,
            message=str(envelope.get("text") or envelope.get("error") or ""),
        ))
        return Trajectory(
            session_id=envelope.get("sessionId"),
            agent=Agent(name="edith", version=self._version or "unknown",
                        model_name=self.model_name),
            steps=steps,
        )
