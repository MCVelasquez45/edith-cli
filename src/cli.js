import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createProviderRouter } from './providers/index.js';
import { TerminalUI, colors } from './ui/terminal.js';
import { runDoctor } from './doctor.js';
import { AgentRegistry } from './agents/registry.js';
import { EdithMcpClient } from './mcp/client.js';
import { McpRegistry } from './mcp/registry.js';
import { serveEdithMcpStdio } from './mcp/server.js';
import { createDefaultToolRegistry } from './tools/registry.js';
import { runNativeEdith } from './native/interactive-cli.js';
import { ContextConnectorRegistry } from './context/registry.js';
import { AuthRegistry } from './auth/registry.js';
import { AuthState } from './auth/errors.js';
import { AuditLog } from './audit.js';

const VERSION = '0.1.0';
const DEFAULT_CODE_MODEL = process.env.EDITH_CODE_MODEL ?? 'lmstudio-local/qwen/qwen3-vl-4b';

export async function main(args) {
  const command = args[0] ?? 'native';
  const cwd = process.cwd();
  const ui = new TerminalUI();

  if (command === '--version' || command === '-v') return console.log(VERSION);
  if (command === '--help' || command === '-h' || command === 'help') return printHelp();
  if (command === 'native' || command === '--model') return runNativeEdith({ cwd, ui, args });
  if (command === 'mcp-server') return serveEdithMcpStdio();
  if (command === 'doctor') return runDoctor({ cwd, ui });
  if (command === 'code') return runCode(args.slice(1), cwd);
  if (command === 'chat') return runChat(args.slice(1), cwd, ui);
  if (command === 'ask') return runAsk(args.slice(1), cwd, ui);
  if (command === 'agents') return printAgents();
  if (command === 'auth') return runAuth(args.slice(1), ui);
  if (command === 'context') return runContext(args.slice(1), cwd);
  if (command === 'mcp') return runMcp(args.slice(1), ui);
  if (command === 'tools') return runTools(args.slice(1));

  const router = await createProviderRouter({ ui });
  if (command === 'providers') return printProviders(router);
  if (command === 'models') return printModels(router);
  throw new Error(`Unknown command: ${command}. Try edith --help.`);
}

