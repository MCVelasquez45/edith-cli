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
import { classifySearchMode } from '../network/providers.js';
import { AuditLog } from '../audit.js';
import { buildProcessorRegistry } from '../routing/processor-registry.js';
import { createExecutionPlan } from '../routing/planner.js';
import { sanitizeExternalPayload } from '../routing/egress-policy.js';
import { DataClass, classifyData } from '../routing/request-analysis.js';
import { egressDecision } from '../routing/egress-policy.js';

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
    this.lastNetworkItems = [];
    this.lastWeatherLocation = null;
    this.audit = new AuditLog();
    this.processingMode = 'local-first';
    this.processors = [];
    this.currentPlan = null;
  }

  async initialize({ modelArg = null } = {}) {
    this.config = await loadConfig(this.cwd);
    this.processingMode = this.config.processing?.mode ?? 'local-first';
    this.workspaceInfo = await detectWorkspace(this.cwd);
    this.workspaceTools = new WorkspaceTools({ workspace: this.workspaceInfo.workspace });
    this.router = await createProviderRouter({ ui: this.ui });
    this.agentHealth = await this.agentRegistry.list();
    this.processors = buildProcessorRegistry({ router: this.router, agents: this.agentHealth });
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
      contextReady: this.contextStatusRows.filter((row) => row.health === ConnectorHealth.CONNECTED).length,
      processingMode: this.processingMode,
      processorCount: this.processors.length
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

    const plan = events.routeOverride ? { route: events.routeOverride, reason: 'explicit routing mode' } : this.route(userText);
    const executionPlan = createExecutionPlan({
      request: userText,
      route: plan.route,
      router: this.router,
      agents: this.agentHealth,
      mode: this.processingMode,
      explicitProcessor: events.routeOverride === 'local' ? 'local' : null
    });
    this.currentPlan = executionPlan;
    this.trace = [{ type: 'route', route: plan.route, reason: plan.reason, dataClasses: executionPlan.dataClasses, processor: executionPlan.processor, finalProcessor: executionPlan.finalProcessor, egress: executionPlan.egress.reason, externalEgress: executionPlan.externalEgress.reason }];
    await this.audit.record({
      type: 'processor_selected',
      route: plan.route,
      processor: executionPlan.processor,
      finalProcessor: executionPlan.finalProcessor,
      dataClassification: executionPlan.dataClasses,
      egressAllowed: executionPlan.egress.allowed,
      egressReason: executionPlan.egress.reason
    }).catch(() => {});
    let result;
    try {
      result = await this.executePlan(plan, userText, events);
    } catch (error) {
      result = { text: `I hit an error: ${error.message}`, route: plan.route, error };
    }
    if (result.text && !events.signal?.aborted) this.history.push({ role: 'assistant', content: result.text });
    this.pruneHistory();
    return result;
  }

  route(text) {
    const lower = text.toLowerCase();
    if (/^reply with exactly\b/.test(lower)) return { route: 'local', reason: 'exact response request' };
    if (/^(ready|hello|hey|hi|thanks|thank you|cool|let'?s go)[.!\s]*$/i.test(text.trim())) {
      return { route: 'local:ack', reason: 'short conversational acknowledgement' };
    }
    if (/\b(can you|are you able to|do you have access to)\b.*\b(modify|change|create|update|delete|send|write|manage)\b|\bwhat can you (modify|change|create|update|delete|send|write|manage)\b/.test(lower)) {
      return { route: 'status:permissions', reason: 'permission capability request' };
    }
    if (isExplicitNoLiveRequest(lower) && isLiveWeatherRequest(lower, this.lastWeatherLocation)) {
      return { route: 'live:requires-tool', reason: 'explicit request to avoid live retrieval for stale weather data' };
    }
    if (isMutationRequest(lower)) return { route: 'context:mutation-blocked', reason: 'read-only personal context phase' };
    if (/\b(research|latest|current|developments|news)\b/.test(lower) && /\b(calendar|meeting|today|working on)\b/.test(lower)) {
      return { route: 'hybrid:research-context', reason: 'public research plus personal context requires split processing' };
    }
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
    if (/\b(email|mail|message)\b.*\b(related to|about)\b.*\b(next|meeting|event|calendar)\b|\b(next|meeting|event|calendar)\b.*\b(email|mail|message)\b/.test(lower)) {
      return { route: 'context:calendar-email', reason: 'calendar and email correlation request' };
    }
    if (/\btomorrow\b.*\b(calendar|look like|events?|meetings?)\b|\bwhat does tomorrow look like\b/.test(lower)) return { route: 'context:events-tomorrow', reason: 'calendar tomorrow request' };
    if (/\b(meetings?|events?)\b.*\b(left|remaining|today|tomorrow|afternoon)\b|\bwhat do i have (left|going on)\b/.test(lower)) {
      return { route: 'context:events', reason: 'calendar context request' };
    }
    if (/\b(unread|important|latest|recent)\b.*\b(email|mail|messages?)\b|\b(email|mail)\b.*\b(unread|important|latest|recent)\b/.test(lower)) {
      return { route: 'context:email', reason: 'email context request' };
    }
    if (/\b(tasks?|to dos?|todos?)\b.*\b(due|have|open|today|tomorrow)?\b|\bwhat tasks\b/.test(lower)) return { route: 'context:tasks', reason: 'task context request' };
    if (/\b(drive|files?)\b.*\b(find|search|list|latest|recent)\b|\bfind files\b/.test(lower)) return { route: 'context:drive', reason: 'Drive context request' };
    if (/\b(review requests?|need to review|github reviews?|gitlab reviews?|assigned issues?|github or gitlab|gitlab or github|github\b.*attention|gitlab\b.*attention)\b/.test(lower)) {
      return { route: 'context:development', reason: 'development context request' };
    }
    if (/\bwhat\s+time\b|\btime\s+is\s+it\b|\bcurrent\s+time\b/.test(lower)) return { route: 'system:time', reason: 'live time request' };
    if (/\bwhat\s+(day|date)\b|\bcurrent\s+date\b|\btoday'?s\s+date\b/.test(lower)) return { route: 'system:date', reason: 'live date request' };
    if (/\btimezone\b|\btime\s+zone\b/.test(lower)) return { route: 'system:timezone', reason: 'timezone request' };
    if (/\bsystem info\b|\babout this mac\b|\bwhat machine\b/.test(lower)) return { route: 'system:info', reason: 'system information request' };
    if (/\bwhat agents\b|\bagents can you\b|\bcan you use\b.*\bagents\b|\bis claude available\b/.test(lower)) return { route: 'status:agents', reason: 'agent availability request' };
    if (/\bwhat tools can you use\b|\bwhich tools can you use\b|\bavailable tools\b|\btool access\b/.test(lower)) return { route: 'status:tools', reason: 'tool capability request' };
    if (/\bcan you search the web\b|\bweb search configured\b/.test(lower)) return { route: 'status:web', reason: 'web capability request' };
    if (isLiveWeatherRequest(lower, this.lastWeatherLocation)) return { route: 'network:weather', reason: 'live weather request' };
    if (/\bopen (the )?(first|second|third|\d+)( source| result)?\b|\b(second|third) source\b/.test(lower)) {
      return { route: 'network:fetch-last', reason: 'follow-up source fetch request' };
    }
    if (extractUrl(text)) return { route: 'network:fetch', reason: 'URL fetch request' };
    if (/\bwhat branch\b|\bwhich branch\b|\bbranch am i on\b/.test(lower)) return { route: 'workspace:branch', reason: 'Git branch request' };
    if (/\b(ask|have|tell|use|delegate to)\s+codex\b/.test(lower)) return { route: 'agent:codex', reason: 'explicit Codex request' };
    if (/\b(ask|have|tell|use|delegate to)\s+claude\b/.test(lower)) return { route: 'agent:claude', reason: 'explicit Claude request' };
    if (/\b(ask|have|tell|use|delegate to)\s+opencode\b/.test(lower) || /\bfix\b.*\btests?\b/.test(lower) || /\bmake the changes\b/.test(lower)) {
      return { route: 'agent:opencode', reason: 'coding-agent request' };
    }
    if (/\b(what are we building|this repo|this repository|our current edith architecture|current edith architecture|edith architecture|architecture match|project)\b/.test(lower)) {
      return { route: 'workspace:repo', reason: 'repository understanding request' };
    }
    if (isCurrentExternalInformationRequest(lower)) {
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
    if (plan.route === 'local:ack') return { text: acknowledgement(userText), route: 'local:ack' };
    if (plan.route === 'system:time') return this.answerCurrentTime(userText, events);
    if (plan.route === 'system:date') return this.answerCurrentDate(userText, events);
    if (plan.route === 'system:timezone') return this.answerTimezone(events);
    if (plan.route === 'system:info') return this.answerSystemInfo(events);
    if (plan.route === 'status:agents') return this.answerAgentStatus(events);
    if (plan.route === 'status:tools') return this.answerToolStatus();
    if (plan.route === 'status:permissions') return this.answerPermissionStatus();
    if (plan.route === 'status:web') return this.answerWebStatus(events);
    if (plan.route === 'live:requires-tool') return this.answerLiveRequiresTool(events);
    if (plan.route === 'network:weather') return this.answerWeather(userText, events);
    if (plan.route === 'network:search') return this.answerNetworkSearch(userText, events);
    if (plan.route === 'hybrid:research-context') return this.answerHybridResearchContext(userText, events);
    if (plan.route === 'network:docs') return this.answerDocsLookup(userText, events);
    if (plan.route === 'network:fetch') return this.answerUrlFetch(userText, events);
    if (plan.route === 'network:fetch-last') return this.answerLastSourceFetch(userText, events);
    if (plan.route === 'context:mutation-blocked') return this.answerMutationBlocked(events);
    if (plan.route === 'context:status') return this.answerContextStatus(events);
    if (plan.route === 'context:brief') return this.answerBrief({ updated: false, events });
    if (plan.route === 'context:brief-updated') return this.answerBrief({ updated: true, events });
    if (plan.route === 'context:end-of-day') return this.answerEndOfDay(events);
    if (plan.route === 'context:next-event') return this.answerNextEvent(events);
    if (plan.route === 'context:calendars') return this.answerCalendars(events);
    if (plan.route === 'context:provenance') return this.answerContextProvenance(events);
    if (plan.route === 'context:calendar-email') return this.answerCalendarEmailCorrelation(userText, events);
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

  answerToolStatus() {
    const available = this.toolRegistry.list()
      .filter((tool) => tool.availability === 'AVAILABLE')
      .map((tool) => tool.id);
    const unavailable = this.toolRegistry.list()
      .filter((tool) => tool.availability !== 'AVAILABLE')
      .map((tool) => `${tool.id} (${tool.availability.toLowerCase()})`);
    const lines = [`I can use these active tools: ${available.join(', ') || 'none'}.`];
    if (unavailable.length) lines.push(`Unavailable right now: ${unavailable.join(', ')}.`);
    return { text: lines.join('\n'), route: 'status:tools' };
  }

  answerPermissionStatus() {
    const workspaceWrite = this.toolRegistry.list().some((tool) => tool.availability === 'AVAILABLE' && /write|execute|shell/i.test(`${tool.id} ${tool.risk} ${tool.permissions?.join(' ')}`));
    const connected = (this.contextStatusRows ?? []).filter((row) => row.health === ConnectorHealth.CONNECTED);
    const writable = connected
      .filter((row) => (row.capabilities ?? []).some((capability) => /\.write$|\.send$|\.manage$|\.delete$|\.create$|\.update$|\.complete$|\.respond$/.test(capability)))
      .map((row) => `${row.sourceType} (${row.capabilities.filter((capability) => !/\.read$/.test(capability)).join(', ')})`);
    const lines = [
      `Workspace changes: ${workspaceWrite ? 'available through approved tools' : 'not available as a native tool'}.`,
      `Google and personal-context writes: ${writable.length ? `available with explicit confirmation for ${writable.join('; ')}` : 'not currently connected or not authorized'}.`,
      'Sending, sharing, deleting, and other sensitive or destructive actions require explicit confirmation.'
    ];
    return { text: lines.join('\n'), route: 'status:permissions' };
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
    const providers = this.network.status?.().search ?? [];
    const readyProviders = providers.filter((provider) => provider.configured).map((provider) => provider.name).join(', ') || 'none';
    const text = web?.availability === 'AVAILABLE'
      ? `Web search is configured. web_search=${web.availability}, web_fetch=${fetch?.availability ?? 'UNKNOWN'}, docs_lookup=${docs?.availability ?? 'UNKNOWN'}. Search providers: ${readyProviders}.`
      : `Web search is not configured. web_search=${web?.availability ?? 'UNKNOWN'}, web_fetch=${fetch?.availability ?? 'UNKNOWN'}.`;
    return { text, route: 'status:web' };
  }

  answerLiveRequiresTool(events) {
    events.activity?.('Checking live-information policy');
    this.trace.push({ type: 'policy', title: 'Live information requires a trusted tool' });
    return {
      text: 'I cannot reliably provide current weather without using a trusted live-data tool. I will not guess current conditions from model memory.',
      route: 'live:requires-tool'
    };
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

  async answerCalendarEmailCorrelation(userText, events) {
    events.activity?.('Checking next calendar event');
    this.trace.push({ type: 'tool', tool: 'context_next_event', title: 'Checking next calendar event' });
    const event = await this.findCorrelationEvent(userText);
    if (!event) return { text: sourceUnavailableText(await this.contextRegistry.status(), 'Google Calendar') || 'I could not find a matching upcoming calendar event to correlate with email.', route: 'context:calendar-email' };
    events.activity?.('Searching Gmail for related messages');
    this.trace.push({ type: 'tool', tool: 'context_email_search', title: 'Searching Gmail for related messages' });
    const query = `"${event.title.replace(/"/g, '')}" newer_than:90d`;
    const messages = await this.contextEngine.searchMessages({ query, limit: 8 });
    this.lastPersonalContextItems = [event, ...messages];
    const context = [
      `Calendar event: ${event.title}`,
      `When: ${formatDateTime(event.startAt)}`,
      `Source: ${sourceLabel(event)}`,
      '',
      messages.length
        ? messages.map((message) => `Email: ${message.title}; status=${message.status}; source=${sourceLabel(message)}; people=${message.people.join(', ')}`).join('\n')
        : 'No related Gmail messages were returned for the bounded event-title search.'
    ].join('\n');
    const prompt = `User request: ${userText}\n\nApproved personal context:\n${context}\n\nAnswer as EDITH. Keep personal details local. Be concise and cite source labels.`;
    return this.answerLocal(prompt, context, events, { route: 'context:calendar-email', maxTokens: 700 });
  }

  async findCorrelationEvent(userText) {
    const explicit = extractQuotedOrNamedEvent(userText);
    if (explicit) {
      const now = new Date();
      const upcoming = await this.contextEngine.getEventsBetween({ start: now, end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), limit: 50 });
      const lower = explicit.toLowerCase();
      const match = upcoming.find((event) => event.title.toLowerCase().includes(lower));
      if (match) return match;
    }
    return this.contextEngine.getNextEvent();
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
    this.emitBriefSourceActivity(events);
    events.activity?.(updated ? 'Building updated personal brief' : 'Building personal brief');
    this.trace.push({ type: 'tool', tool: 'context_brief', title: updated ? 'Building updated personal brief' : 'Building personal brief' });
    const text = await this.briefingEngine.buildBrief({ updated });
    return { text, route: updated ? 'context:brief-updated' : 'context:brief' };
  }

  emitBriefSourceActivity(events) {
    const connected = new Set((this.contextStatusRows ?? []).filter((row) => row.health === ConnectorHealth.CONNECTED).map((row) => row.sourceType));
    const steps = [
      ['calendar', 'Checking calendar'],
      ['email', 'Checking Gmail'],
      ['task', 'Checking tasks'],
      ['github', 'Checking GitHub'],
      ['gitlab', 'Checking GitLab']
    ];
    for (const [sourceType, label] of steps) {
      if (!connected.has(sourceType)) continue;
      events.activity?.(label);
      this.trace.push({ type: 'tool', tool: `context_${sourceType}`, title: label });
    }
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
    const dataClasses = classifyData({ request: `${userText}\n${this.history.slice(-4).map((item) => item.content).join('\n')}` });
    const decision = egressDecision({ dataClasses, processor: { id: agentId, location: 'EXTERNAL' }, mode: this.processingMode });
    if (dataClasses.includes(DataClass.SECRET) || dataClasses.includes(DataClass.PERSONAL) || dataClasses.includes(DataClass.SENSITIVE)) {
      this.trace.push({ type: 'policy', title: 'Specialist delegation blocked', agent: agentId, dataClasses, egress: decision.reason });
      return { text: `I did not delegate this request to ${agent.name} because its context is not approved for external processing.`, route: `agent:${agentId}` };
    }
    const prompt = sanitizeExternalPayload(buildDelegationPrompt(userText, this.history));
    const label = agentId === 'opencode' ? 'Running OpenCode coding agent' : `Asking ${agent.name}`;
    events.activity?.(label);
    this.trace.push({ type: 'agent', agent: agentId, title: label, dataClasses, egress: 'allowed for explicit specialist delegation', sanitizationApplied: true });
    await this.audit.record({ type: 'agent_delegation', agent: agentId, dataClassification: dataClasses, egressAllowed: true, sanitizationApplied: true, payloadSize: prompt.length }).catch(() => {});
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
      const mode = classifySearchMode(userText);
      const results = await this.network.search({ query: userText, maxResults: 5, mode });
      this.lastNetworkItems = results;
      if (!results.length) return { text: 'I could not find web results for that query from configured search providers.', route: 'network:search' };
      const fetched = [];
      for (const result of results.slice(0, 3)) {
        try {
          events.activity?.(`Fetching ${new URL(result.url).hostname}`);
          this.trace.push({ type: 'tool', tool: 'web_fetch', title: `Fetching ${result.url}` });
          fetched.push({ result, page: await this.network.fetch({ url: result.url }) });
        } catch (error) {
          this.trace.push({ type: 'tool_error', tool: 'web_fetch', title: `Fetch failed for ${result.url}`, error: error.message });
        }
      }
      if (!fetched.length) return { text: `Search found sources, but EDITH could not fetch readable public pages.\n\nSources:\n${formatSources(results)}`, route: 'network:search' };
      return this.synthesizeNetworkAnswer(userText, fetched, events, 'network:search');
    } catch (error) {
      return { text: `EDITH could not retrieve current information: ${humanNetworkError(error)}`, route: 'network:search', error };
    }
  }

  async answerHybridResearchContext(userText, events) {
    events.activity?.('Searching public research');
    this.trace.push({ type: 'tool', tool: 'web_search', title: 'Searching public research', dataClassification: DataClass.PUBLIC });
    try {
      const mode = classifySearchMode(userText);
      const results = await this.network.search({ query: userText, maxResults: 5, mode });
      const fetched = [];
      for (const result of results.slice(0, 3)) {
        try {
          fetched.push({ result, page: await this.network.fetch({ url: result.url }) });
        } catch {
          // Keep the bounded public corpus to sources EDITH could read.
        }
      }
      const publicSummary = fetched.length
        ? await this.synthesizeNetworkAnswer(userText, fetched, events, 'hybrid:public-research')
        : { text: `Public research returned no readable pages. Sources:\n${formatSources(results)}` };
      events.activity?.('Checking calendar');
      this.trace.push({ type: 'tool', tool: 'context_events', title: 'Checking calendar', dataClassification: DataClass.PERSONAL });
      const eventsToday = await this.contextEngine.getEventsAfter();
      const calendar = eventsToday.slice(0, 8).map((event) => `${formatDateTime(event.startAt)} - ${event.title}`).join('\n') || 'No upcoming calendar events were returned.';
      const prompt = [
        `User request: ${userText}`,
        'Synthesize the public research with the private calendar context locally. Never send calendar details to an external processor.',
        `Public research summary:\n${publicSummary.text}`,
        `Private calendar context:\n${calendar}`
      ].join('\n\n');
      const result = await this.answerLocal(prompt, calendar, events, { route: 'hybrid:research-context', maxTokens: 1000 });
      return { ...result, route: 'hybrid:research-context' };
    } catch (error) {
      return { text: `EDITH could not complete the hybrid research request: ${humanNetworkError(error)}`, route: 'hybrid:research-context', error };
    }
  }

  async answerWeather(userText, events) {
    const location = extractWeatherLocation(userText, this.lastWeatherLocation);
    events.activity?.(`Checking weather for ${location}`);
    this.trace.push({ type: 'tool', tool: 'weather', title: `Checking weather for ${location}` });
    try {
      const weather = await this.network.weather({ location, days: 3 });
      this.lastWeatherLocation = weather.location;
      this.lastNetworkItems = [{
        title: `${weather.location} weather`,
        url: 'https://open-meteo.com/',
        source: weather.source,
        provider: weather.provider,
        retrievedAt: weather.retrievedAt,
        resultType: 'weather'
      }];
      return { text: formatWeatherAnswer(userText, weather), route: 'network:weather', weather };
    } catch (error) {
      this.trace.push({ type: 'tool_error', tool: 'weather', title: 'Weather lookup failed', error: error.message });
      events.activityError?.('Weather unavailable');
      if (this.toolRegistry.get('web_search')?.availability !== 'AVAILABLE') {
        return { text: `I could not retrieve current weather data: ${humanNetworkError(error)}`, route: 'network:weather', error };
      }
      events.activity?.('Searching web for weather fallback');
      this.trace.push({ type: 'tool', tool: 'web_search', title: 'Searching web for weather fallback' });
      try {
        return await this.answerNetworkSearch(`current weather forecast ${location}`, events);
      } catch {
        return { text: `I could not retrieve current weather data: ${humanNetworkError(error)}`, route: 'network:weather', error };
      }
    }
  }

  async answerDocsLookup(userText, events) {
    events.activity?.('Reading official documentation');
    this.trace.push({ type: 'tool', tool: 'docs_lookup', title: 'Reading official documentation' });
    try {
      const docs = await this.network.lookupDocs({ query: userText, maxResults: 3 });
      this.lastNetworkItems = docs;
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
      this.lastNetworkItems = [{ title: page.title, url: page.finalUrl, source: 'direct-url' }];
      return this.synthesizeNetworkAnswer(userText, [{ result: { title: page.title, url: page.finalUrl, source: 'direct-url' }, page }], events, 'network:fetch');
    } catch (error) {
      events.activityError?.(`Fetch failed for ${url}`);
      return { text: `EDITH could not fetch that URL: ${humanNetworkError(error)}`, route: 'network:fetch', error };
    }
  }

  async answerLastSourceFetch(userText, events) {
    const index = sourceIndexFromText(userText);
    const result = this.lastNetworkItems[index];
    if (!result) return { text: 'I do not have that source in the current session yet. Ask me to search first, then I can open a result.', route: 'network:fetch-last' };
    events.activity?.(`Fetching ${new URL(result.url).hostname}`);
    this.trace.push({ type: 'tool', tool: 'web_fetch', title: `Fetching ${result.url}` });
    try {
      const page = await this.network.fetch({ url: result.url });
      return this.synthesizeNetworkAnswer(userText, [{ result, page }], events, 'network:fetch-last');
    } catch (error) {
      events.activityError?.(`Fetch failed for ${result.url}`);
      return { text: `EDITH could not fetch that source: ${humanNetworkError(error)}`, route: 'network:fetch-last', error };
    }
  }

  async synthesizeNetworkAnswer(userText, items, events, route) {
    const context = items.map(({ result, page }, index) => [
      `Source ${index + 1}: ${result.title}`,
      `URL: ${result.url}`,
      `Retrieved: ${page.retrievedAt}`,
      page.text
    ].join('\n')).join('\n\n').slice(0, MAX_TOOL_CONTEXT);
    const sources = formatSources(items.map(({ result }) => result));
    const prompt = [
      `User request: ${userText}`,
      'Use only the retrieved external information below for current claims.',
      'Do not invent citations. Keep the answer concise.',
      '',
      context,
      '',
      `Sources to cite:\n${sources}`
    ].join('\n');
    const publicSubstep = route === 'hybrid:public-research';
    const canUseExternal = this.currentPlan?.processor?.startsWith('nvidia:')
      && (this.currentPlan.egress?.allowed || this.currentPlan.publicResearchEgress?.allowed || publicSubstep)
      && (publicSubstep || this.currentPlan.dataClasses?.every((item) => item === DataClass.PUBLIC));
    const answer = canUseExternal
      ? await this.answerPublicWithNvidia(prompt, context, events, route)
      : await this.answerLocal(prompt, context, events, { route, maxTokens: 1000 });
    const text = `${answer.text}\n\nSources:\n${sources}`;
    if (answer.streamed) events.streamChunk?.(`\n\nSources:\n${sources}`);
    return { ...answer, text, route };
  }

  async answerPublicWithNvidia(prompt, context, events, route) {
    const group = this.router.modelGroups.find((item) => item.providerId === 'nvidia');
    const model = group?.models.find((item) => item.id === 'z-ai/glm-5.2') ?? group?.models.find((item) => item.capabilities?.includes('CHAT'));
    if (!group || !model) return this.answerLocal(prompt, context, events, { route, maxTokens: 1000 });
    events.activity?.('Analyzing public research · NVIDIA');
    this.trace.push({ type: 'processor', processor: 'nvidia:z-ai/glm-5.2', dataClassification: [DataClass.PUBLIC], egress: 'allowed' });
    await this.audit.record({ type: 'external_processing', processor: 'nvidia:z-ai/glm-5.2', dataClassification: [DataClass.PUBLIC], egressAllowed: true, sanitizationApplied: true, payloadSize: sanitizeExternalPayload(context).length }).catch(() => {});
    const messages = [
      { role: 'system', content: 'Analyze only the public research supplied. Do not invent facts or citations.' },
      { role: 'user', content: sanitizeExternalPayload(prompt) }
    ];
    let text = '';
    events.streamStart?.('NVIDIA · z-ai/glm-5.2');
    try {
      for await (const chunk of await group.provider.streamChat({ model: model.id, messages, maxTokens: 1000 })) {
        if (events.signal?.aborted) break;
        text += chunk;
        events.streamChunk?.(chunk);
      }
      events.streamEnd?.();
      return { text: text.trim(), route, streamed: true };
    } catch (error) {
      events.streamEnd?.();
      this.trace.push({ type: 'processor_error', processor: 'nvidia:z-ai/glm-5.2', error: error.message });
      events.activityError?.('NVIDIA unavailable; continuing locally');
      return this.answerLocal(prompt, context, events, { route, maxTokens: 1000 });
    }
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
    let stoppedForRepetition = false;
    events.streamStart?.('EDITH');
    for await (const chunk of await this.router.stream(messages, { maxTokens })) {
      if (events.signal?.aborted) break;
      if (wouldRepeatPathologically(text, chunk)) {
        this.trace.push({ type: 'guardrail', title: 'Stopped repetitive model output' });
        stoppedForRepetition = true;
        break;
      }
      if (first) {
        this.trace.push({ type: 'stream', title: 'First token received' });
        first = false;
      }
      text += chunk;
      events.streamChunk?.(chunk);
    }
    if (stoppedForRepetition) {
      const ending = cleanStreamEnding(text);
      if (ending) {
        text += ending;
        events.streamChunk?.(ending);
      }
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
      'Respect workspace boundaries. Do not expose secrets. Workspace writes and personal/external writes require approved tools and confirmation; destructive work requires explicit confirmation.',
      'Use EDITH tools for live state. Never guess current time, date, timezone, Git branch, agent health, or web availability.',
      'Weather, markets, sports scores, current events, local business status, current prices, and latest software versions require live tools or a clear unavailable/error response.',
      'Runtime capability information below is internal operating context. Do not enumerate or repeat it unless the user explicitly asks about tools, agents, models, permissions, or availability. For ordinary conversation, answer naturally and concisely.',
      `Current model: ${status.model} via ${status.provider}.`,
      `Workspace: ${status.workspace}.`,
      '<internal_runtime_context>',
      this.capabilityManifest(),
      '</internal_runtime_context>'
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
      `Workspace permissions: ${this.workspacePermissionManifest()}.`,
      `Network permissions: ${this.networkPermissionManifest()}.`,
      this.contextCapabilityManifest()
    ].join('\n');
  }

  contextCapabilityManifest() {
    const rows = this.contextStatusRows ?? [];
    const available = rows.filter((row) => row.health === ConnectorHealth.CONNECTED).flatMap((row) => (row.capabilities ?? []).map((capability) => `${row.sourceType}.${capability}`));
    const unavailable = rows.filter((row) => row.health !== ConnectorHealth.CONNECTED).map((row) => `${row.sourceType}.read - ${row.health}`);
    return [
      `Personal context AVAILABLE: ${available.join(', ') || 'none'}`,
      `Personal context UNAVAILABLE: ${unavailable.join(', ') || 'none'}`,
      'Personal context policy: reads may run automatically; connected writes are confirmation-gated; destructive or external writes require explicit confirmation; keep personal context local unless explicitly approved.',
      this.authCapabilityManifest()
    ].join('\n');
  }

  workspacePermissionManifest() {
    const permissions = this.toolRegistry.list()
      .filter((tool) => tool.availability === 'AVAILABLE')
      .flatMap((tool) => tool.permissions ?? []);
    const unique = [...new Set(permissions)];
    return unique.join(', ') || 'none';
  }

  networkPermissionManifest() {
    const networkTools = this.toolRegistry.list().filter((tool) => ['web_search', 'web_fetch', 'docs_lookup', 'weather'].includes(tool.id) && tool.availability === 'AVAILABLE');
    if (!networkTools.length) return 'unavailable';
    return `${networkTools.map((tool) => tool.id).join(', ')}; public HTTP/HTTPS only; localhost/private network/file URLs blocked`;
  }

  authCapabilityManifest() {
    const google = this.authStatusRows.find((row) => row.provider === 'google');
    if (!google || google.status !== AuthState.CONNECTED) return 'Google Workspace: unavailable';
    const labels = google.approvedScopes?.length ? google.approvedScopes.join(', ') : 'identity';
    return `Google Workspace identity: available (${google.account}); approved scope groups: ${labels}.`;
  }

  pruneHistory() {
    if (this.history.length > MAX_MESSAGES) this.history = this.history.slice(-MAX_MESSAGES);
  }
}

function isMutationRequest(lower) {
  return /\b(move|reschedule|cancel|create|update|delete|send|reply|archive|label|complete|merge|push)\b/.test(lower)
    && /\b(meeting|event|calendar|email|mail|message|task|issue|pr|pull request|mr|merge request|github|gitlab)\b/.test(lower);
}

function acknowledgement(text) {
  const value = text.trim().toLowerCase();
  if (value === 'ready') return 'Ready. What are we working on?';
  if (value === 'thanks' || value === 'thank you') return 'You’re welcome.';
  if (value === 'cool' || value === "let's go") return 'Sounds good. What should we tackle first?';
  return 'Hello. What are we working on?';
}

function isExplicitNoLiveRequest(lower) {
  return /\b(don'?t|do not|without|no)\s+(search|look up|use tools?|use live|use web|access web)\b|\bjust\s+(tell|guess)\b|\byou already know\b/.test(lower);
}

function isLiveWeatherRequest(lower, lastWeatherLocation = null) {
  if (/\b(weather|forecast|temperature|temp|rain|snow|storm|humidity|wind|high|low|feels like)\b/.test(lower)
    && /\b(now|right now|today|tomorrow|this week|outside|in|for|will|what|what'?s|current)\b/.test(lower)) return true;
  return Boolean(lastWeatherLocation) && /\b(what about tomorrow|how about tomorrow|tomorrow\??|what about today|how about today|will it rain|what about the high|what about the low)\b/.test(lower);
}

function isCurrentExternalInformationRequest(lower) {
  return /\b(current|latest|recent|release|version|documentation|docs|api|sdk|search the web|look up|check the current|what are people saying|developers saying|discussion|discussions|forum|reddit|research companies|hiring|opportunities|what'?s happening|news)\b/.test(lower)
    || /\b(stock|stocks|market|markets|trading at|share price|crypto|bitcoin|ethereum|aapl|nvda|msft|googl|meta|tesla|tsla)\b/.test(lower)
    || /\b(score|won the game|who won|standings|schedule|game today)\b/.test(lower)
    || /\b(open right now|hours today|happening in .+ this weekend|events this weekend|price right now|cost right now)\b/.test(lower);
}

function extractWeatherLocation(text, lastWeatherLocation = null) {
  const trimmed = text.replace(/[?.!]+$/g, '').trim();
  if (lastWeatherLocation && /\b(what about|how about)?\s*tomorrow\b|\bwhat about today\b|\bwill it rain\b/.test(trimmed.toLowerCase()) && !/\b(in|for|near)\s+[a-z]/i.test(trimmed)) {
    return lastWeatherLocation;
  }
  const explicit = trimmed.match(/\b(?:in|for|near)\s+(.+?)(?:\s+(?:right now|today|tomorrow|this week))?$/i)?.[1];
  if (explicit) return normalizeWeatherLocationText(explicit);
  const outside = trimmed.match(/\boutside\s+(.+)$/i)?.[1];
  if (outside) return normalizeWeatherLocationText(outside);
  const cleaned = normalizeWeatherLocationText(trimmed
    .replace(/\bwhat'?s\b|\bwhat is\b|\bwill it\b|\bwhat will\b|\bwhat'?ll\b|\bweather\b|\bforecast\b|\btemperature\b|\btemp\b|\brain\b|\bsnow\b|\bstorm\b|\bhumidity\b|\bwind\b|\bhigh\b|\blow\b|\btoday\b|\btomorrow\b|\bright now\b|\bcurrent\b|\bbe\b|\bthe\b|\bin\b|\bfor\b|\?+/gi, ' '));
  return cleaned || lastWeatherLocation || 'local weather';
}

function normalizeWeatherLocationText(value) {
  return String(value)
    .replace(/\baz\b/gi, 'Arizona')
    .replace(/\bca\b/gi, 'California')
    .replace(/\bny\b/gi, 'New York')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatWeatherAnswer(userText, weather) {
  const lower = userText.toLowerCase();
  const dayIndex = /\btomorrow\b/.test(lower) ? 1 : 0;
  const day = weather.daily?.[dayIndex] ?? weather.daily?.[0] ?? {};
  const current = weather.current ?? {};
  const wantsRain = /\brain|precipitation|storm/.test(lower);
  const wantsHigh = /\bhigh\b/.test(lower);
  const wantsForecast = /\bforecast|tomorrow|today|will it|rain|high|low\b/.test(lower);
  const lines = [];
  if (wantsForecast && day.date) {
    const summary = [
      `${day.date} forecast for ${weather.location}: ${day.conditions}`,
      day.high == null ? null : `high ${formatTemp(day.high)}`,
      day.low == null ? null : `low ${formatTemp(day.low)}`,
      day.precipitationProbability == null ? null : `${day.precipitationProbability}% precipitation chance`,
      day.precipitation == null ? null : `${day.precipitation} in precipitation`,
      day.windSpeedMax == null ? null : `wind up to ${day.windSpeedMax} mph`
    ].filter(Boolean).join(', ');
    lines.push(`${summary}.`);
  }
  if (!wantsForecast || wantsHigh || wantsRain) {
    const now = [
      `Right now in ${weather.location}: ${current.temperature == null ? 'temperature unavailable' : formatTemp(current.temperature)}`,
      current.feelsLike == null ? null : `feels like ${formatTemp(current.feelsLike)}`,
      current.conditions,
      current.humidity == null ? null : `${current.humidity}% humidity`,
      current.windSpeed == null ? null : `wind ${current.windSpeed} mph`
    ].filter(Boolean).join(', ');
    lines.unshift(`${now}.`);
  }
  lines.push(`Observed/forecast timestamp: ${weather.observedAt ?? weather.retrievedAt}; timezone: ${weather.timezone ?? 'unknown'}.`);
  lines.push('Source: Open-Meteo Weather API.');
  return lines.join('\n');
}

function formatTemp(value) {
  return `${Math.round(value)} F`;
}

function wouldRepeatPathologically(existing, chunk) {
  const candidate = `${existing}${chunk}`;
  const normalized = candidate.replace(/\s+/g, ' ').trim();
  if (normalized.length < 160) return false;
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 45);
  const counts = new Map();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    const next = (counts.get(key) ?? 0) + 1;
    if (next >= 2) return true;
    counts.set(key, next);
  }
  const tail = normalized.slice(-900).toLowerCase();
  for (let size = 80; size <= 240; size += 40) {
    if (tail.length < size * 2) continue;
    const a = tail.slice(-size);
    const b = tail.slice(-(size * 2), -size);
    if (similarText(a, b) > 0.88) return true;
  }
  return false;
}

function cleanStreamEnding(text) {
  const trimmed = text.trimEnd();
  let suffix = '';
  if (!/[.!?)]$/.test(trimmed)) suffix += '…';
  const stars = (trimmed.match(/\*/g) ?? []).length;
  if (stars % 2 === 1) suffix += '*';
  return suffix;
}

function similarText(a, b) {
  const aWords = a.split(/\W+/).filter(Boolean);
  const bWords = b.split(/\W+/).filter(Boolean);
  if (!aWords.length || !bWords.length) return 0;
  const bSet = new Set(bWords);
  const overlap = aWords.filter((word) => bSet.has(word)).length;
  return overlap / Math.max(aWords.length, bWords.length);
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

function extractQuotedOrNamedEvent(text) {
  const quoted = text.match(/"([^"]+)"/)?.[1];
  if (quoted) return quoted.trim();
  const named = text.match(/\bnext\s+(.+?)\s+(?:event|meeting)\b/i)?.[1];
  if (named && !/\bcalendar\b/i.test(named)) return named.trim();
  const allCaps = text.match(/\b([A-Z][A-Z0-9 ]{6,})\b/);
  return allCaps?.[1]?.trim() ?? null;
}

function parseModelArg(value) {
  if (!value) return null;
  const slash = value.indexOf('/');
  if (slash > 0 && value.startsWith('ollama/')) return { providerId: 'ollama', modelId: value.slice('ollama/'.length) };
  const colon = value.indexOf(':');
  if (colon >= 0) return { providerId: value.slice(0, colon), modelId: value.slice(colon + 1) };
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

function sourceIndexFromText(text) {
  const lower = text.toLowerCase();
  if (/\bfirst\b/.test(lower)) return 0;
  if (/\bsecond\b/.test(lower)) return 1;
  if (/\bthird\b/.test(lower)) return 2;
  const match = lower.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

function formatSources(results) {
  return results.map((result, index) => `${index + 1}. ${result.title} - ${result.url}`).join('\n');
}

function humanNetworkError(error) {
  if (/fetch failed|ECONNRESET/i.test(error.message)) return 'the connection failed or was reset.';
  if (/timed out/i.test(error.message)) return 'the request timed out.';
  return error.message;
}
