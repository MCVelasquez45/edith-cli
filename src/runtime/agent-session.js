// EdithRuntime: the orchestration layer that makes EDITH a real agent.
//
//   user request → EDITH governance (classification, egress policy)
//     → TrueForge agent (reason → tool → observe → reason → answer)
//     → EDITH capability service (workspace tools)
//     → normalized events → EDITH UI
//
// EDITH stays the governor: it decides which agent (local vs cloud) may see
// which data, sanitizes anything leaving the machine, and owns approvals.

import process from 'node:process';
import { TrueForgeClient } from './client.js';
import { RuntimeSupervisor } from './supervisor.js';
import { CapabilityService } from '../capability/server.js';
import { buildToolset } from '../capability/toolset.js';
import { ModelKeyProxy } from './model-proxy.js';
import { TurnEventNormalizer, EdithState, stripInlineReasoning, extractText } from './events.js';
import {
  discoverLocalProviders, cloudProviderDescriptor, toTrueForgeManifest,
  buildModelCatalog, resolveModelSelection, ModelClass, NVIDIA_BASE
} from './models.js';
import { classifyData, DataClass } from '../routing/request-analysis.js';
import { egressDecision, sanitizeExternalPayload, APPROVED_CLOUD_PROCESSOR_ID } from '../routing/egress-policy.js';

export const LOCAL_AGENT = 'edith-local';
export const CLOUD_AGENT = 'edith-cloud';
const CAPABILITY_SERVER_NAME = 'edith-capabilities';

export class EdithRuntime {
  constructor({
    workspace,
    processingMode = 'local-first',
    instructions = null,
    approvalMode = 'safe', // safe: destructive gated · strict: write+destructive gated
    supervisor = null,
    capabilityService = null,
    fetchImpl = fetch,
    extraTools = []
  } = {}) {
    this.workspace = workspace ?? process.cwd();
    this.processingMode = processingMode;
    this.instructions = instructions;
    this.approvalMode = approvalMode;
    this.supervisor = supervisor ?? new RuntimeSupervisor({ fetchImpl });
    this.capabilityService = capabilityService ?? new CapabilityService({
      workspace: this.workspace,
      tools: buildToolset({ workspace: this.workspace, extras: extraTools })
    });
    this.extraTools = extraTools;
    this.fetchImpl = fetchImpl;
    this.client = null;
    this.catalog = { entries: [], classes: {} };
    this.selection = null;
    this.keyProxy = null;
    this.runtimeInfo = null;
  }

  async start({ onStatus = () => {}, modelSelection = null } = {}) {
    onStatus('runtime');
    this.runtimeInfo = await this.supervisor.ensureRunning({ onStatus });
    this.client = new TrueForgeClient({ baseUrl: this.runtimeInfo.baseUrl, fetchImpl: this.fetchImpl });

    onStatus('capabilities');
    const capabilityUrl = await this.capabilityService.start();
    await this.client.upsertMcpServer({
      type: 'remote',
      name: CAPABILITY_SERVER_NAME,
      url: capabilityUrl,
      description: 'EDITH workspace capability service (loopback only)'
    });

    onStatus('models');
    const providers = await discoverLocalProviders({ fetchImpl: this.fetchImpl });
    if (!providers.length) {
      throw new Error('No local model provider found. Start Ollama (`ollama serve`) or LM Studio, then run `edith` again.');
    }
    for (const provider of providers) {
      await this.client.upsertModelProvider(toTrueForgeManifest(provider));
    }

    if (process.env.NVIDIA_API_KEY) {
      this.keyProxy = new ModelKeyProxy({
        upstreamBaseUrl: NVIDIA_BASE,
        getApiKey: async () => process.env.NVIDIA_API_KEY
      });
      const proxyUrl = await this.keyProxy.start();
      const cloud = cloudProviderDescriptor({ proxyBaseUrl: `${proxyUrl}/v1` });
      if (cloud) {
        await this.client.upsertModelProvider(toTrueForgeManifest(cloud));
        providers.push(cloud);
      }
    }

    this.catalog = buildModelCatalog(providers);
    this.selection = resolveModelSelection(this.catalog, modelSelection)
      ?? resolveModelSelection(this.catalog, ModelClass.CODING)
      ?? this.catalog.entries.find((entry) => entry.location === 'LOCAL');
    if (!this.selection) throw new Error('No usable model found.');

    onStatus('agents');
    await this.ensureAgents();
    return this;
  }

  agentApprovalPolicy() {
    return this.approvalMode === 'strict' ? ['@write', '@destructive'] : ['@destructive'];
  }

