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

  get(id) {
    return this.tools.get(id);
  }
}

export function createDefaultToolRegistry() {
  const registry = new ToolRegistry();
  for (const id of ['list_directory', 'read_file', 'search_files', 'git_status', 'git_diff']) {
    registry.register({
      id,
      name: id,
      description: nativeToolDescription(id),
      source: 'edith-native',
      inputSchema: nativeToolSchema(id),
      risk: id.startsWith('git_') ? Risk.WORKSPACE_READ : Risk.READ_ONLY,
      permissions: ['workspace-scoped', 'read-only'],
      availability: 'AVAILABLE'
    });
  }
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

function nativeToolDescription(id) {
  return {
    list_directory: 'List files and directories within the active workspace.',
    read_file: 'Read a text file within the active workspace.',
    search_files: 'Search text files within the active workspace.',
    git_status: 'Show Git status for the active workspace.',
    git_diff: 'Show the current Git diff for the active workspace.'
  }[id];
}

function nativeToolSchema(id) {
  if (id === 'read_file') return { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
  if (id === 'search_files') return { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
  if (id === 'list_directory') return { type: 'object', properties: { path: { type: 'string' } } };
  return { type: 'object', properties: {} };
}