function printHelp() {
  console.log(`EDITH ${VERSION}

Usage:
  edith                 Launch native EDITH conversational agent
  edith --model <provider:model>
  edith code            Launch OpenCode with EDITH's verified local coding model
  edith code --model <provider/model>
  edith chat            Start direct local streaming chat
  edith chat --model <provider:model-id>
  edith models          List live local model inventory
  edith providers       List local provider health
  edith agents          List available coding agents
  edith auth google --profile personal --scope calendar
                         Connect Google Workspace with local OAuth
  edith auth status     Show authentication status
  edith context status  Show read-only personal context connector status
  edith ask local       Ask the default local model
  edith ask claude      Delegate a prompt to Claude Code
  edith ask codex       Delegate a prompt to Codex
  edith ask opencode    Delegate a prompt to OpenCode non-interactive mode
  edith ask opencode --auto <prompt>
  edith mcp status      Check EDITH-owned MCP servers
  edith tools list      List normalized EDITH tool registry
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

async function printAgents() {
  const registry = new AgentRegistry();
  for (const agent of await registry.list()) {
    console.log(`${agent.available ? 'OK' : 'FAIL'} ${agent.name}`);
    console.log(`  id: ${agent.id}`);
    console.log(`  version: ${agent.version || 'unknown'}`);
    console.log(`  integration: ${agent.integrationType}`);
    console.log(`  capabilities: ${agent.capabilities.join(', ')}`);
    console.log(`  detail: ${agent.detail}`);
  }
}

async function runAuth(args, ui) {
  const sub = args[0] ?? 'status';
  const options = parseAuthOptions(args.slice(1));
  const registry = new AuthRegistry();
  const google = registry.get('google', options.profile);
  const audit = new AuditLog();
  if (sub === 'status') return printAuthStatus(await registry.status());
  if (sub === 'google') {
    const status = await google.status();
    if (status.status === AuthState.NOT_CONFIGURED) {
      await audit.record({ type: 'google_auth_failed', provider: 'google', reason: 'not_configured' });
      printAuthStatus([status]);
      console.log('');
      console.log(googleSetupInstructions());
      return;
    }
    try {
      await audit.record({ type: 'google_auth_started', provider: 'google', profile: options.profile, scopes: options.scopeKeys });
      const result = await google.authenticate({ ui, scopeKeys: options.scopeKeys });
      await audit.record({ type: 'google_auth_completed', provider: 'google', account: result.account, scopes: result.scopes });
      console.log('Google Workspace connected successfully.');
      return printAuthStatus([result]);
    } catch (error) {
      await audit.record({ type: 'google_auth_failed', provider: 'google', status: error.status, code: error.code });
      console.log(`Google Workspace authorization failed: ${error.message}`);
      if (error.status === AuthState.ADMIN_APPROVAL_REQUIRED) {
        console.log('');
        console.log('GOOGLE AUTH: ADMIN APPROVAL REQUIRED');
        console.log('');
        const provider = registry.get('google', options.profile);
        const client = await provider.loadClientConfig().catch(() => null);
        if (client) console.log(provider.adminApprovalRequest(client));
      }
      return;
    }
  }
  if (sub === 'logout' && args[1] === 'google') {
    await google.logout();
    await audit.record({ type: 'google_auth_revoked', provider: 'google' });
    console.log('Google Workspace local tokens removed from EDITH.');
    return;
  }
  throw new Error(`Unknown auth command: ${sub}`);
}

function printAuthStatus(rows) {
  for (const row of rows) {
    console.log(row.name.toUpperCase());
    console.log(`Profile: ${row.profile ?? 'default'}`);
    console.log(`Status: ${row.status}`);
    console.log(`Account: ${row.account ?? '(none)'}`);
    console.log(`Access: ${row.status === 'CONNECTED' ? 'Read-only foundation' : '(none)'}`);
    console.log('Scopes:');
    const scopes = row.approvedScopes?.length ? row.approvedScopes : row.scopes;
    for (const scope of scopes.length ? scopes : ['(none)']) console.log(`  - ${scope}`);
    console.log(`Token: ${row.token}`);
    console.log(`Refresh: ${row.refresh}`);
    console.log(`Token storage: ${row.storage}`);
    console.log(`Detail: ${row.detail}`);
  }
}

function parseAuthOptions(args) {
  const options = { profile: 'personal', scopeKeys: ['identity'] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile') {
      options.profile = args[index + 1] ?? options.profile;
      index += 1;
      continue;
    }
    if (arg === '--scope') {
      const value = args[index + 1];
      if (value === 'calendar') options.scopeKeys = ['identity', 'calendar'];
      if (value === 'identity') options.scopeKeys = ['identity'];
      index += 1;
    }
  }
  return options;
}

function googleSetupInstructions() {
  return [
    'Google OAuth setup required:',
    '1. In Google Cloud Console, create or select a project.',
    '2. Configure the OAuth consent screen for the intended Workspace audience.',
    '3. Create an OAuth client of type Desktop application.',
    '4. Download the client JSON and store it outside Git at ~/.config/edith/google-oauth-client.json,',
    '   or set EDITH_GOOGLE_CLIENT_ID and EDITH_GOOGLE_CLIENT_SECRET in your local environment.',
    '5. Run edith auth google --profile personal --scope calendar again.',
    '',
    'For the Calendar POC, EDITH will request: openid email profile and Google Calendar read-only.',
    'Redirect: http://127.0.0.1:<random-port>/oauth/google/callback.',
    'Tokens will be stored in macOS Keychain; non-secret metadata is stored under ~/.config/edith.'
  ].join('\n');
}

async function runContext(args, cwd) {
  const sub = args[0] ?? 'status';
  if (sub !== 'status') throw new Error(`Unknown context command: ${sub}`);
  const registry = new ContextConnectorRegistry({ cwd });
  for (const row of await registry.status({ refresh: true })) {
    console.log(`${row.health === 'CONNECTED' ? 'OK' : 'WARN'} ${row.name}`);
    console.log(`  source: ${row.sourceType}`);
    console.log(`  account: ${row.accountIdentity ?? '(none)'}`);
    console.log(`  read-only: ${row.readOnly ? 'yes' : 'no'}`);
    console.log(`  capabilities: ${row.capabilities.join(', ')}`);
    console.log(`  detail: ${row.detail}`);
  }
}

async function runAsk(args, cwd, ui) {
  const target = args[0];
  const options = parseAskOptions(args.slice(1));
  const prompt = options.prompt;
  if (!target || !prompt) throw new Error('Usage: edith ask <local|claude|codex|opencode> <prompt>');
  if (target === 'local') {
    const router = await createProviderRouter({ ui });
    const selected = selectChatModel(router, options.model);
    router.setCurrent(selected.providerId, selected.model.id);
    ui.streamStart('EDITH local');
    for await (const chunk of await router.stream([{ role: 'user', content: prompt }], { maxTokens: 900 })) ui.streamChunk(chunk);
    ui.streamEnd();
    return;
  }
  const registry = new AgentRegistry();
  const agent = registry.get(target);
  if (!agent) throw new Error(`Unknown agent: ${target}`);
  const result = await agent.sendTask(prompt, { cwd, model: options.model, autoApprove: options.autoApprove });
  ui.streamStart(agent.name);
  ui.streamChunk(result.text || '(no visible response)');
  ui.streamEnd();
}

function parseAskOptions(args) {
  const rest = [];
  const options = { model: null, autoApprove: false, prompt: '' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model') {
      options.model = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--auto') {
      options.autoApprove = true;
      continue;
    }
    rest.push(arg);
  }
  options.prompt = rest.join(' ').trim();
  return options;
}

async function runMcp(args, ui) {
  const sub = args[0] ?? 'status';
  const registry = await McpRegistry.load();
  const client = new EdithMcpClient({ registry });
  if (sub === 'list') return printMcpList(registry);
  if (sub === 'status') return printMcpStatus(await client.status());
  if (sub === 'inspect') return printJson(await client.inspect(requiredArg(args, 1, 'server')));
  if (sub === 'tools') return printMcpTools(await client.listTools(requiredArg(args, 1, 'server')));
  if (sub === 'resources') return printMcpResources(await client.listResources(requiredArg(args, 1, 'server')));
  if (sub === 'prompts') return printMcpPrompts(await client.listPrompts(requiredArg(args, 1, 'server')));
  if (sub === 'test') return runMcpTest(client, args[1] ?? 'self', ui);
  if (sub === 'discover') return runMcpDiscover();
  if (sub === 'add' || sub === 'remove') throw new Error('MCP add/remove are intentionally not implemented yet; edit EDITH config explicitly after review.');
  throw new Error(`Unknown MCP command: ${sub}`);
}

function printMcpList(registry) {
  for (const server of registry.listServers()) {
    console.log(`${server.enabled ? 'ENABLED' : 'DISABLED'} ${server.id}`);
    console.log(`  transport: ${server.transport}`);
    if (server.command) console.log(`  command: ${server.command} ${(server.args ?? []).join(' ')}`);
    if (server.url) console.log(`  url: ${server.url}`);
    console.log(`  allowed tools: ${(server.allowTools ?? []).join(', ') || '(none)'}`);
  }
}

function printMcpStatus(rows) {
  for (const row of rows) console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.id}: ${row.detail}`);
}

