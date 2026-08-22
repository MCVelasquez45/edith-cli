// The EDITH product: `edith` opens a complete interactive AI agent.
// Single-column conversation flow — status in a compact header, activity
// inline, no sidebars, no runtime plumbing visible.

import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { stdin as input, stdout as output } from 'node:process';
import { EdithRuntime } from '../runtime/agent-session.js';
import { EdithState } from '../runtime/events.js';
import { SessionStore } from '../sessions/store.js';
import { AtomicInputComposer } from '../native/input-composer.js';
import { TurnView, friendlyError } from './turn-view.js';
import { colors } from '../ui/terminal.js';
import { loadConfig } from '../config.js';
import { runDoctor } from '../doctor.js';
import { Telemetry } from '../observability.js';
import { ensureEdithDirs } from '../runtime/paths.js';

export async function runEdithApp({ cwd = process.cwd(), ui, args = [] }) {
  const flags = parseFlags(args);
  await ensureEdithDirs();
  const config = await loadConfig(cwd);
  const store = new SessionStore();
  const telemetry = new Telemetry();

  const runtime = new EdithRuntime({
    workspace: cwd,
    processingMode: config.processing?.mode ?? 'local-first',
    approvalMode: flags.strict ? 'strict' : 'safe'
  });

  // --- boot ---
  const bootLine = (text) => {
    if (ui.isTTY) output.write(`\r\x1b[2K${colors.dim(text)}`);
    else ui.line(colors.dim(text));
  };
  try {
    await runtime.start({
      onStatus: (stage) => bootLine(`● ${stageLabel(stage)}`),
      modelSelection: flags.model ?? config.defaults?.runtimeModel ?? null
    });
  } catch (error) {
    if (ui.isTTY) output.write('\r\x1b[2K');
    ui.line(`${colors.red('✗')} ${friendlyError(error)}`);
    ui.line(colors.dim('Run `edith doctor` for diagnostics.'));
    process.exitCode = 1;
    return;
  }
  if (ui.isTTY) output.write('\r\x1b[2K');

  // --- session ---
  const workspaceRoot = runtime.workspaceInfo.root;
  let session;
  try {
    session = await resolveSession({ runtime, store, flags, workspaceRoot, ui });
  } catch (error) {
    ui.line(`${colors.red('✗')} ${friendlyError(error)}`);
    process.exitCode = 1;
    return;
  }

  printHeader(ui, runtime, session);

  const composer = new AtomicInputComposer({ input, output });
  composer.start();

  let activeTurn = null;
  composer.on('cancel', () => {
    if (activeTurn) {
      activeTurn.abort();
    } else {
      composer.cancelInput();
      ui.line(colors.dim('\n(Ctrl+C again does nothing at the prompt — use /exit to quit)'));
    }
  });

  const state = { verbose: false, session, lastView: null };

  try {
    while (true) {
      composer.prompt(colors.green('\n> '));
      const entry = await composer.read();
      if (entry.type === 'eof') break;
      if (entry.type === 'cancel') continue;
      const text = entry.text.trim();
      if (!text) continue;

      if (text.startsWith('/') && !text.includes('\n')) {
        const shouldExit = await handleCommand({ text, runtime, store, state, ui, cwd, workspaceRoot });
        if (shouldExit) break;
        continue;
      }

      composer.setPaused(true);
      const controller = new AbortController();
      activeTurn = { abort: () => controller.abort() };
      const view = new TurnView({ ui, verbose: state.verbose, workspace: workspaceRoot });
      state.lastView = view;
      const recorder = telemetry.turnRecorder({
        sessionId: state.session.id,
        workspace: workspaceRoot,
        model: runtime.selection?.ref,
        agent: runtime.agentForSelection()
      });
      ui.line(colors.dim(`You: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`));
      try {
        const result = await runtime.runTurn({
          sessionId: state.session.id,
          text,
          signal: controller.signal,
          onEvent: (event) => { recorder.onEvent(event); view.handle(event); },
          requestApproval: async (approval) => promptApproval({ approval, ui, composer })
        });
        view.finish(result);
        await recorder.finish(result);
        await store.touch(state.session.id, { userMessage: text });
      } catch (error) {
        view.endStream();
        ui.line(`${colors.red('✗')} ${friendlyError(error)}`);
        if (!(await runtime.supervisor.status()).running) {
          ui.line(colors.dim('The runtime went away — recovering…'));
          try {
            await runtime.start({ onStatus: () => {} });
            ui.line(colors.dim('Runtime recovered. Your session is intact — try again.'));
          } catch (recoverError) {
            ui.line(`${colors.red('✗')} Recovery failed: ${friendlyError(recoverError)}`);
          }
        }
      } finally {
        activeTurn = null;
        composer.setPaused(false);
      }
    }
  } finally {
    composer.stop();
    await runtime.stop();
    output.write(colors.reset);
  }
}