  defaultInstructions() {
    return [
      'You are EDITH, a local-first AI coding agent and assistant running in a terminal.',
      `Your workspace is ${this.workspace}. You have workspace tools: use them to look at real files, git state, and command output before answering — never guess about workspace contents.`,
      'For coding tasks: inspect the relevant files first, make focused edits with edit_file, then verify with run_tests when a test command exists.',
      'Report what you changed concisely. If a tool fails, read the error and adapt rather than repeating the same call.',
      'Keep answers brief and concrete. Do not narrate tool mechanics; state findings and results.'
    ].join(' ');
  }

  async ensureAgents() {
    const mcpServers = [{
      name: CAPABILITY_SERVER_NAME,
      enable_tools: ['@all'],
      preload_tools: ['@all'],
      require_approval_for_tools: this.agentApprovalPolicy()
    }];
    const instructions = this.instructions ?? this.defaultInstructions();

    const localModel = this.selection.location === 'LOCAL'
      ? this.selection
      : resolveModelSelection(this.catalog, ModelClass.CODING);
    if (localModel) {
      await this.client.upsertAgent(LOCAL_AGENT, {
        model: { name: localModel.ref },
        instructions,
        mcp_servers: mcpServers
      });
      this.localModelRef = localModel.ref;
    }

    const cloudModel = this.catalog.entries.find((entry) => entry.location === 'CLOUD');
    if (cloudModel) {
      await this.client.upsertAgent(CLOUD_AGENT, {
        model: { name: cloudModel.ref },
        instructions,
        mcp_servers: mcpServers
      });
      this.cloudModelRef = cloudModel.ref;
    }
  }

  agentForSelection() {
    return this.selection?.location === 'CLOUD' ? CLOUD_AGENT : LOCAL_AGENT;
  }

  async switchModel(selection) {
    const resolved = resolveModelSelection(this.catalog, selection);
    if (!resolved) throw new Error(`Model not found: ${selection}. Try /model to list options.`);
    this.selection = resolved;
    await this.ensureAgents();
    return resolved;
  }

  async createSession() {
    const session = await this.client.createSession({ agentName: this.agentForSelection() });
    return { id: session.id ?? session.session_id, agentName: this.agentForSelection() };
  }

  // Governance gate for one turn. Returns { allowed, agentName, payload, notice }.
  governTurn({ text, agentName }) {
    const dataClasses = classifyData({ request: text });
    if (agentName === CLOUD_AGENT) {
      const decision = egressDecision({
        dataClasses,
        processor: { id: APPROVED_CLOUD_PROCESSOR_ID, location: 'CLOUD' },
        mode: this.processingMode
      });
      if (!decision.allowed) {
        return {
          allowed: false,
          agentName,
          payload: null,
          notice: `Cloud processing blocked: ${decision.reason}. Switch to a local model (/model local-reasoning) for this request.`,
          dataClasses
        };
      }
      return { allowed: true, agentName, payload: sanitizeExternalPayload(text), notice: null, dataClasses, sanitized: true };
    }
    return { allowed: true, agentName, payload: text, notice: null, dataClasses };
  }

  // Run one conversational turn with streaming events, approval pauses, and
  // cancellation. Returns { state, text, cancelled, failed, error }.
  async runTurn({ sessionId, agentName = null, text, onEvent = () => {}, requestApproval = null, signal = null }) {
    const effectiveAgent = agentName ?? this.agentForSelection();
    const verdict = this.governTurn({ text, agentName: effectiveAgent });
    if (!verdict.allowed) {
      onEvent({ state: EdithState.FAILED, type: 'governance-blocked', notice: verdict.notice });
      return { state: EdithState.FAILED, text: verdict.notice, failed: true, governanceBlocked: true };
    }
    if (verdict.sanitized) onEvent({ state: null, type: 'governance', detail: 'payload sanitized for cloud processing' });

    let input = [{ type: 'user.message', content: verdict.payload }];
    // Approval resume loop: a turn can pause for approval multiple times.
    for (let hop = 0; hop < 20; hop += 1) {
      const result = await this.executeTurn({ sessionId, input, onEvent, signal });
      if (result.state !== EdithState.WAITING_APPROVAL) return result;

      if (!requestApproval) {
        return { state: EdithState.FAILED, text: 'Tool approval required but no approver is available.', failed: true };
      }
      const approval = await requestApproval(result.approval);
      if (signal?.aborted) return this.cancelResult(sessionId, onEvent);
      input = result.approval.toolCalls.map((call) => ({
        type: 'user.tool_approval',
        thread_id: result.approval.threadId,
        tool_call_id: call.id,
        approval: approval.approved
          ? { status: 'allow' }
          : { status: 'deny', reason: approval.reason ?? 'denied by user' }
      }));
      onEvent({
        state: null,
        type: 'approval-decision',
        approved: approval.approved,
        tools: result.approval.toolCalls.map((call) => call.tool)
      });
    }
    return { state: EdithState.FAILED, text: 'Too many approval rounds in one turn.', failed: true };
  }

