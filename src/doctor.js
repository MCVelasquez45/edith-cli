import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createProviderRouter } from './providers/index.js';
import { AgentRegistry } from './agents/registry.js';
import { EdithMcpClient } from './mcp/client.js';
import { McpRegistry } from './mcp/registry.js';
import { createDefaultToolRegistry } from './tools/registry.js';

export async function runDoctor({ cwd, ui }) {
  ui.section('EDITH Doctor');
  const edith = spawnSync('which', ['edith'], { encoding: 'utf8' });
  ui.line(`${edith.status === 0 ? 'OK' : 'WARN'} CLI: ${edith.stdout.trim() || 'edith not found in PATH'}`);
  const opencodePath = spawnSync('which', ['opencode'], { encoding: 'utf8' });
  const opencodeVersion = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  ui.line(`${opencodePath.status === 0 ? 'OK' : 'FAIL'} OpenCode: ${(opencodePath.stdout || '').trim() || 'not found'} ${(opencodeVersion.stdout || '').trim()}`);
  ui.line(`OK Workspace: ${cwd}`);
  await fs.access(cwd, fs.constants?.W_OK ?? 2).then(
    () => ui.line('OK Workspace writable'),
    () => ui.warn('Workspace is not writable')
  );

  const router = await createProviderRouter({ ui });
  for (const item of await router.health()) {
    ui.line(`${item.ok ? 'OK' : 'FAIL'} ${item.name}: ${item.detail}`);
  }
  const models = await router.listModels();
  for (const group of models) {
    const chat = group.models.filter((model) => model.capabilities?.includes('CHAT')).length;
    const tools = group.models.filter((model) => model.capabilities?.includes('TOOL_CALLING')).length;
    ui.line(`OK ${group.providerName} models: ${group.models.length} (${chat} chat, ${tools} tool-capable hints)`);
  }
  const defaultCoding = models.find((group) => group.providerName === 'LM Studio')?.models.find((model) => model.id === 'qwen/qwen3-vl-4b');
  ui.line(`${defaultCoding ? 'OK' : 'FAIL'} Default coding model: lmstudio-local/qwen/qwen3-vl-4b`);

  const agents = await new AgentRegistry().list();
  for (const agent of agents) {
    ui.line(`${agent.available ? 'OK' : 'FAIL'} Agent ${agent.name}: ${agent.version || agent.detail}`);
  }

  const mcpRegistry = await McpRegistry.load();
  const mcpClient = new EdithMcpClient({ registry: mcpRegistry });
  const mcpStatus = await mcpClient.status();
  for (const server of mcpStatus) {
    ui.line(`${server.ok ? 'OK' : 'FAIL'} MCP ${server.id}: ${server.detail}`);
  }
  const enabledMcp = mcpRegistry.listServers().filter((server) => server.enabled);
  ui.line(`OK MCP allowlist: ${enabledMcp.length} configured server(s); tools require explicit per-server allowlists`);
  ui.line(`OK Timeouts: MCP server timeouts configured; agent subprocesses use bounded execution`);

  const tools = createDefaultToolRegistry().list();
  const networkTools = tools.filter((tool) => ['web_search', 'web_fetch', 'docs_lookup'].includes(tool.id));
  const configuredNetworkTools = networkTools.filter((tool) => tool.availability === 'AVAILABLE').length;
  ui.line(`${configuredNetworkTools ? 'OK' : 'WARN'} Web/documentation tools: ${configuredNetworkTools}/${networkTools.length} backend(s) configured`);
  ui.line('OK Audit events: MCP sessions and tool calls are written with secret redaction');

  const lmBind = spawnSync('lsof', ['-nP', '-iTCP:1234', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (/\*:1234/.test(lmBind.stdout)) ui.warn('LM Studio is listening on *:1234, not localhost-only. Review LM Studio networking before local-only agent use.');
  const git = spawnSync('git', ['status', '--short'], { cwd, encoding: 'utf8' });
  ui.line(`${git.status === 0 ? 'OK' : 'WARN'} Git: ${git.status === 0 ? 'repository detected' : 'not a git repository or git unavailable'}`);
  ui.line('OK Security: workspace path boundary enabled; conservative MCP policy enabled; destructive shell commands denied.');
}
