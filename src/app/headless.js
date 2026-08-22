// `edith run -p "<task>"` — one agent turn, no TUI. For scripts, CI, and
// programmatic use. Streams the answer to stdout (or emits JSONL events plus
// a final result object with --json) and returns a meaningful exit code:
//   0 completed · 1 failed · 2 usage error · 124 cancelled/timeout
//
// Approvals: destructive tools are DENIED by default in headless mode; pass
// --approve-all to allow them (explicit, auditable opt-in).

import process from 'node:process';
import { EdithRuntime } from '../runtime/agent-session.js';
import { EdithState } from '../runtime/events.js';
import { SessionStore } from '../sessions/store.js';
import { Telemetry } from '../observability.js';
import { ensureEdithDirs } from '../runtime/paths.js';
import { loadConfig } from '../config.js';

export function exitCodeFor(result) {
  if (result?.state === EdithState.COMPLETED) return 0;
  if (result?.state === EdithState.CANCELLED || result?.cancelled) return 124;
  return 1;
}

export async function runHeadless({
  cwd = process.cwd(),
  args = [],
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = process.stdin,
  createRuntime = null
} = {}) {
  const options = parseRunArgs(args);
  if (options.error) {
    stderr.write(`${options.error}\n`);
    process.exitCode = 2;
    return 2;
  }

  if (!options.prompt && stdin && stdin.isTTY === false) {
    options.prompt = (await readAll(stdin)).trim() || null;
  }
  if (!options.prompt) {
    stderr.write('Usage: edith run -p "<task>" [--workspace DIR] [--model SEL] [--json] [--approve-all] [--timeout SECONDS] [--strict]\n');
    process.exitCode = 2;
    return 2;
  }

  const usingRealRuntime = !createRuntime;
  const workspace = options.workspace ?? cwd;
  let runtime;
  if (createRuntime) {
    runtime = createRuntime(options);
  } else {
    await ensureEdithDirs();
    const config = await loadConfig(cwd);
    runtime = new EdithRuntime({
      workspace,
      processingMode: config.processing?.mode ?? 'local-first',
      approvalMode: options.strict ? 'strict' : 'safe'
    });
  }

  const emitJson = (record) => stdout.write(`${JSON.stringify(record)}\n`);
  let exitCode = 1;
  try {
    await runtime.start({ modelSelection: options.model });
    const session = await runtime.createSession();
    const telemetry = usingRealRuntime ? new Telemetry() : null;
    if (usingRealRuntime) {
      await new SessionStore().record({
        id: session.id,
        workspace: runtime.workspaceInfo?.root ?? workspace,
        agentName: session.agentName,
        model: runtime.selection?.ref
      });
    }
    const recorder = telemetry?.turnRecorder({
      sessionId: session.id,
      workspace,
      model: runtime.selection?.ref,
      agent: session.agentName
    });

    const controller = new AbortController();
    const timer = options.timeoutSeconds ? setTimeout(() => controller.abort(), options.timeoutSeconds * 1000) : null;
    let streamedAny = false;
    const eventLog = [];

    const result = await runtime.runTurn({
      sessionId: session.id,
      text: options.prompt,
      signal: controller.signal,
      onEvent: (event) => {
        recorder?.onEvent(event);
        if (options.json) {
          if (['tool-call', 'tool-result', 'approval-required', 'approval-decision', 'governance-blocked', 'done'].includes(event.type)) {
            eventLog.push({ type: event.type, tool: event.tool, state: event.state ?? undefined });
            emitJson({ event: event.type, tool: event.tool, tools: event.tools, state: event.state ?? undefined });
          }
          return;
        }
        if (event.type === 'text-delta') {
          streamedAny = true;
          stdout.write(event.text);
        }
      },
      requestApproval: async () => {
        if (options.approveAll) return { approved: true };
        return { approved: false, reason: 'headless mode denies gated tools unless --approve-all is passed' };
      }
    });
    if (timer) clearTimeout(timer);
    await recorder?.finish(result);
    if (usingRealRuntime) await new SessionStore().touch(session.id, { userMessage: options.prompt });

    exitCode = exitCodeFor(result);
    if (options.json) {
      // Final envelope: `event`/`exitCode` for JSONL consumers, plus the
      // accumulated `events` array for envelope consumers (e.g. benchmark
      // harnesses that scan for the last object with a `state` key).
      emitJson({
        event: 'result',
        state: result.state,
        exitCode,
        text: result.text ?? '',
        sessionId: session.id,
        model: runtime.selection?.ref,
        events: eventLog
      });
    } else if (streamedAny) {
      stdout.write('\n');
    } else if (result.text) {
      stdout.write(`${result.text}\n`);
    }
    if (result.state === EdithState.FAILED && result.error) {
      stderr.write(`${result.error}\n`);
    }
  } catch (error) {
    if (options.json) emitJson({ event: 'result', state: 'FAILED', exitCode: 1, error: String(error?.message ?? error) });
    else stderr.write(`edith run failed: ${error?.message ?? error}\n`);
    exitCode = 1;
  } finally {
    await runtime.stop?.().catch?.(() => {});
  }
  process.exitCode = exitCode;
  return exitCode;
}

const KNOWN_FLAGS = new Set(['-p', '--prompt', '--workspace', '--model', '--json', '--approve-all', '--strict', '--timeout']);

export function parseRunArgs(args) {
  const options = {
    prompt: null, workspace: null, model: null,
    json: false, approveAll: false, strict: false, timeoutSeconds: 600, error: null
  };
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg)) {
      options.error = `Unknown flag: ${arg}`;
      return options;
    }
    if (arg === '-p' || arg === '--prompt') { options.prompt = args[index + 1] ?? null; index += 1; }
    else if (arg === '--workspace') { options.workspace = args[index + 1] ?? null; index += 1; }
    else if (arg === '--model') { options.model = args[index + 1] ?? null; index += 1; }
    else if (arg === '--json') options.json = true;
    else if (arg === '--approve-all') options.approveAll = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--timeout') {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        options.error = '--timeout requires a positive number of seconds';
        return options;
      }
      options.timeoutSeconds = value;
      index += 1;
    } else {
      positionals.push(arg);
    }
  }
  if (!options.prompt && positionals.length) options.prompt = positionals.join(' ');
  return options;
}

function readAll(stream) {
  return new Promise((resolve) => {
    let data = '';
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', () => resolve(data));
  });
}