function stageLabel(stage) {
  return {
    workspace: 'Reading workspace',
    runtime: 'Starting runtime',
    'starting runtime': 'Starting runtime',
    capabilities: 'Connecting tools',
    models: 'Discovering models',
    agents: 'Preparing agent'
  }[stage] ?? stage;
}

async function resolveSession({ runtime, store, flags, workspaceRoot, ui }) {
  if (flags.resume === true || flags.continue) {
    const latest = await store.latest({ workspace: workspaceRoot });
    if (latest) return latest;
    ui.line(colors.dim('No previous session for this workspace — starting a new one.'));
  } else if (typeof flags.resume === 'string') {
    const found = await store.get(flags.resume);
    if (found) return found;
    throw new Error(`Session not found: ${flags.resume}. Run \`edith sessions\` to list sessions.`);
  }
  const created = await runtime.createSession();
  await store.record({
    id: created.id,
    workspace: workspaceRoot,
    agentName: created.agentName,
    model: runtime.selection.ref
  });
  return { id: created.id, workspace: workspaceRoot, agentName: created.agentName, title: null };
}

function printHeader(ui, runtime, session) {
  const status = runtime.status();
  const ws = runtime.workspaceInfo;
  const home = os.homedir();
  const shortPath = ws.root.startsWith(home) ? `~${ws.root.slice(home.length)}` : ws.root;
  const location = status.modelLocation === 'CLOUD' ? 'cloud' : 'local';
  const model = status.model?.split('/').pop() ?? '?';
  const parts = [
    colors.bold('EDITH'),
    shortPath,
    ws.branch ?? '',
    `${location} · ${model}`,
    session.title ? `“${session.title}”` : ''
  ].filter(Boolean);
  ui.line(parts.join('   '));
  ui.line(colors.dim('─'.repeat(Math.min(output.columns ?? 72, 72))));
  ui.line(colors.dim('Ask anything, or / for commands.'));
}

async function promptApproval({ approval, ui, composer }) {
  ui.line('');
  ui.line(`${colors.yellow('■')} ${colors.bold('Approval required')}`);
  for (const call of approval.toolCalls) {
    const args = call.args ? JSON.stringify(call.args) : '';
    ui.line(`  ${call.tool ?? 'tool'} ${colors.dim(args.length > 90 ? `${args.slice(0, 90)}…` : args)}`);
  }
  composer.setPaused(false);
  composer.prompt(colors.yellow('  Allow? [y/N] '));
  const entry = await composer.read();
  composer.setPaused(true);
  const answer = entry.type === 'line' ? entry.text.trim().toLowerCase() : 'n';
  const approved = answer === 'y' || answer === 'yes';
  return approved ? { approved: true } : { approved: false, reason: 'denied by user' };
}