function printMcpTools(tools) {
  for (const tool of tools) {
    console.log(`${tool.name}`);
    if (tool.description) console.log(`  ${tool.description}`);
  }
}

function printMcpResources(resources) {
  for (const resource of resources) console.log(`${resource.uri}${resource.name ? ` · ${resource.name}` : ''}`);
}

function printMcpPrompts(prompts) {
  for (const prompt of prompts) console.log(`${prompt.name}${prompt.description ? ` · ${prompt.description}` : ''}`);
}

async function runMcpTest(client, server, ui) {
  const tools = await client.listTools(server);
  ui.line(`tools: ${tools.map((tool) => tool.name).join(', ')}`);
  const result = await client.callTool(server, 'edith_status', {});
  ui.line(`read-only tool: ${mcpText(result).slice(0, 500)}`);
}

async function runMcpDiscover() {
  const candidates = [
    ['Claude', `${process.env.HOME}/.claude.json`],
    ['Claude settings', `${process.env.HOME}/.claude/settings.json`],
    ['Codex', `${process.env.HOME}/.codex/config.toml`],
    ['Project MCP', `${process.cwd()}/.mcp.json`]
  ];
  for (const [name, file] of candidates) {
    const exists = await import('node:fs/promises').then((fs) => fs.access(file).then(() => true, () => false));
    if (exists) console.log(`FOUND ${name}: ${file}`);
  }
  console.log('No servers imported. EDITH MCP imports require explicit review.');
}

function runTools(args) {
  const sub = args[0] ?? 'list';
  if (sub !== 'list') throw new Error(`Unknown tools command: ${sub}`);
  for (const tool of createDefaultToolRegistry().list()) {
    console.log(`${tool.availability} ${tool.id}`);
    console.log(`  source: ${tool.source}`);
    console.log(`  risk: ${tool.risk}`);
    console.log(`  ${tool.description}`);
  }
}

function requiredArg(args, index, name) {
  if (!args[index]) throw new Error(`Missing ${name}`);
  return args[index];
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function mcpText(result) {
  return (result.content ?? []).map((item) => item.text ?? JSON.stringify(item)).join('\n');
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
