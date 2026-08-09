import { Risk } from './policy.js';

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.id, tool);
    return tool;
  }

  list() {
    return [...this.tools.values()];
  }
}

export function createDefaultToolRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    id: 'web_search',
    name: 'web_search',
    description: 'Search current internet information through a configured backend.',
    source: 'edith',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    risk: Risk.NETWORK,
    permissions: ['backend-required'],
    availability: 'NOT_CONFIGURED'
  });
  registry.register({
    id: 'web_fetch',
    name: 'web_fetch',
    description: 'Fetch a webpage through a configured backend.',
    source: 'edith',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    risk: Risk.NETWORK,
    permissions: ['backend-required'],
    availability: 'NOT_CONFIGURED'
  });
  registry.register({
    id: 'documentation_lookup',
    name: 'documentation_lookup',
    description: 'Retrieve current technical documentation through a configured docs/search backend.',
    source: 'edith',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    risk: Risk.NETWORK,
    permissions: ['backend-required'],
    availability: 'NOT_CONFIGURED'
  });
  return registry;
}