async function handleCommand({ text, runtime, store, state, ui, cwd, workspaceRoot }) {
  const [command, ...parts] = text.slice(1).trim().split(/\s+/);
  const rest = parts.join(' ').trim();

  switch (command) {
    case 'exit':
    case 'quit':
      return true;

    case 'help':
      printHelp(ui);
      return false;

    case 'status': {
      const status = runtime.status();
      const ws = runtime.workspaceInfo;
      ui.line(`${colors.bold('Model')}      ${status.model} (${status.modelLocation?.toLowerCase()})`);
      ui.line(`${colors.bold('Workspace')}  ${ws.root}${ws.branch ? ` · ${ws.branch}` : ''}`);
      ui.line(`${colors.bold('Session')}    ${state.session.id.slice(0, 12)}${state.session.title ? ` · ${state.session.title}` : ''}`);
      ui.line(`${colors.bold('Policy')}     ${status.processingMode} · approvals: ${status.approvalMode}`);
      ui.line(`${colors.bold('Runtime')}    ${status.runtime}`);
      return false;
    }

    case 'model': {
      if (!rest) {
        const status = runtime.status();
        ui.line(colors.bold('Model classes'));
        for (const [cls, ref] of Object.entries(status.modelClasses)) {
          const marker = ref === status.model ? colors.green(' ← current') : '';
          ui.line(`  ${cls.padEnd(16)} ${ref}${marker}`);
        }
        ui.line(colors.dim('\nAll models:'));
        for (const entry of runtime.catalog.entries) {
          ui.line(`  ${entry.ref}${entry.location === 'CLOUD' ? colors.dim(' (cloud, PUBLIC-only)') : ''}`);
        }
        ui.line(colors.dim('\nSwitch with /model <class or ref>'));
        return false;
      }
      try {
        const selected = await runtime.switchModel(rest);
        if (selected.location === 'CLOUD') {
          ui.line(colors.dim('Cloud model selected: new sessions use it for PUBLIC-only requests; non-public requests stay blocked.'));
        }
        const session = await runtime.createSession();
        await store.record({ id: session.id, workspace: workspaceRoot, agentName: session.agentName, model: selected.ref });
        state.session = { id: session.id, workspace: workspaceRoot, agentName: session.agentName, title: null };
        ui.line(`${colors.green('✓')} Model: ${selected.ref} (new session started)`);
      } catch (error) {
        ui.line(`${colors.red('✗')} ${error.message}`);
      }
      return false;
    }

    case 'sessions':
    case 'session': {
      if (command === 'session' && rest.startsWith('rename ')) {
        const title = rest.slice('rename '.length).trim();
        await store.rename(state.session.id, title);
        state.session.title = title;
        ui.line(`${colors.green('✓')} Session renamed to “${title}”`);
        return false;
      }
      const sessions = await store.list({ workspace: workspaceRoot });
      if (!sessions.length) { ui.line(colors.dim('No sessions for this workspace yet.')); return false; }
      for (const item of sessions.slice(0, 15)) {
        const current = item.id === state.session.id ? colors.green('● ') : '  ';
        ui.line(`${current}${item.id.slice(0, 12)}  ${colors.dim(item.updatedAt?.slice(0, 16) ?? '')}  ${item.title ?? colors.dim('(untitled)')}`);
      }
      ui.line(colors.dim('\nResume with `edith --resume <id>` · rename with /session rename <title>'));
      return false;
    }

    case 'new':
    case 'clear': {
      const session = await runtime.createSession();
      await store.record({ id: session.id, workspace: workspaceRoot, agentName: session.agentName, model: runtime.selection.ref });
      state.session = { id: session.id, workspace: workspaceRoot, agentName: session.agentName, title: null };
      ui.line(`${colors.green('✓')} New session started.`);
      return false;
    }

    case 'skills': {
      if (!runtime.skills?.length) { ui.line(colors.dim('No skills discovered.')); return false; }
      for (const skill of runtime.skills) {
        ui.line(`  ${colors.bold(skill.name.padEnd(14))} ${skill.description} ${colors.dim(`(${skill.source})`)}`);
      }
      return false;
    }

    case 'tools': {
      for (const tool of runtime.capabilityService.tools) {
        const badge = tool.safety === 'read' ? colors.green('read ') : tool.safety === 'write' ? colors.yellow('write') : colors.red('destr');
        ui.line(`  ${badge} ${tool.name.padEnd(26)} ${colors.dim(tool.description.split('.')[0])}`);
      }
      return false;
    }

    case 'context': {
      const ws = runtime.workspaceInfo;
      ui.line(colors.bold('Workspace context (sent to the agent)'));
      ui.line(runtime.defaultInstructions().split('--- WORKSPACE CONTEXT ---')[1]?.split('--- SKILLS ---')[0]?.trim() ?? '(none)');
      return false;
    }

    case 'details': {
      const outputs = state.lastView?.fullOutputs ?? [];
      if (!outputs.length) { ui.line(colors.dim('No tool output recorded for the last turn.')); return false; }
      for (const item of outputs) {
        ui.line(colors.bold(`── ${item.tool ?? 'tool'} ──`));
        ui.line(String(item.content ?? '').slice(0, 4000));
      }
      return false;
    }

    case 'verbose':
      state.verbose = !state.verbose;
      ui.line(`Verbose ${state.verbose ? 'on' : 'off'}.`);
      return false;

    case 'doctor':
      await runDoctor({ cwd, ui });
      return false;

    default:
      ui.line(`${colors.red('✗')} Unknown command: /${command} — try /help`);
      return false;
  }
}

function printHelp(ui) {
  const rows = [
    ['/help', 'Show commands'],
    ['/model [name]', 'Show or switch model (classes: local-fast, local-reasoning, coding, cloud-reasoning)'],
    ['/sessions', 'List sessions for this workspace'],
    ['/session rename <title>', 'Rename the current session'],
    ['/new', 'Start a fresh session'],
    ['/skills', 'List available skills'],
    ['/tools', 'List agent tools with safety class'],
    ['/status', 'Model, workspace, session, policy'],
    ['/context', 'Show the workspace context the agent sees'],
    ['/details', 'Full tool output from the last turn'],
    ['/verbose', 'Toggle timings and runtime diagnostics'],
    ['/doctor', 'Run diagnostics'],
    ['/exit', 'Leave EDITH']
  ];
  for (const [cmd, desc] of rows) ui.line(`  ${colors.bold(cmd.padEnd(24))} ${colors.dim(desc)}`);
}

export function parseFlags(args) {
  const flags = { resume: false, continue: false, model: null, strict: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--resume') {
      const next = args[index + 1];
      flags.resume = next && !next.startsWith('-') ? next : true;
      if (flags.resume !== true) index += 1;
    } else if (arg === '--continue' || arg === '-c') {
      flags.continue = true;
    } else if (arg === '--model') {
      flags.model = args[index + 1] ?? null;
      index += 1;
    } else if (arg === '--strict') {
      flags.strict = true;
    }
  }
  return flags;
}
