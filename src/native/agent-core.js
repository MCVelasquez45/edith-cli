import { createProviderRouter } from '../providers/index.js';
import { AgentRegistry } from '../agents/registry.js';
import { createDefaultToolRegistry } from '../tools/registry.js';
import { loadConfig } from '../config.js';
import { WorkspaceTools, detectWorkspace } from './workspace-tools.js';
import { SystemTools, extractTimezoneRequest } from './system-tools.js';
import { NetworkRegistry } from '../network/providers.js';

const MAX_MESSAGES = 24;
const MAX_TOOL_CONTEXT = 18000;

export class EdithAgentCore {
  constructor({ cwd = process.cwd(), ui = null } = {}) {
    this.cwd = cwd;
    this.ui = ui;
    this.history = [];
    this.trace = [];
    this.maxIterations = 4;
    this.agentRegistry = new AgentRegistry();
    this.toolRegistry = createDefaultToolRegistry();
    this.systemTools = new SystemTools();
    this.network = new NetworkRegistry();
    this.agentHealth = [];
  }

  async initialize({ modelArg = null } = {}) {
    this.config = await loadConfig(this.cwd);
    this.workspaceInfo = await detectWorkspace(this.cwd);
    this.workspaceTools = new WorkspaceTools({ workspace: this.workspaceInfo.workspace });
    this.router = await createProviderRouter({ ui: this.ui });
    this.agentHealth = await this.agentRegistry.list();
    const configured = parseModelArg(modelArg) ?? {
      providerId: this.config.defaults.defaultAssistantProvider,
      modelId: this.config.defaults.defaultAssistantModel
    };
    await this.router.selectInitial(configured.providerId, configured.modelId);
    return this;
  }

  status() {
    return {
      model: this.router.current?.model?.id ?? 'none',
      provider: this.router.current?.providerName ?? 'none',
      providerId: this.router.current?.providerId ?? 'none',
      cwd: this.workspaceInfo.cwd,
      workspace: this.workspaceInfo.workspace,
      gitRoot: this.workspaceInfo.gitRoot,
      branch: this.workspaceInfo.branch,
      toolsReady: this.toolRegistry.list().filter((tool) => tool.availability === 'AVAILABLE').length,
      webReady: this.toolRegistry.get('web_search')?.availability === 'AVAILABLE'
    };
  }

  async listModels() {
    return this.router.listModels();
  }

  async switchModel(modelArg) {
    const parsed = parseModelArg(modelArg);
    const found = parsed
      ? this.router.findModel(parsed.providerId, parsed.modelId)
      : this.router.modelGroups.flatMap((group) => group.models.map((model) => ({ providerId: group.providerId, model }))).find((item) => item.model.id === modelArg);
    if (!found) throw new Error(`Model not found: ${modelArg}`);
    if (found.model.capabilities?.includes('EMBEDDING')) throw new Error(`Model is not chat-capable: ${modelArg}`);
    return this.router.setCurrent(found.providerId, found.model.id);
  }

  async listAgents() {
    return this.agentRegistry.list();
  }

  listTools() {
    return this.toolRegistry.list();
  }

  clear() {
    this.history = [];
    this.trace = [];
  }

  lastTrace() {
    return [...this.trace];
  }

  async handleUserMessage(input, events = {}) {
    const userText = input.trim();
    if (!userText) return { text: '', route: 'empty' };
    this.history.push({ role: 'user', content: userText });
    this.pruneHistory();

    const plan = this.route(userText);
    this.trace = [{ type: 'route', route: plan.route, reason: plan.reason }];
    let result;
    try {
      result = await this.executePlan(plan, userText, events);
    } catch (error) {
      result = { text: `I hit an error: ${error.message}`, route: plan.route, error };
    }
    if (result.text) this.history.push({ role: 'assistant', content: result.text });
    this.pruneHistory();
    return result;
  }

