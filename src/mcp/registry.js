import { loadConfig } from '../config.js';

export class McpRegistry {
  constructor(config) {
    this.config = config;
  }

  static async load() {
    return new McpRegistry(await loadConfig());
  }

  listServers() {
    return Object.entries(this.config.mcp?.servers ?? {}).map(([id, server]) => ({
      id,
      enabled: server.enabled !== false,
      transport: server.transport,
      command: server.command,
      args: server.args ?? [],
      url: server.url,
      allowTools: server.allowTools ?? [],
      timeoutMs: server.timeoutMs ?? this.config.tools?.defaultTimeoutMs ?? 30000
    }));
  }

  getServer(id) {
    return this.listServers().find((server) => server.id === id);
  }
}
