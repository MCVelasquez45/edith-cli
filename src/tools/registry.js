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
  for (const id of ['list_directory', 'read_file', 'search_files', 'git_status', 'git_diff', 'current_time', 'current_date', 'timezone', 'system_info']) {
    registry.register({
      id,
      name: id,
      description: nativeToolDescription(id),
      source: 'edith-native',
      inputSchema: nativeToolSchema(id),
      risk: id.startsWith('git_') ? Risk.WORKSPACE_READ : Risk.READ_ONLY,
      permissions: id.startsWith('current_') || id === 'timezone' || id === 'system_info' ? ['local-runtime', 'read-only'] : ['workspace-scoped', 'read-only'],
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
    permissions: ['network', 'public-web-only'],
    availability: 'AVAILABLE'
  });
  registry.register({
    id: 'web_fetch',
    name: 'web_fetch',
    description: 'Fetch a webpage through a configured backend.',
    source: 'edith',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    risk: Risk.NETWORK,
    permissions: ['network', 'public-web-only'],
    availability: 'AVAILABLE'
  });
  registry.register({
    id: 'docs_lookup',
    name: 'docs_lookup',
    description: 'Retrieve current technical documentation through a configured docs/search backend.',
    source: 'edith',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    risk: Risk.NETWORK,
    permissions: ['network', 'official-source-preferred'],
    availability: 'AVAILABLE'
  });
  registry.register({
    id: 'weather',
    name: 'weather',
    description: 'Retrieve structured current weather and forecast data for a location.',
    source: 'edith',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        days: { type: 'number' }
      },
      required: ['location']
    },
    risk: Risk.NETWORK,
    permissions: ['network', 'public-weather-api'],
    availability: 'AVAILABLE'
  });
  for (const id of ['context_status', 'context_events', 'context_next_event', 'context_unread_email', 'context_email_search', 'context_tasks', 'context_github', 'context_gitlab', 'context_brief']) {
    registry.register({
      id,
      name: id,
      description: contextToolDescription(id),
      source: 'edith-context',
      inputSchema: contextToolSchema(id),
      risk: Risk.EXTERNAL_SERVICE,
      permissions: ['read-only', 'bounded-results', 'local-first-synthesis'],
      availability: 'AVAILABLE'
    });
  }
  return registry;
}

function nativeToolDescription(id) {
  return {
    list_directory: 'List files and directories within the active workspace.',
    read_file: 'Read a text file within the active workspace.',
    search_files: 'Search text files within the active workspace.',
    git_status: 'Show Git status for the active workspace.',
    git_diff: 'Show the current Git diff for the active workspace.',
    current_time: 'Return the trusted current system time, optionally in a requested timezone.',
    current_date: 'Return the trusted current system date, optionally in a requested timezone.',
    timezone: 'Return the local system timezone.',
    system_info: 'Return trusted local OS and runtime information.'
  }[id];
}

function nativeToolSchema(id) {
  if (id === 'current_time' || id === 'current_date') return { type: 'object', properties: { timezone: { type: 'string' } } };
  if (id === 'read_file') return { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
  if (id === 'search_files') return { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
  if (id === 'list_directory') return { type: 'object', properties: { path: { type: 'string' } } };
  return { type: 'object', properties: {} };
}

function contextToolDescription(id) {
  return {
    context_status: 'Show read-only personal-context connector status.',
    context_events: 'Read normalized calendar events from configured read-only connectors.',
    context_next_event: 'Read the next calendar event from configured read-only connectors.',
    context_unread_email: 'Read bounded unread email metadata from configured read-only connectors.',
    context_email_search: 'Search bounded email metadata from configured read-only connectors.',
    context_tasks: 'Read normalized tasks from configured read-only connectors.',
    context_github: 'Read GitHub issues, pull requests, and notifications through the authenticated gh CLI.',
    context_gitlab: 'Read GitLab issues and merge requests through the authenticated glab CLI.',
    context_brief: 'Build an on-demand read-only personal briefing from normalized context.'
  }[id];
}

function contextToolSchema(id) {
  if (id === 'context_email_search') return { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] };
  if (id === 'context_events') return { type: 'object', properties: { range: { type: 'string' }, limit: { type: 'number' } } };
  if (id === 'context_brief') return { type: 'object', properties: { mode: { type: 'string', enum: ['brief', 'updated', 'end_of_day'] } } };
  return { type: 'object', properties: { limit: { type: 'number' } } };
}
