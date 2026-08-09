import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createProviderRouter } from './providers/index.js';
import { TerminalUI, colors } from './ui/terminal.js';
import { runDoctor } from './doctor.js';

const VERSION = '0.1.0';
const DEFAULT_CODE_MODEL = process.env.EDITH_CODE_MODEL ?? 'lmstudio-local/qwen/qwen3-vl-4b';

export async function main(args) {
  const command = args[0] ?? 'code';
  const cwd = process.cwd();
  const ui = new TerminalUI();

  if (command === '--version' || command === '-v') return console.log(VERSION);
  if (command === '--help' || command === '-h' || command === 'help') return printHelp();
  if (command === 'doctor') return runDoctor({ cwd, ui });
  if (command === 'code') return runCode(args.slice(1), cwd);
  if (command === 'chat') return runChat(args.slice(1), cwd, ui);

  const router = await createProviderRouter({ ui });
  if (command === 'providers') return printProviders(router);
  if (command === 'models') return printModels(router);
  throw new Error(`Unknown command: ${command}. Try edith --help.`);
}

function printHelp() {
  console.log(`EDITH ${VERSION}

Usage:
  edith                 Launch verified local coding-agent terminal
  edith code            Launch OpenCode with EDITH's verified local coding model
  edith code --model <provider/model>
  edith chat            Start direct local streaming chat
  edith chat --model <provider:model-id>
  edith models          List live local model inventory
  edith providers       List local provider health
  edith doctor          Diagnose local providers and security findings
  edith --version
`);
}

async function printProviders(router) {
  const health = await router.health();
  for (const item of health) {
    console.log(`${item.ok ? 'OK' : 'FAIL'} ${item.name} ${item.detail}`);
  }
}

async function printModels(router) {
  const models = await router.listModels();
  for (const group of models) {
    console.log(`\n${group.providerName}`);
    for (const model of group.models) {
      const state = model.state ? ` (${model.state})` : '';
      const caps = model.capabilities?.length ? model.capabilities.join(', ') : 'UNKNOWN';
      const role = recommendedRole(group.providerId, model);
      console.log(`  ${model.id}${state}`);
      console.log(`    capabilities: ${caps}`);
      console.log(`    role: ${role}`);
      if (model.contextLength) console.log(`    context: ${model.contextLength}`);
    }
  }
}

function recommendedRole(providerId, model) {
  if (model.capabilities?.includes('EMBEDDING')) return 'embedding';
  if (providerId === 'lm-studio' && model.id === 'qwen/qwen3-vl-4b') return 'default coding';
  if (model.capabilities?.includes('TOOL_CALLING') && model.capabilities?.includes('CODING')) return 'coding candidate';
  if (model.capabilities?.includes('CHAT')) return 'chat';
  return 'unknown';
}

async function runCode(args, cwd) {
  const model = readFlag(args, '--model') ?? DEFAULT_CODE_MODEL;
  const passthrough = args.filter((arg, index) => arg !== '--model' && args[index - 1] !== '--model');
  const child = spawn('opencode', ['--model', model, ...passthrough], {
    cwd,
    stdio: 'inherit',
    env: process.env
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (exitCode, signal) => resolve(signal ? 130 : exitCode ?? 1));
  });
  process.exitCode = code;
}

function readFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
}

async function runChat(args, cwd, ui) {
  const router = await createProviderRouter({ ui });
  const selected = selectChatModel(router, readFlag(args, '--model'));
  router.setCurrent(selected.providerId, selected.model.id);
  ui.banner({
    provider: router.current.providerName,
    model: router.current.model.id,
    cwd,
    sessionId: 'direct-chat',
    approval: 'none'
  });
  ui.line(colors.dim('Type /exit to quit.'));
  const rl = createInterface({ input, output, terminal: true });
  while (true) {
    let line;
    try {
      line = await rl.question(colors.green('\nchat> '));
    } catch {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') break;
    ui.streamStart('EDITH');
    for await (const chunk of await router.stream([{ role: 'user', content: trimmed }])) ui.streamChunk(chunk);
    ui.streamEnd();
  }
  rl.close();
}

function selectChatModel(router, modelArg) {
  if (modelArg) {
    const parsed = parseModelArg(modelArg);
    const found = parsed
      ? router.findModel(parsed.providerId, parsed.modelId)
      : router.modelGroups.flatMap((g) => g.models.map((model) => ({ providerId: g.providerId, model }))).find((item) => item.model.id === modelArg);
    if (!found) throw new Error(`Model not found: ${modelArg}`);
    return found;
  }
  const preferred = router.findModel('lm-studio', 'qwen/qwen3-vl-4b');
  if (preferred) return preferred;
  for (const group of router.modelGroups) {
    const model = group.models.find((item) => item.capabilities?.includes('CHAT'));
    if (model) return { providerId: group.providerId, model };
  }
  throw new Error('No chat-capable local model found.');
}

function parseModelArg(value) {
  const idx = value.indexOf(':');
  if (idx < 0) return null;
  return { providerId: value.slice(0, idx), modelId: value.slice(idx + 1) };
}
