import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { McpRegistry } from './registry.js';
import { AuditLog } from '../audit.js';
import { Risk } from '../tools/policy.js';

export class EdithMcpClient {
  constructor({ registry, audit = new AuditLog() }) {
    this.registry = registry;
    this.audit = audit;
  }

  static async create() {
    return new EdithMcpClient({ registry: await McpRegistry.load() });
  }

  async withServer(serverId, fn) {
    const server = this.registry.getServer(serverId);
    if (!server) throw new Error(`Unknown MCP server: ${serverId}`);
    if (!server.enabled) throw new Error(`MCP server disabled: ${serverId}`);

    const client = new Client({ name: 'edith', version: '0.1.0' });
    const transport = createTransport(server);
    const started = Date.now();
    await client.connect(transport);
    try {
      return await withTimeout(fn(client, server), server.timeoutMs, `MCP server timed out: ${serverId}`);
    } finally {
      await client.close().catch(() => {});
      await this.audit.record({ type: 'mcp.session', server: serverId, durationMs: Date.now() - started, success: true });
    }
  }

  async status() {
    const rows = [];
    for (const server of this.registry.listServers()) {
      if (!server.enabled) {
        rows.push({ ...server, ok: false, detail: 'disabled' });
        continue;
      }
      try {
        await this.withServer(server.id, async (client) => client.ping());
        rows.push({ ...server, ok: true, detail: 'connected' });
      } catch (error) {
        rows.push({ ...server, ok: false, detail: error.message });
      }
    }
    return rows;
  }

  async inspect(serverId) {
    return this.withServer(serverId, async (client) => ({
      server: serverId,
      capabilities: client.getServerCapabilities(),
      version: client.getServerVersion(),
      protocol: client.getNegotiatedProtocolVersion()
    }));
  }

  async listTools(serverId) {
    return this.withServer(serverId, async (client) => (await client.listTools()).tools ?? []);
  }

  async listResources(serverId) {
    return this.withServer(serverId, async (client) => {
      try {
        return (await client.listResources()).resources ?? [];
      } catch (error) {
        if (isUnsupported(error)) return [];
        throw error;
      }
    });
  }

  async listPrompts(serverId) {
    return this.withServer(serverId, async (client) => {
      try {
        return (await client.listPrompts()).prompts ?? [];
      } catch (error) {
        if (isUnsupported(error)) return [];
        throw error;
      }
    });
  }

  async callTool(serverId, name, args = {}) {
    return this.withServer(serverId, async (client, server) => {
      if (!server.allowTools.includes(name)) throw new Error(`Tool not allowed by EDITH MCP policy: ${serverId}/${name}`);
      const started = Date.now();
      const result = await client.callTool({ name, arguments: args });
      await this.audit.record({ type: 'mcp.tool', server: serverId, tool: name, risk: Risk.READ_ONLY, durationMs: Date.now() - started, success: true });
      return result;
    });
  }
}

function createTransport(server) {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      cwd: server.cwd,
      env: server.env,
      stderr: 'pipe'
    });
  }
  if (server.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.url));
  }
  throw new Error(`Unsupported MCP transport: ${server.transport}`);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function isUnsupported(error) {
  return /Method not found|not support|capability/i.test(error?.message ?? '');
}
