import { createProviderRouter } from '../providers/index.js';
import { AgentRegistry } from '../agents/registry.js';
import { createDefaultToolRegistry } from '../tools/registry.js';
import { loadConfig } from '../config.js';
import { WorkspaceTools, detectWorkspace } from './workspace-tools.js';

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
  }

  async initialize({ modelArg = null } = {}) {
    this.config = await loadConfig(this.cwd);
    this.workspaceInfo = await detectWorkspace(this.cwd);
    this.workspaceTools = new WorkspaceTools({ workspace: this.workspaceInfo.workspace });
    this.router = await createProviderRouter({ ui: this.ui });
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
      toolsReady: this.toolRegistry.list().filter((tool) => tool.availability === 'AVAILABLE').length
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
    if (/\b(ask|have|tell|use|delegate to)\s+codex\b/.test(lower)) return { route: 'agent:codex', reason: 'explicit Codex request' };
    if (/\b(ask|have|tell|use|delegate to)\s+claude\b/.test(lower)) return { route: 'agent:claude', reason: 'explicit Claude request' };
    if (/\b(ask|have|tell|use|delegate to)\s+opencode\b/.test(lower) || /\bfix\b.*\btests?\b/.test(lower) || /\bmake the changes\b/.test(lower)) {
      return { route: 'agent:opencode', reason: 'coding-agent request' };
    }
    if (/\b(web|internet|latest|current documentation|search)\b/.test(lower)) return { route: 'web', reason: 'current information request' };
    if (/\b(git status|changed in git|what'?s changed|git diff|changed in this repository)\b/.test(lower)) return { route: 'workspace:git', reason: 'workspace Git request' };
    if (/\b(what are we building|this repo|this repository|architecture|project)\b/.test(lower)) {
      return { route: 'workspace:repo', reason: 'repository understanding request' };
    }
    if (/\b(directory|folder|working in|launched)\b/.test(lower)) return { route: 'workspace:cwd', reason: 'workspace location request' };
    if (/\b(model|provider|running)\b/.test(lower)) return { route: 'status:model', reason: 'model status request' };
    return { route: 'local', reason: 'general conversation' };
  }

  async executePlan(plan, userText, events) {
    if (plan.route === 'status:model') return this.answerModelStatus();
    if (plan.route === 'workspace:cwd') return this.answerWorkspaceStatus();
    if (plan.route === 'workspace:git') return this.answerWithWorkspaceTools(userText, ['git_status', 'git_diff'], events);
    if (plan.route === 'workspace:repo') return this.answerWithWorkspaceTools(userText, ['list_directory', 'read_file:package.json', 'read_file:README.md', 'list_directory:src'], events);
    if (plan.route === 'agent:codex') return this.delegate('codex', userText, events);
    if (plan.route === 'agent:claude') return this.delegate('claude', userText, events);
    if (plan.route === 'agent:opencode') return this.delegate('opencode', userText, events);
    if (plan.route === 'web') return this.webRequired(events);
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

  webRequired(events) {
    events.activity?.('Checking web search backend');
    this.trace.push({ type: 'tool', tool: 'web_search', title: 'Checking web search backend' });
    return {
      text: 'WEB SEARCH: BACKEND REQUIRED\n\nThe web_search and web_fetch tool interfaces exist, but no no-key or credentialed backend is configured in EDITH yet.',
      route: 'web'
    };
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
      `Current model: ${status.model} via ${status.provider}.`,
      `Workspace: ${status.workspace}.`
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
