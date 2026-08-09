import { createProviderRouter } from '../providers/index.js';
import { AgentRegistry } from '../agents/registry.js';
import { createDefaultToolRegistry } from '../tools/registry.js';
import { loadConfig } from '../config.js';
import { WorkspaceTools, detectWorkspace } from './workspace-tools.js';
import { SystemTools, extractTimezoneRequest } from './system-tools.js';
import { NetworkRegistry } from '../network/providers.js';
import { ContextConnectorRegistry } from '../context/registry.js';
import { ContextQueryEngine } from '../context/query-engine.js';
import { BriefingEngine } from '../context/briefing.js';
import { ConnectorHealth, sourceLabel } from '../context/models.js';
import { AuthRegistry } from '../auth/registry.js';
import { AuthState } from '../auth/errors.js';

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
    this.contextRegistry = new ContextConnectorRegistry({ cwd });
    this.contextEngine = new ContextQueryEngine({ registry: this.contextRegistry, systemTools: this.systemTools });
    this.briefingEngine = new BriefingEngine({ queryEngine: this.contextEngine, systemTools: this.systemTools });
    this.contextStatusRows = [];
    this.authRegistry = new AuthRegistry();
    this.authStatusRows = [];
    this.lastPersonalContextItems = [];
  }

  async initialize({ modelArg = null } = {}) {
    this.config = await loadConfig(this.cwd);
    this.workspaceInfo = await detectWorkspace(this.cwd);
    this.workspaceTools = new WorkspaceTools({ workspace: this.workspaceInfo.workspace });
    this.router = await createProviderRouter({ ui: this.ui });
    this.agentHealth = await this.agentRegistry.list();
    this.contextStatusRows = await this.contextRegistry.status({ refresh: true });
    this.authStatusRows = await this.authRegistry.status();
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
      webReady: this.toolRegistry.get('web_search')?.availability === 'AVAILABLE',
      contextReady: this.contextStatusRows.filter((row) => row.health === ConnectorHealth.CONNECTED).length
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
    if (isMutationRequest(lower)) return { route: 'context:mutation-blocked', reason: 'read-only personal context phase' };
    if (/\b(personal context|context can you access|context status)\b/.test(lower)) return { route: 'context:status', reason: 'personal context status request' };
    if (/\b(give me (my |an )?brief|updated brief|daily brief)\b/.test(lower)) {
      return { route: lower.includes('updated') ? 'context:brief-updated' : 'context:brief', reason: 'on-demand briefing request' };
    }
    if (/\b(how did we do today|what didn'?t get done|roll over|rollover|end of day)\b/.test(lower)) {
      return { route: 'context:end-of-day', reason: 'end-of-day read-only review request' };
    }
    if (/\bwhat'?s next\b|\bnext (meeting|event|up)\b/.test(lower)) return { route: 'context:next-event', reason: 'next personal-context item request' };
    if (/\bwhat calendars\b|\bwhich calendars\b|\bcalendars can you see\b/.test(lower)) return { route: 'context:calendars', reason: 'calendar discovery request' };
    if (/\bwhich calendar\b|\bwhere did you get\b.*\b(meeting|event|that)\b/.test(lower)) return { route: 'context:provenance', reason: 'personal context provenance request' };
    if (/\btomorrow\b.*\b(calendar|look like|events?|meetings?)\b|\bwhat does tomorrow look like\b/.test(lower)) return { route: 'context:events-tomorrow', reason: 'calendar tomorrow request' };
    if (/\b(meetings?|events?)\b.*\b(left|remaining|today|tomorrow|afternoon)\b|\bwhat do i have (left|going on)\b/.test(lower)) {
      return { route: 'context:events', reason: 'calendar context request' };
    }
    if (/\b(unread|important|latest|recent)\b.*\b(email|mail|messages?)\b|\b(email|mail)\b.*\b(unread|important|latest|recent)\b/.test(lower)) {
      return { route: 'context:email', reason: 'email context request' };
    }
    if (/\b(tasks?|to dos?|todos?)\b.*\b(due|have|open|today|tomorrow)?\b|\bwhat tasks\b/.test(lower)) return { route: 'context:tasks', reason: 'task context request' };
    if (/\b(drive|files?)\b.*\b(find|search|list|latest|recent)\b|\bfind files\b/.test(lower)) return { route: 'context:drive', reason: 'Drive context request' };
    if (/\b(review requests?|need to review|github reviews?|gitlab reviews?|assigned issues?)\b/.test(lower)) {
      return { route: 'context:development', reason: 'development context request' };
    }
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
    if (plan.route === 'context:mutation-blocked') return this.answerMutationBlocked(events);
    if (plan.route === 'context:status') return this.answerContextStatus(events);
    if (plan.route === 'context:brief') return this.answerBrief({ updated: false, events });
    if (plan.route === 'context:brief-updated') return this.answerBrief({ updated: true, events });
    if (plan.route === 'context:end-of-day') return this.answerEndOfDay(events);
    if (plan.route === 'context:next-event') return this.answerNextEvent(events);
    if (plan.route === 'context:calendars') return this.answerCalendars(events);
    if (plan.route === 'context:provenance') return this.answerContextProvenance(events);
    if (plan.route === 'context:events-tomorrow') return this.answerEventsTomorrow(events);
    if (plan.route === 'context:events') return this.answerEventsToday(events);
    if (plan.route === 'context:email') return this.answerUnreadEmail(events);
    if (plan.route === 'context:tasks') return this.answerTasks(events);
    if (plan.route === 'context:drive') return this.answerDrive(events, userText);
    if (plan.route === 'context:development') return this.answerDevelopmentContext(events);
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

  async answerContextStatus(events) {
    events.activity?.('Checking personal context connectors');
    this.trace.push({ type: 'tool', tool: 'context_status', title: 'Checking personal context connectors' });
    const rows = await this.contextRegistry.status({ refresh: true });
    this.contextStatusRows = rows;
    return { text: formatContextStatus(rows), route: 'context:status' };
  }

  answerMutationBlocked(events) {
    events.activity?.('Checking Google action confirmation policy');
    this.trace.push({ type: 'policy', title: 'Google action requires explicit confirmation' });
    return {
      text: 'Personal Google writes are authorized but not automatic. I need an explicit confirmation step with the exact operation and affected resource before creating, modifying, sending, sharing, or deleting anything. I did not perform any write action.',
      route: 'context:mutation-blocked'
    };
  }

  async answerBrief({ updated = false, events } = {}) {
    events.activity?.(updated ? 'Building updated personal brief' : 'Building personal brief');
    this.trace.push({ type: 'tool', tool: 'context_brief', title: updated ? 'Building updated personal brief' : 'Building personal brief' });
    const text = await this.briefingEngine.buildBrief({ updated });
    return { text, route: updated ? 'context:brief-updated' : 'context:brief' };
  }

  async answerEndOfDay(events) {
    events.activity?.('Building read-only end-of-day review');
    this.trace.push({ type: 'tool', tool: 'context_brief', title: 'Building read-only end-of-day review' });
    return { text: await this.briefingEngine.buildEndOfDay(), route: 'context:end-of-day' };
  }

  async answerNextEvent(events) {
    events.activity?.('Checking next calendar event');
    this.trace.push({ type: 'tool', tool: 'context_next_event', title: 'Checking next calendar event' });
    const next = await this.contextEngine.getNextEvent();
    if (!next) return { text: sourceUnavailableText(await this.contextRegistry.status(), 'Google Calendar') || 'I do not see an upcoming calendar event from configured read-only sources.', route: 'context:next-event' };
    this.lastPersonalContextItems = [next];
    return { text: `Next up: ${next.title} at ${formatDateTime(next.startAt)}. Source: ${sourceLabel(next)}.`, route: 'context:next-event' };
  }

  async answerCalendars(events) {
    events.activity?.('Checking Google Calendar list');
    this.trace.push({ type: 'tool', tool: 'context_events', title: 'Checking Google Calendar list' });
    const connector = this.contextRegistry.connectors.find((item) => item.sourceType === 'calendar' && item.getCalendars);
    const status = await this.contextRegistry.status();
    const row = status.find((item) => item.id === connector?.id);
    if (!connector || row?.health !== ConnectorHealth.CONNECTED) return { text: sourceUnavailableText(status, 'Google Calendar') || 'No connected calendar source is available.', route: 'context:calendars' };
    const calendars = (await connector.getCalendars()).items;
    const text = calendars.map((calendar) => `${calendar.primary ? '* ' : '- '}${calendar.title} (${calendar.accessRole}; timezone: ${calendar.timezone || 'unknown'}; source: google-calendar / ${calendar.sourceAccount})`).join('\n');
    return { text: text || 'Google Calendar returned no calendars.', route: 'context:calendars' };
  }

  answerContextProvenance(events) {
    events.activity?.('Checking last personal-context source');
    this.trace.push({ type: 'tool', tool: 'context_status', title: 'Checking last personal-context source' });
    const item = this.lastPersonalContextItems[0];
    if (!item) return { text: 'I do not have a prior calendar/email/task item in this session to trace yet.', route: 'context:provenance' };
    return { text: `That came from ${sourceLabel(item)}.${item.metadata?.calendarId ? ` Calendar ID: ${item.metadata.calendarId}.` : ''}`, route: 'context:provenance' };
  }

  async answerEventsTomorrow(events) {
    events.activity?.('Checking tomorrow calendar events');
    this.trace.push({ type: 'tool', tool: 'context_events', title: 'Checking tomorrow calendar events' });
    const start = startOfLocalTomorrow();
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const connector = this.contextRegistry.connectors.find((item) => item.sourceType === 'calendar' && item.getEventsBetween);
    const status = await this.contextRegistry.status();
    const row = status.find((item) => item.id === connector?.id);
    if (!connector || row?.health !== ConnectorHealth.CONNECTED) return { text: sourceUnavailableText(status, 'Google Calendar') || 'No connected calendar source is available.', route: 'context:events-tomorrow' };
    const items = await connector.getEventsBetween({ start, end, limit: 20 });
    this.lastPersonalContextItems = items;
    return { text: items.length ? items.map((event) => `${formatDateTime(event.startAt)} - ${event.title} (${sourceLabel(event)})`).join('\n') : 'No calendar events were returned for tomorrow.', route: 'context:events-tomorrow' };
  }

  async answerEventsToday(events) {
    events.activity?.('Checking calendar events');
    this.trace.push({ type: 'tool', tool: 'context_events', title: 'Checking calendar events' });
    const remaining = await this.contextEngine.getEventsAfter();
    if (!remaining.length) return { text: sourceUnavailableText(await this.contextRegistry.status(), 'Google Calendar') || 'No remaining calendar events were returned by configured read-only sources.', route: 'context:events' };
    this.lastPersonalContextItems = remaining;
    return { text: remaining.map((event) => `${formatDateTime(event.startAt)} - ${event.title} (${sourceLabel(event)})`).join('\n'), route: 'context:events' };
  }

  async answerUnreadEmail(events) {
    events.activity?.('Checking Gmail');
    this.trace.push({ type: 'tool', tool: 'context_unread_email', title: 'Checking Gmail' });
    const messages = await this.contextEngine.getUnreadMessages();
    if (!messages.length) return { text: sourceUnavailableText(await this.contextRegistry.status(), 'Email') || 'No unread email was returned by configured read-only sources.', route: 'context:email' };
    return { text: messages.map((message) => `${message.title} (${sourceLabel(message)})`).join('\n'), route: 'context:email' };
  }

  async answerTasks(events) {
    events.activity?.('Checking Google Tasks');
    this.trace.push({ type: 'tool', tool: 'context_tasks', title: 'Checking Google Tasks' });
    const tasks = await this.contextEngine.getOpenTasks();
    if (!tasks.length) return { text: sourceUnavailableText(await this.contextRegistry.status(), 'Google Tasks') || 'No open tasks were returned by configured task sources.', route: 'context:tasks' };
    return { text: tasks.map((task) => `${task.title}${task.dueAt ? ` due ${task.dueAt}` : ''} (${sourceLabel(task)})`).join('\n'), route: 'context:tasks' };
  }

  async answerDrive(events, userText) {
    events.activity?.('Searching Google Drive');
    this.trace.push({ type: 'tool', tool: 'context_drive', title: 'Searching Google Drive' });
    const connector = this.contextRegistry.connectors.find((item) => item.sourceType === 'drive' && item.searchFiles);
    const status = await this.contextRegistry.status();
    const row = status.find((item) => item.id === connector?.id);
    if (!connector || row?.health !== ConnectorHealth.CONNECTED) return { text: sourceUnavailableText(status, 'Google Drive') || 'No connected Drive source is available.', route: 'context:drive' };
    const query = extractDriveQuery(userText);
    const files = await connector.searchFiles({ query, limit: 8 });
    return { text: files.length ? files.map((file) => `${file.title} (${sourceLabel(file)})${file.url ? `\n${file.url}` : ''}`).join('\n') : 'No Drive files matched that query.', route: 'context:drive' };
  }

  async answerDevelopmentContext(events) {
    events.activity?.('Checking development review context');
    this.trace.push({ type: 'tool', tool: 'context_github', title: 'Checking GitHub/GitLab review context' });
    const [reviews, issues] = await Promise.all([
      this.contextEngine.getReviewRequests({ limit: 8 }),
      this.contextEngine.getAssignedIssues({ limit: 8 })
    ]);
    const items = [...reviews, ...issues].slice(0, 12);
    if (!items.length) return { text: 'No open assigned issues or review requests were returned by connected GitHub/GitLab read-only sources.', route: 'context:development' };
    return { text: items.map((item) => `${item.type}: ${item.title} (${sourceLabel(item)})${item.url ? `\n${item.url}` : ''}`).join('\n'), route: 'context:development' };
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
      'Network permissions: public HTTP/HTTPS fetch only; localhost/private network/file URLs blocked.',
      this.contextCapabilityManifest()
    ].join('\n');
  }

  contextCapabilityManifest() {
    const rows = this.contextStatusRows ?? [];
    const available = rows.filter((row) => row.health === ConnectorHealth.CONNECTED).map((row) => `${row.sourceType}.read`);
    const unavailable = rows.filter((row) => row.health !== ConnectorHealth.CONNECTED).map((row) => `${row.sourceType}.read - ${row.health}`);
    return [
      `Personal context AVAILABLE: ${available.join(', ') || 'none'}`,
      `Personal context UNAVAILABLE: ${unavailable.join(', ') || 'none'}`,
      'Personal context permissions: read-only; email/calendar/task/GitHub/GitLab mutations unavailable; keep personal context local unless explicitly approved.',
      this.authCapabilityManifest()
    ].join('\n');
  }

  authCapabilityManifest() {
    const google = this.authStatusRows.find((row) => row.provider === 'google');
    if (!google || google.status !== AuthState.CONNECTED) return 'Google Workspace: unavailable';
    return `Google Workspace identity: available (${google.account}); Calendar/Gmail/Drive/Tasks/Contacts: unavailable until read-only scopes and connectors are added.`;
  }

  pruneHistory() {
    if (this.history.length > MAX_MESSAGES) this.history = this.history.slice(-MAX_MESSAGES);
  }
}

function isMutationRequest(lower) {
  return /\b(move|reschedule|cancel|create|update|delete|send|reply|archive|label|complete|merge|push)\b/.test(lower)
    && /\b(meeting|event|calendar|email|mail|message|task|issue|pr|pull request|mr|merge request|github|gitlab)\b/.test(lower);
}

function formatContextStatus(rows) {
  return rows.map((row) => {
    const source = row.accountIdentity ? `${row.name} (${row.accountIdentity})` : row.name;
    return `${source}: ${row.health}; read-only=${row.readOnly ? 'yes' : 'no'}; capabilities=${row.capabilities.join(', ')}; ${row.detail}`;
  }).join('\n');
}

function sourceUnavailableText(rows, name) {
  const row = rows.find((item) => item.name === name);
  if (!row || row.health === ConnectorHealth.CONNECTED) return '';
  return `${name} context is ${row.health}: ${row.detail}`;
}

function formatDateTime(value) {
  if (!value) return '(time unavailable)';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
}

function startOfLocalTomorrow() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function extractDriveQuery(text) {
  const match = text.match(/\b(?:drive|files?)\b.*?(?:for|named|called)\s+(.+)$/i);
  if (!match) return 'trashed=false';
  const term = match[1].replace(/[?.!]+$/, '').trim().replace(/'/g, "\\'");
  return `name contains '${term}' and trashed=false`;
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