  route(text) {
    const lower = text.toLowerCase();
    if (/^reply with exactly\b/.test(lower)) return { route: 'local', reason: 'exact response request' };
    if (/\bwhat\s+time\b|\btime\s+is\s+it\b|\bcurrent\s+time\b/.test(lower)) return { route: 'system:time', reason: 'live time request' };
    if (/\bwhat\s+(day|date)\b|\bcurrent\s+date\b|\btoday'?s\s+date\b/.test(lower)) return { route: 'system:date', reason: 'live date request' };
    if (/\btimezone\b|\btime\s+zone\b/.test(lower)) return { route: 'system:timezone', reason: 'timezone request' };
    if (/\bsystem info\b|\babout this mac\b|\bwhat machine\b/.test(lower)) return { route: 'system:info', reason: 'system information request' };
    if (/\bwhat agents\b|\bagents can you\b|\bcan you use\b.*\bagents\b|\bis claude available\b/.test(lower)) return { route: 'status:agents', reason: 'agent availability request' };
    if (/\bcan you search the web\b|\bweb search configured\b/.test(lower)) return { route: 'status:web', reason: 'web capability request' };
    if (extractUrl(text)) return { route: 'network:fetch', reason: 'URL fetch request' };
    if (/\bwhat branch\b|\bwhich branch\b|\bbranch am i on\b/.test(lower)) return { route: 'workspace:branch', reason: 'Git branch request' };
    if (/\b(what are we building|this repo|this repository|our current edith architecture|current edith architecture|edith architecture|architecture match|project)\b/.test(lower)) {
      return { route: 'workspace:repo', reason: 'repository understanding request' };
    }
    if (/\b(ask|have|tell|use|delegate to)\s+codex\b/.test(lower)) return { route: 'agent:codex', reason: 'explicit Codex request' };
    if (/\b(ask|have|tell|use|delegate to)\s+claude\b/.test(lower)) return { route: 'agent:claude', reason: 'explicit Claude request' };
    if (/\b(ask|have|tell|use|delegate to)\s+opencode\b/.test(lower) || /\bfix\b.*\btests?\b/.test(lower) || /\bmake the changes\b/.test(lower)) {
      return { route: 'agent:opencode', reason: 'coding-agent request' };
    }
    if (/\b(current|latest|recent|release|version|documentation|docs|api|sdk|search the web|look up|check the current)\b/.test(lower)) {
      return /\b(documentation|docs|api|sdk)\b/.test(lower)
        ? { route: 'network:docs', reason: 'current documentation request' }
        : { route: 'network:search', reason: 'current information request' };
    }
    if (/\b(git status|changed in git|what'?s changed|git diff|changed in this repository)\b/.test(lower)) return { route: 'workspace:git', reason: 'workspace Git request' };
    if (/\b(directory|folder|working in|launched)\b/.test(lower)) return { route: 'workspace:cwd', reason: 'workspace location request' };
    if (/\b(model|provider|running)\b/.test(lower)) return { route: 'status:model', reason: 'model status request' };
    return { route: 'local', reason: 'general conversation' };
  }

  async executePlan(plan, userText, events) {
    if (plan.route === 'system:time') return this.answerCurrentTime(userText, events);
    if (plan.route === 'system:date') return this.answerCurrentDate(userText, events);
    if (plan.route === 'system:timezone') return this.answerTimezone(events);
    if (plan.route === 'system:info') return this.answerSystemInfo(events);
    if (plan.route === 'status:agents') return this.answerAgentStatus(events);
    if (plan.route === 'status:web') return this.answerWebStatus(events);
    if (plan.route === 'network:search') return this.answerNetworkSearch(userText, events);
    if (plan.route === 'network:docs') return this.answerDocsLookup(userText, events);
    if (plan.route === 'network:fetch') return this.answerUrlFetch(userText, events);
    if (plan.route === 'status:model') return this.answerModelStatus();
    if (plan.route === 'workspace:cwd') return this.answerWorkspaceStatus();
    if (plan.route === 'workspace:branch') return this.answerBranchStatus(events);
    if (plan.route === 'workspace:git') return this.answerWithWorkspaceTools(userText, ['git_status', 'git_diff'], events);
    if (plan.route === 'workspace:repo') return this.answerWithWorkspaceTools(userText, ['list_directory', 'read_file:package.json', 'read_file:README.md', 'list_directory:src'], events);
    if (plan.route === 'agent:codex') return this.delegate('codex', userText, events);
    if (plan.route === 'agent:claude') return this.delegate('claude', userText, events);
    if (plan.route === 'agent:opencode') return this.delegate('opencode', userText, events);
    return this.answerLocal(userText, '', events);
  }

  answerModelStatus() {
    const status = this.status();
    const text = `I am using ${status.model} through ${status.provider}.`;
    return { text, route: 'status:model' };
  }

  answerWorkspaceStatus() {
    const status = this.status();
    const lines = [`You launched me from ${status.cwd}.`];
    if (status.gitRoot) lines.push(`The Git workspace root is ${status.gitRoot}${status.branch ? ` on branch ${status.branch}` : ''}.`);
    return { text: lines.join('\n'), route: 'workspace:cwd' };
  }

  answerCurrentTime(userText, events) {
    const timezone = extractTimezoneRequest(userText);
    const result = this.systemTools.currentTime({ timezone });
    this.trace.push({ type: 'tool', tool: 'current_time', title: result.title });
    events.activity?.(result.title);
    return {
      text: `The current time in ${result.timezone} is ${result.output}.`,
      route: 'system:time'
    };
  }

  answerCurrentDate(userText, events) {
    const timezone = extractTimezoneRequest(userText);
    const result = this.systemTools.currentDate({ timezone });
    this.trace.push({ type: 'tool', tool: 'current_date', title: result.title });
    events.activity?.(result.title);
    return {
      text: `Today in ${result.timezone} is ${result.output}.`,
      route: 'system:date'
    };
  }

  answerTimezone(events) {
    const result = this.systemTools.timezone();
    this.trace.push({ type: 'tool', tool: 'timezone', title: result.title });
    events.activity?.(result.title);
    return { text: `Your local system timezone is ${result.output}.`, route: 'system:timezone' };
  }

  answerSystemInfo(events) {
    const result = this.systemTools.systemInfo();
    this.trace.push({ type: 'tool', tool: 'system_info', title: result.title });
    events.activity?.(result.title);
    return { text: result.output, route: 'system:info' };
  }

  async answerAgentStatus(events) {
    events.activity?.('Checking agent availability');
    this.trace.push({ type: 'agent_status', title: 'Checking agent availability' });
    const rows = await this.liveAgentStatus();
    const text = rows.map((agent) => `${agent.name}: ${agent.available ? 'available' : 'unavailable'}${agent.detail ? ` - ${agent.detail}` : ''}`).join('\n');
    return { text, route: 'status:agents' };
  }

  answerWebStatus(events) {
    events.activity?.('Checking web search backend');
    this.trace.push({ type: 'tool', tool: 'web_search', title: 'Checking web search backend' });
    const web = this.toolRegistry.get('web_search');
    const fetch = this.toolRegistry.get('web_fetch');
    const docs = this.toolRegistry.get('docs_lookup');
    const text = web?.availability === 'AVAILABLE'
      ? `Web search is configured. web_search=${web.availability}, web_fetch=${fetch?.availability ?? 'UNKNOWN'}, docs_lookup=${docs?.availability ?? 'UNKNOWN'}.`
      : `Web search is not configured. web_search=${web?.availability ?? 'UNKNOWN'}, web_fetch=${fetch?.availability ?? 'UNKNOWN'}.`;
    return { text, route: 'status:web' };
  }

  answerBranchStatus(events) {
    events.activity?.('Checking Git branch');
    this.trace.push({ type: 'tool', tool: 'git_status', title: 'Checking Git branch' });
    const text = this.workspaceInfo.branch
      ? `You are on Git branch ${this.workspaceInfo.branch}.`
      : 'I do not see an active Git branch from this workspace.';
    return { text, route: 'workspace:branch' };
  }

  async answerWithWorkspaceTools(userText, toolSpecs, events) {
    const toolResults = [];
    for (const spec of toolSpecs.slice(0, this.maxIterations + 1)) {
      const result = await this.runWorkspaceTool(spec, events);
      if (result) toolResults.push(result);
    }
    const context = toolResults.map((result) => `# ${result.title}\n${result.output}`).join('\n\n').slice(0, MAX_TOOL_CONTEXT);
    const prompt = `User request: ${userText}\n\nWorkspace context:\n${context}\n\nAnswer as EDITH. Be concise, concrete, and mention which evidence you used.`;
    return this.answerLocal(prompt, context, events, { route: 'workspace', maxTokens: 900 });
  }

  async runWorkspaceTool(spec, events) {
    const [name, value] = spec.split(':');
    if (this.toolRegistry.get(name)?.availability !== 'AVAILABLE') throw new Error(`Tool unavailable: ${name}`);
    let result;
    if (name === 'list_directory') result = await this.workspaceTools.listDirectory({ path: value || '.' });
    if (name === 'read_file') {
      try {
        result = await this.workspaceTools.readFile({ path: value });
      } catch (error) {
        result = { tool: name, title: `Reading ${value}`, output: `(unavailable: ${error.message})` };
      }
    }
    if (name === 'search_files') result = await this.workspaceTools.searchFiles({ query: value });
    if (name === 'git_status') result = await this.workspaceTools.gitStatus();
    if (name === 'git_diff') result = await this.workspaceTools.gitDiff();
    if (!result) throw new Error(`Unknown native tool: ${name}`);
    this.trace.push({ type: 'tool', tool: name, title: result.title });
    events.activity?.(result.title);
    return result;
  }

  async delegate(agentId, userText, events) {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const prompt = buildDelegationPrompt(userText, this.history);
    const label = agentId === 'opencode' ? 'Running OpenCode coding agent' : `Asking ${agent.name}`;
    events.activity?.(label);
    this.trace.push({ type: 'agent', agent: agentId, title: label });
    try {
      const result = await agent.sendTask(prompt, {
        cwd: this.workspaceInfo.workspace,
        autoApprove: agentId === 'opencode',
        timeoutMs: agentId === 'opencode' ? 180000 : 120000
      });
      const text = result.text || `${agent.name} returned no visible response.`;
      this.history.push({ role: 'tool', name: agentId, content: text.slice(0, 6000) });
      return { text, route: `agent:${agentId}`, raw: result };
    } catch (error) {
      return { text: `${agent.name} is unavailable: ${error.message}`, route: `agent:${agentId}`, error };
    }
  }

  async answerNetworkSearch(userText, events) {
    events.activity?.('Searching web');
    this.trace.push({ type: 'tool', tool: 'web_search', title: 'Searching web' });
    try {
      const results = await this.network.search({ query: userText, maxResults: 4 });
      if (!results.length) return { text: 'I could not find a configured authoritative source for that query.', route: 'network:search' };
      const fetched = [];
      for (const result of results.slice(0, 2)) {
        events.activity?.(`Fetching ${new URL(result.url).hostname}`);
        this.trace.push({ type: 'tool', tool: 'web_fetch', title: `Fetching ${result.url}` });
        fetched.push({ result, page: await this.network.fetch({ url: result.url }) });
      }
      return this.synthesizeNetworkAnswer(userText, fetched, events, 'network:search');
    } catch (error) {
      return { text: `EDITH could not retrieve current information: ${humanNetworkError(error)}`, route: 'network:search', error };
    }
  }

  async answerDocsLookup(userText, events) {
    events.activity?.('Reading official documentation');
    this.trace.push({ type: 'tool', tool: 'docs_lookup', title: 'Reading official documentation' });
    try {
      const docs = await this.network.lookupDocs({ query: userText, maxResults: 3 });
      if (!docs.length) return { text: 'I could not find configured official documentation for that request.', route: 'network:docs' };
      return this.synthesizeNetworkAnswer(userText, docs.map((doc) => ({ result: doc, page: doc.fetched })), events, 'network:docs');
    } catch (error) {
      return { text: `EDITH could not retrieve documentation: ${humanNetworkError(error)}`, route: 'network:docs', error };
    }
  }

  async answerUrlFetch(userText, events) {
    const url = extractUrl(userText);
    events.activity?.(`Fetching ${new URL(url).hostname}`);
    this.trace.push({ type: 'tool', tool: 'web_fetch', title: `Fetching ${url}` });
    try {
      const page = await this.network.fetch({ url });
      return this.synthesizeNetworkAnswer(userText, [{ result: { title: page.title, url: page.finalUrl, source: 'direct-url' }, page }], events, 'network:fetch');
    } catch (error) {
      return { text: `EDITH could not fetch that URL: ${humanNetworkError(error)}`, route: 'network:fetch', error };
    }
  }

  async synthesizeNetworkAnswer(userText, items, events, route) {
    const context = items.map(({ result, page }, index) => [
      `Source ${index + 1}: ${result.title}`,
      `URL: ${result.url}`,
      `Retrieved: ${page.retrievedAt}`,
      page.text
    ].join('\n')).join('\n\n').slice(0, MAX_TOOL_CONTEXT);
    const sources = items.map(({ result }, index) => `${index + 1}. ${result.title} - ${result.url}`).join('\n');
    const prompt = [
      `User request: ${userText}`,
      'Use only the retrieved external information below for current claims.',
      'Do not invent citations. Keep the answer concise.',
      '',
      context,
      '',
      `Sources to cite:\n${sources}`
    ].join('\n');
    const answer = await this.answerLocal(prompt, context, events, { route, maxTokens: 1000 });
    const text = `${answer.text}\n\nSources:\n${sources}`;
    if (answer.streamed) events.streamChunk?.(`\n\nSources:\n${sources}`);
    return { ...answer, text, route };
  }

  async liveAgentStatus() {
    const rows = await this.agentRegistry.list();
    const claude = this.agentRegistry.get('claude');
    const claudeRow = rows.find((row) => row.id === 'claude');
    if (claude && claudeRow?.available) {
      try {
        await claude.sendTask('Reply with exactly CLAUDE AVAILABILITY OK', { cwd: this.workspaceInfo.workspace, timeoutMs: 30000 });
        claudeRow.detail = 'runtime available';
      } catch (error) {
        claudeRow.available = false;
        claudeRow.detail = error.message;
      }
    }
    this.agentHealth = rows;
    return rows;
  }

  async answerLocal(userText, extraContext = '', events = {}, { route = 'local', maxTokens = 900 } = {}) {
    const messages = [
      { role: 'system', content: this.systemPrompt() },
      ...this.history.slice(-10).map(({ role, content }) => ({ role: role === 'tool' ? 'assistant' : role, content })),
      ...(extraContext ? [{ role: 'user', content: `Approved context:\n${extraContext}` }] : []),
      { role: 'user', content: userText }
    ];
    let text = '';
    let first = true;
    events.streamStart?.('EDITH');
    for await (const chunk of await this.router.stream(messages, { maxTokens })) {
      if (first) {
        this.trace.push({ type: 'stream', title: 'First token received' });
        first = false;
      }
      text += chunk;
      events.streamChunk?.(chunk);
    }
    events.streamEnd?.();
    return { text: text.trim(), route, streamed: true };
  }

  systemPrompt() {
    const status = this.status();
    return [
      'You are EDITH, the primary local-first AI orchestrator for this Mac.',
      'Prefer local models and read-only workspace tools when sufficient.',
      'OpenCode, Codex, and Claude are specialist agents that EDITH may delegate to when appropriate.',
      'Respect workspace boundaries. Do not expose secrets. Destructive work requires an approved specialist path.',
      'Use EDITH tools for live state. Never guess current time, date, timezone, Git branch, agent health, or web availability.',
      `Current model: ${status.model} via ${status.provider}.`,
      `Workspace: ${status.workspace}.`,
      this.capabilityManifest()
    ].join('\n');
  }

  capabilityManifest() {
    const availableTools = this.toolRegistry.list().filter((tool) => tool.availability === 'AVAILABLE').map((tool) => tool.id);
    const unavailableTools = this.toolRegistry.list().filter((tool) => tool.availability !== 'AVAILABLE').map((tool) => `${tool.id} - ${tool.availability}`);
    const agents = this.agentHealth.map((agent) => `${agent.name}: ${agent.available ? 'available' : `unavailable (${agent.detail})`}`);
    const providers = this.router.modelGroups.map((group) => `${group.providerName}: ${group.models.length} model(s)`);
    return [
      'Capability manifest:',
      `AVAILABLE tools: ${availableTools.join(', ') || 'none'}`,
      `UNAVAILABLE tools: ${unavailableTools.join(', ') || 'none'}`,
      `Agents: ${agents.join('; ') || 'unknown'}`,
      `Providers: ${providers.join('; ') || 'unknown'}`,
      'Workspace permissions: read/search/git status/git diff only; no native write or shell execution.',
      'Network permissions: public HTTP/HTTPS fetch only; localhost/private network/file URLs blocked.'
    ].join('\n');
  }

  pruneHistory() {
    if (this.history.length > MAX_MESSAGES) this.history = this.history.slice(-MAX_MESSAGES);
  }
}

function parseModelArg(value) {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon >= 0) return { providerId: value.slice(0, colon), modelId: value.slice(colon + 1) };
  const slash = value.indexOf('/');
  if (slash > 0 && value.startsWith('ollama/')) return { providerId: 'ollama', modelId: value.slice('ollama/'.length) };
  return null;
}

function buildDelegationPrompt(userText, history) {
  const context = history
    .slice(-8)
    .map((message) => `${message.role}${message.name ? `:${message.name}` : ''}: ${message.content}`)
    .join('\n\n');
  return `Current EDITH conversation context:\n${context}\n\nUser request to delegate:\n${userText}`;
}

function extractUrl(text) {
  return text.match(/\b(?:https?|file):\/\/[^\s)]+/i)?.[0] ?? null;
}

function humanNetworkError(error) {
  if (/fetch failed|ECONNRESET/i.test(error.message)) return 'the connection failed or was reset.';
  if (/timed out/i.test(error.message)) return 'the request timed out.';
  return error.message;
}
