import process from 'node:process';
import { stdin as input, stdout as output } from 'node:process';
import { EdithAgentCore } from './agent-core.js';
import { AtomicInputComposer } from './input-composer.js';
import { NativeTurnRenderer, createTurnEvents } from './progress-renderer.js';
import {
  RoutingMode,
  applyRoutingMode,
  cockpitViewModel,
  createTask,
  extractPromptTarget,
  finishTask,
  normalizeRoutingMode,
  renderAgentsView,
  renderStartupCockpit,
  renderStatusLine,
  renderTasksView
} from './cockpit-view.js';
import { colors } from '../ui/terminal.js';
import { runDoctor } from '../doctor.js';

export async function runNativeEdith({ cwd = process.cwd(), ui, args = [] }) {
  const modelArg = readFlag(args, '--model');
  const core = await new EdithAgentCore({ cwd, ui }).initialize({ modelArg });
  const session = {
    routingMode: RoutingMode.AUTO,
    tasks: [],
    verbose: false
  };
  printNativeCockpit(core, ui, session);

  const composer = new AtomicInputComposer({ input, output });
  composer.start();

  let multiline = [];
  let activeTurn = null;
  composer.on('cancel', () => {
    if (activeTurn) {
      activeTurn.abort();
      return;
    }
    composer.cancelInput();
  });

  try {
    while (true) {
      ui.line(renderStatusLine(cockpitViewModel(core, session), { width: ui.stdout?.columns ?? process.stdout.columns ?? 100 }));
      const prompt = multiline.length ? colors.green('... ') : colors.green('\n> ');
      composer.prompt(prompt);
      const entry = await composer.read();
      if (entry.type === 'eof') break;
      if (entry.type === 'cancel') {
        ui.line('');
        ui.warn('Cancelled. Type /exit to quit.');
        multiline = [];
        continue;
      }
      const line = entry.text;
      if (!entry.pasted && !line.includes('\n') && line.endsWith('\\')) {
        multiline.push(line.slice(0, -1));
        continue;
      }
      const inputText = [...multiline, line].join('\n').trim();
      multiline = [];
      if (!inputText) continue;
      if (!inputText.includes('\n') && inputText.startsWith('/')) {
        const shouldExit = await handleSlashCommand(inputText, core, ui, cwd, session);
        if (shouldExit) break;
        continue;
      }
      composer.setPaused(true);
      activeTurn = createActiveTurn();
      try {
        await runConversationTurn(core, inputText, ui, { session, signal: activeTurn.signal });
      } finally {
        activeTurn = null;
        composer.setPaused(false);
      }
    }
  } finally {
    composer.stop();
    process.stdout.write(colors.reset);
  }
}

function createActiveTurn() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort: () => controller.abort()
  };
}

async function runConversationTurn(core, inputText, ui, { session = { routingMode: RoutingMode.AUTO, tasks: [], verbose: false }, signal = null } = {}) {
  const targeted = extractPromptTarget(inputText);
  const effectiveMode = targeted.routingMode ?? session.routingMode;
  const routed = applyRoutingMode(targeted.text, effectiveMode);
  const task = createTask(session.tasks, targeted.text || inputText, routed.owner);
  ui.line(`${colors.dim('You:')} ${inputText}`);
  ui.line(`${colors.dim(`Route: ${effectiveMode}`)}`);
  const renderer = new NativeTurnRenderer({ ui, verbose: session.verbose });
  const events = createTurnEvents(renderer);
  events.working('Thinking');
  let didStream = false;
  const resultPromise = core.handleUserMessage(routed.text, {
    signal,
    routeOverride: routed.routeOverride,
    activity: events.activity,
    activityError: events.activityError,
    streamStart: (label) => {
      didStream = true;
      events.streamStart(label);
    },
    streamChunk: events.streamChunk,
    streamEnd: events.streamEnd
  });
  try {
    const result = signal
      ? await Promise.race([
        resultPromise,
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('EDITH_OPERATION_CANCELLED')), { once: true }))
      ])
      : await resultPromise;
    if (result.text && !didStream) {
      events.streamStart('EDITH');
      events.streamChunk(result.text);
      events.streamEnd();
    }
    finishTask(task, 'DONE');
  } catch (error) {
    if (error.message === 'EDITH_OPERATION_CANCELLED') {
      renderer.cancel();
      finishTask(task, 'ERROR');
      resultPromise.catch(() => {});
      return;
    }
    finishTask(task, 'ERROR');
    events.error(cleanErrorMessage(error));
  }
}

