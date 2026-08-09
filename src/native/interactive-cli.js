import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { EdithAgentCore } from './agent-core.js';
import { colors } from '../ui/terminal.js';
import { runDoctor } from '../doctor.js';

export async function runNativeEdith({ cwd = process.cwd(), ui, args = [] }) {
  const modelArg = readFlag(args, '--model');
  const core = await new EdithAgentCore({ cwd, ui }).initialize({ modelArg });
  printNativeBanner(core, ui);

  const rl = createInterface({
    input,
    output,
    terminal: true,
    historySize: 200,
    removeHistoryDuplicates: true
  });

  let multiline = [];
  rl.on('SIGINT', () => {
    ui.line('');
    ui.warn('Cancelled. Type /exit to quit.');
    multiline = [];
    rl.prompt();
  });

  try {
    while (true) {
      const prompt = multiline.length ? colors.green('... ') : colors.green('\n> ');
      let line;
      try {
        line = await rl.question(prompt);
      } catch {
        break;
      }
      if (line.endsWith('\\')) {
        multiline.push(line.slice(0, -1));
        continue;
      }
      const inputText = [...multiline, line].join('\n').trim();
      multiline = [];
      if (!inputText) continue;
      if (inputText.startsWith('/')) {
        const shouldExit = await handleSlashCommand(inputText, core, ui, cwd);
        if (shouldExit) break;
        continue;
      }
      await runConversationTurn(core, inputText, ui);
    }
  } finally {
    rl.close();
    process.stdout.write(colors.reset);
  }
}

async function runConversationTurn(core, inputText, ui) {
  ui.line(`${colors.dim('You:')} ${inputText}`);
  let didStream = false;
  const result = await core.handleUserMessage(inputText, {
    activity: (text) => ui.activity(text),
    streamStart: (label) => {
      didStream = true;
      ui.streamStart(label);
    },
    streamChunk: (chunk) => ui.streamChunk(chunk),
    streamEnd: () => ui.streamEnd()
  });
  if (result.text && !didStream) {
    ui.streamStart('EDITH');
    ui.streamChunk(result.text);
    ui.streamEnd();
  }
}

async function handleSlashCommand(inputText, core, ui, cwd) {
  const [command, ...parts] = inputText.slice(1).trim().split(/\s+/);
  const rest = parts.join(' ').trim();
  if (command === 'exit' || command === 'quit') return true;
  if (command === 'help') return printSessionHelp(ui);
  if (command === 'status') return printStatus(core, ui);
  if (command === 'trace') return printTrace(core, ui);
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
  if (command === 'agents') return printAgents(await core.listAgents(), ui);
  if (command === 'tools') return printTools(core.listTools(), ui);
  if (command === 'context') {
    await runConversationTurn(core, 'What personal context can you access?', ui);
    return false;
  }
  if (command === 'brief') {
    await runConversationTurn(core, rest ? `Give me an ${rest} brief` : 'Give me my brief.', ui);
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
    await runConversationTurn(core, `Ask ${agent} ${promptParts.join(' ')}`, ui);
    return false;
  }
  ui.error(`Unknown command: /${command}. Try /help.`);
  return false;
}

function printNativeBanner(core, ui) {
  const status = core.status();
  const workspace = compactHome(status.workspace);
  const cwd = compactHome(status.cwd);
  const model = `${status.model} · ${status.provider}`;
  const branch = status.branch ? ` · ${status.branch}` : '';
  const lines = [
    colors.bold('EDITH'),
    'Local AI Orchestrator',
    '',
    `${model}`,
    `${cwd}${status.gitRoot ? ` · repo ${workspace}${branch}` : ''}`,
    `agents OpenCode · Claude · Codex   tools ${status.toolsReady} ready`,
    '',
    colors.dim('Type naturally. Use /help for commands. End a line with \\ for multiline input.')
  ];
  const width = Math.max(62, ...lines.map(stripAnsi).map((line) => line.length));
  ui.line(colors.cyan(`┌${'─'.repeat(width + 2)}┐`));
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    ui.line(colors.cyan('│ ') + line + ' '.repeat(width - visible) + colors.cyan(' │'));
  }
  ui.line(colors.cyan(`└${'─'.repeat(width + 2)}┘`));
}

function printSessionHelp(ui) {
  ui.section('Session Commands');
  ui.line('/help                 Show commands');
  ui.line('/model [provider:id]  Show or switch model');
  ui.line('/models               List live local models');
  ui.line('/agents               Show specialist agents');
  ui.line('/tools                Show approved tools');
  ui.line('/context              Show personal-context connector status');
  ui.line('/brief                Build an on-demand personal brief');
  ui.line('/status               Show current session status');
  ui.line('/trace                Show last routing/tool trace');
  ui.line('/doctor               Run EDITH doctor');
  ui.line('/clear or /new        Clear conversation context');
  ui.line('/exit                 Leave EDITH');
  return false;
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

function printAgents(agents, ui) {
  ui.section('Agents');
  for (const agent of agents) {
    ui.line(`${agent.available ? 'ready' : 'unavailable'} ${agent.name} ${agent.version || ''}`);
    ui.line(`  ${agent.capabilities.join(', ')}`);
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

function compactHome(value) {
  const home = process.env.HOME;
  return home && value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