  async cancelResult(sessionId, onEvent) {
    await this.client.cancelSession(sessionId).catch(() => {});
    onEvent({ state: EdithState.CANCELLED, type: 'done', status: 'cancelled' });
    return { state: EdithState.CANCELLED, text: '', cancelled: true };
  }

  // Create one TrueForge turn and follow it to a pause or terminal state.
  // Live events stream on the turn-creation response; afterwards the
  // persisted event log and turn state are used to reconcile anything the
  // live stream did not carry.
  async executeTurn({ sessionId, input, onEvent, signal }) {
    if (signal?.aborted) return this.cancelResult(sessionId, onEvent);

    const normalizer = new TurnEventNormalizer();
    let finalText = '';
    let streamedText = '';
    let approval = null;
    let terminal = null;
    let turnId = null;
    const seenEventIds = new Set();

    const handleRaw = (raw) => {
      if (raw?.type === 'turn.created') turnId = raw.turn_id ?? raw.id ?? turnId;
      // Dedup persisted events between the live stream and the post-turn
      // replay. Deltas are excluded: they are never persisted (no replay
      // overlap) and they share their ULID with the model.message they
      // compose, so id-dedup would swallow them and the final message.
      const eventId = raw?.type === 'model.message.delta' ? null : raw?.id;
      if (eventId) {
        if (seenEventIds.has(eventId)) return;
        seenEventIds.add(eventId);
      }
      for (const event of normalizer.normalize(raw)) {
        if (event.type === 'text-delta') streamedText += event.text;
        if (event.type === 'text') finalText = event.text;
        if (event.type === 'approval-required') approval = event;
        if (event.type === 'done') terminal = event;
        if (event.type === 'text' && event.streamed) continue; // already rendered via deltas
        onEvent(event);
      }
    };

    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.client.createTurnStreaming(sessionId, { input, onEvent: handleRaw, signal: abortController.signal });
    } catch (error) {
      if (!signal?.aborted) {
        // Live stream failed to start or died mid-turn. If the turn was
        // created, reconcile below; otherwise surface the failure.
        if (!turnId) throw error;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal?.aborted) return this.cancelResult(sessionId, onEvent);

    // Reconcile with persisted state: poll to a resting state if needed,
    // replay missed events, and prefer the turn's recorded final output.
    if (turnId && (!terminal || !(streamedText || finalText))) {
      let status = null;
      let turnState = null;
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        if (signal?.aborted) return this.cancelResult(sessionId, onEvent);
        const current = await this.client.getTurn(sessionId, turnId).catch(() => null);
        status = current?.status ?? current?.state?.status;
        turnState = current?.state ?? null;
        if (status && !['running', 'pending', 'queued', 'in_progress'].includes(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const events = await this.client.getTurnEvents(sessionId, turnId).catch(() => []);
      for (const raw of Array.isArray(events) ? events : []) handleRaw(raw);
      const recorded = extractText(turnState?.output?.content ?? '');
      if (recorded) finalText = recorded;
      if (!terminal && status) {
        terminal = {
          state: status === 'cancelled' ? EdithState.CANCELLED : status === 'error' ? EdithState.FAILED : EdithState.COMPLETED,
          type: 'done',
          status,
          error: turnState?.error ?? turnState?.message ?? null
        };
      }
    }

    if (approval && (!terminal || terminal.requiresAction)) {
      return { state: EdithState.WAITING_APPROVAL, approval, turnId };
    }

    const answer = stripInlineReasoning(finalText || streamedText);
    if (terminal?.state === EdithState.CANCELLED) return { state: EdithState.CANCELLED, text: answer, cancelled: true, turnId };
    if (terminal?.state === EdithState.FAILED) {
      return { state: EdithState.FAILED, text: answer, failed: true, error: terminal.error ?? 'turn failed', turnId };
    }
    return { state: EdithState.COMPLETED, text: answer, turnId };
  }

  status() {
    return {
      runtime: this.runtimeInfo?.baseUrl ?? null,
      capabilityUrl: this.capabilityService?.url ?? null,
      model: this.selection?.ref ?? null,
      modelLocation: this.selection?.location ?? null,
      agent: this.agentForSelection(),
      processingMode: this.processingMode,
      approvalMode: this.approvalMode,
      modelClasses: this.catalog.classes
    };
  }

  async stop({ stopRuntime = false } = {}) {
    await this.capabilityService?.stop();
    await this.keyProxy?.stop();
    if (stopRuntime) await this.supervisor.shutdown();
  }
}