async function handleSlashCommand(inputText, core, ui, cwd, session) {
  const [command, ...parts] = inputText.slice(1).trim().split(/\s+/);
  const rest = parts.join(' ').trim();
  if (command === 'exit' || command === 'quit') return true;
  if (command === 'help') return printSessionHelp(ui);
  if (command === 'status') return printStatus(core, ui);
  if (command === 'trace') return printTrace(core, ui);
  if (command === 'tasks') {
    ui.line(renderTasksView(session.tasks));
    return false;
  }
  if (command === 'agent') {
    const next = normalizeRoutingMode(rest);
    if (!next) {
      ui.line(renderRoutingControlHelp(session.routingMode));
      return false;
    }
    session.routingMode = next;
    ui.line(`Routing pinned to ${session.routingMode}.`);
    return false;
  }
  if (command === 'verbose') {
    session.verbose = !session.verbose;
    ui.line(`Verbose mode ${session.verbose ? 'enabled' : 'disabled'}.`);
    return false;
  }
  if (command === 'models') return printModels(await core.listModels(), ui);
  if (command === 'model') {
    if (!rest) return printModels(await core.listModels(), ui, core.status());
    try {
      const selected = await core.switchModel(rest);
      ui.line(`Model switched to ${selected.model.id} via ${selected.providerName}.`);
    } catch (error) {
      ui.error(error.message);
    }
    return false;
  }
  if (command === 'agents') {
    core.agentHealth = await core.listAgents();
    ui.line(renderAgentsView(cockpitViewModel(core, session)));
    return false;
  }
  if (command === 'tools') return printTools(core.listTools(), ui);
  if (command === 'context') {
    await runConversationTurn(core, 'What personal context can you access?', ui, { session });
    return false;
  }
  if (command === 'brief') {
    await runConversationTurn(core, rest ? `Give me an ${rest} brief` : 'Give me my brief.', ui, { session });
    return false;
  }
  if (command === 'doctor') return runDoctor({ cwd, ui });
  if (command === 'clear' || command === 'new') {
    core.clear();
    ui.line('Session cleared.');
    return false;
  }
  if (command === 'ask') {
    const [agent, ...promptParts] = parts;
    if (!agent || !promptParts.length) {
      ui.error('Usage: /ask <codex|claude|opencode> <prompt>');
      return false;
    }
    await runConversationTurn(core, `@${agent} ${promptParts.join(' ')}`, ui, { session });
    return false;
  }
  ui.error(`Unknown command: /${command}. Try /help.`);
  return false;
}

function printNativeCockpit(core, ui, session) {
  ui.line(renderStartupCockpit(cockpitViewModel(core, session), { width: ui.stdout?.columns ?? process.stdout.columns ?? 100 }));
}

function printSessionHelp(ui) {
  ui.section('Session Commands');
  ui.line('/help                 Show commands');
  ui.line('/model [provider:id]  Show or switch model');
  ui.line('/models               List live local models');
  ui.line('/agents               Show specialist agents');
  ui.line('/agent [name]         Pin routing: auto, claude, codex, opencode, local');
  ui.line('/tasks                Show session task activity');
  ui.line('/tools                Show approved tools');
  ui.line('/context              Show personal-context connector status');
  ui.line('/brief                Build an on-demand personal brief');
  ui.line('/status               Show current session status');
  ui.line('/trace                Show last routing/tool trace');
  ui.line('/verbose              Toggle operational timings');
  ui.line('/doctor               Run EDITH doctor');
  ui.line('/clear or /new        Clear conversation context');
  ui.line('/exit                 Leave EDITH');
  return false;
}

function renderRoutingControlHelp(mode) {
  return [
    'Routing modes:',
    '  /agent auto      EDITH chooses the path',
    '  /agent claude    Pin next requests to Claude',
    '  /agent codex     Pin next requests to Codex',
    '  /agent opencode  Pin next requests to OpenCode',
    '  /agent local     Pin next requests to the local model',
    '',
    `Current: ${mode}`,
    'One-shot targeting: @codex review this file'
  ].join('\n');
}

function printStatus(core, ui) {
  const status = core.status();
  ui.section('Status');
  ui.line(`Model: ${status.model}`);
  ui.line(`Provider: ${status.provider}`);
  ui.line(`Workspace: ${status.workspace}`);
  ui.line(`Launched from: ${status.cwd}`);
  ui.line(`Git branch: ${status.branch || '(none)'}`);
  ui.line(`Tools ready: ${status.toolsReady}`);
  return false;
}

function printTrace(core, ui) {
  ui.section('Trace');
  for (const item of core.lastTrace()) {
    if (item.type === 'route') ui.line(`route: ${item.route} (${item.reason})`);
    else ui.line(`${item.type}: ${item.title || item.tool || item.agent}`);
  }
  return false;
}

function printModels(groups, ui, status = null) {
  ui.section('Models');
  for (const group of groups) {
    ui.line(`${group.providerName}`);
    for (const model of group.models) {
      if (model.capabilities?.includes('EMBEDDING')) {
        ui.line(`  ${colors.dim(`${group.providerId}:${model.id} · embedding`)}`);
        continue;
      }
      const current = status?.providerId === group.providerId && status?.model === model.id ? ' *' : '';
      const caps = model.capabilities?.join(', ') || 'UNKNOWN';
      ui.line(`  ${group.providerId}:${model.id}${current}`);
      ui.line(`    ${caps}${model.state ? ` · ${model.state}` : ''}`);
    }
  }
  return false;
}

function printTools(tools, ui) {
  ui.section('Tools');
  for (const tool of tools) ui.line(`${tool.availability} ${tool.id} · ${tool.risk} · ${tool.description}`);
  return false;
}

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

function cleanErrorMessage(error) {
  return String(error?.message ?? error).replace(/\s+/g, ' ').trim();
}
