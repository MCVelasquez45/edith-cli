// EDITH's normalized event model. Raw TrueForge turn events never reach the
// UI — they are translated here into a small set of product-level states and
// event shapes the terminal renderer understands.

export const EdithState = Object.freeze({
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  PLANNING: 'PLANNING',
  TOOL_RUNNING: 'TOOL_RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  STREAMING: 'STREAMING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

// Stateful normalizer for one turn: tracks tool-call names so approvals and
// tool results can be labeled, and separates reasoning from answer text.
export class TurnEventNormalizer {
  constructor() {
    this.toolCallsById = new Map();
    this.pendingCallByIndex = new Map();
    this.sawDelta = false;
  }

  toolName(toolCallId) {
    return this.toolCallsById.get(toolCallId)?.name ?? null;
  }

  toolArgs(toolCallId) {
    const call = this.toolCallsById.get(toolCallId);
    if (!call) return null;
    if (call.args !== undefined && call.args !== null) return call.args;
    if (call.argsText) {
      try { return JSON.parse(call.argsText); } catch { return call.argsText; }
    }
    return null;
  }

  normalize(event) {
    if (!event || typeof event !== 'object') return [];
    const type = event.type;
    const out = [];

    if (type === 'model.message.delta') {
      if (event.reasoning_content) {
        out.push({ state: EdithState.THINKING, type: 'reasoning-delta', text: event.reasoning_content });
      }
      if (typeof event.content === 'string' && event.content) {
        this.sawDelta = true;
        out.push({ state: EdithState.STREAMING, type: 'text-delta', text: event.content });
      }
      // Live tool calls stream as chunks: the first chunk carries id+name,
      // later chunks append argument fragments keyed by index.
      for (const chunk of event.tool_calls ?? []) {
        const index = chunk.index ?? 0;
        if (chunk.id) {
          const name = chunk.function?.name ?? chunk.tool_info?.name ?? 'tool';
          this.toolCallsById.set(chunk.id, { name, argsText: chunk.function?.arguments ?? '' });
          this.pendingCallByIndex.set(index, chunk.id);
          out.push({ state: EdithState.TOOL_RUNNING, type: 'tool-call', toolCallId: chunk.id, tool: name, args: null });
        } else if (chunk.function?.arguments) {
          const callId = this.pendingCallByIndex.get(index);
          const call = callId ? this.toolCallsById.get(callId) : null;
          if (call) call.argsText = (call.argsText ?? '') + chunk.function.arguments;
        }
      }
      return out;
    }

    if (type === 'model.message') {
      for (const call of event.tool_calls ?? []) {
        const name = call.function?.name ?? call.name ?? 'tool';
        let args = call.function?.arguments ?? call.arguments ?? null;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { /* keep raw */ } }
        const known = this.toolCallsById.get(call.id);
        this.toolCallsById.set(call.id, { name, args });
        if (known) continue; // already announced from live deltas
        out.push({ state: EdithState.TOOL_RUNNING, type: 'tool-call', toolCallId: call.id, tool: name, args });
      }
      const textBody = extractText(event.content);
      if (textBody) {
        // Complete message: only surface as text if we did not already stream it.
        out.push({ state: EdithState.STREAMING, type: 'text', text: textBody, streamed: this.sawDelta });
      }
      return out;
    }

    if (type === 'tool.response') {
      out.push({
        state: EdithState.TOOL_RUNNING,
        type: 'tool-result',
        toolCallId: event.tool_call_id,
        tool: this.toolName(event.tool_call_id),
        content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content ?? '')
      });
      return out;
    }

    if (type === 'tool.approval_required') {
      out.push({
        state: EdithState.WAITING_APPROVAL,
        type: 'approval-required',
        threadId: event.thread_id,
        toolCalls: (event.tool_calls ?? []).map((ref) => ({
          id: ref.id,
          tool: this.toolName(ref.id),
          args: this.toolArgs(ref.id)
        }))
      });
      return out;
    }

    if (type === 'turn.done') {
      const status = event.state?.status ?? 'done';
      // A "done" turn with required_actions is a pause (e.g. tool approval),
      // not a completion.
      const requiredActions = event.state?.required_actions ?? [];
      if (status === 'done' && requiredActions.length) {
        out.push({ state: EdithState.WAITING_APPROVAL, type: 'done', status: 'action_required', requiresAction: true });
        return out;
      }
      const state = status === 'cancelled' ? EdithState.CANCELLED : status === 'error' ? EdithState.FAILED : EdithState.COMPLETED;
      out.push({ state, type: 'done', status, error: event.state?.error ?? event.state?.message ?? null });
      return out;
    }

    if (type === 'thread.created') {
      out.push({ state: EdithState.TOOL_RUNNING, type: 'subagent-start', threadId: event.thread_id });
      return out;
    }
    if (type === 'thread.done') {
      out.push({ state: EdithState.TOOL_RUNNING, type: 'subagent-done', threadId: event.thread_id });
      return out;
    }

    // Runtime plumbing (mcp.initialize, sandbox.created, turn.created, ...)
    // surfaces only as low-priority diagnostics.
    out.push({ state: null, type: 'runtime', detail: type });
    return out;
  }
}

export function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? '').join('');
  }
  return '';
}

// Strip <think>...</think> blocks some local models emit inline.
export function stripInlineReasoning(text) {
  return String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
