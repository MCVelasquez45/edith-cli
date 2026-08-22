// Thin HTTP client for the local TrueForge runtime (/api/v1).
// EDITH is the governor/client; TrueForge owns the agent loop, sessions,
// context, and tool execution. This wraps exactly the endpoints EDITH uses.

export class TrueForgeError extends Error {
  constructor(message, { status, method, path, body } = {}) {
    super(message);
    this.name = 'TrueForgeError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

export class TrueForgeClient {
  constructor({ baseUrl, fetchImpl = fetch, timeoutMs = 30000 }) {
    if (!baseUrl) throw new Error('TrueForgeClient requires baseUrl');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, apiPath, body, { signal, timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TrueForge request timed out')), timeoutMs ?? this.timeoutMs);
    const onOuterAbort = () => controller.abort(signal?.reason ?? new Error('aborted'));
    if (signal) {
      if (signal.aborted) onOuterAbort();
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${apiPath}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      if (!res.ok) {
        throw new TrueForgeError(`${method} ${apiPath} -> ${res.status}: ${typeof text === 'string' ? text.slice(0, 400) : ''}`, {
          status: res.status, method, path: apiPath, body: json
        });
      }
      return json;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }

  async health({ timeoutMs = 3000 } = {}) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await this.fetchImpl(`${this.baseUrl}/healthz`, { signal: controller.signal });
      clearTimeout(timer);
      const text = (await res.text()).trim();
      return res.ok && /ok/i.test(text);
    } catch {
      return false;
    }
  }

  me() {
    return this.request('GET', '/api/v1/auth/me');
  }

  // ---- model providers / models ----

  async upsertModelProvider(manifest) {
    try {
      return await this.request('POST', '/api/v1/settings/model-providers', { manifest });
    } catch (error) {
      if (isConflict(error)) return this.request('PUT', '/api/v1/settings/model-providers', { manifest });
      throw error;
    }
  }

  async listModelProviders() {
    const res = await this.request('GET', '/api/v1/settings/model-providers');
    return res?.data ?? res ?? [];
  }

  async listModels() {
    const res = await this.request('GET', '/api/v1/models');
    return res?.data ?? res ?? [];
  }

  // ---- MCP servers ----

  async upsertMcpServer(manifest) {
    try {
      return await this.request('POST', '/api/v1/settings/mcp-servers', { manifest });
    } catch (error) {
      if (isConflict(error)) return this.request('PUT', '/api/v1/settings/mcp-servers', { manifest });
      throw error;
    }
  }

  async listMcpServerTools(name) {
    const res = await this.request('GET', `/api/v1/mcp-servers/${encodeURIComponent(name)}/tools`);
    return res?.data ?? res ?? [];
  }

  // ---- agents ----

  async upsertAgent(name, manifest) {
    try {
      return await this.request('POST', '/api/v1/agents', { name, manifest });
    } catch (error) {
      if (isConflict(error)) return this.request('PUT', `/api/v1/agents/${encodeURIComponent(name)}`, { name, manifest });
      throw error;
    }
  }

  async listAgents() {
    const res = await this.request('GET', '/api/v1/agents');
    return res?.data ?? res ?? [];
  }

  // ---- sessions / turns ----

  async createSession({ agentName, title } = {}) {
    const body = { agent: { name: agentName } };
    if (title) body.title = title;
    const res = await this.request('POST', '/api/v1/sessions', body);
    return unwrap(res);
  }

  async listSessions() {
    const res = await this.request('GET', '/api/v1/sessions');
    return res?.data ?? res ?? [];
  }

  async getSession(sessionId) {
    return unwrap(await this.request('GET', `/api/v1/sessions/${sessionId}`));
  }

  async patchSession(sessionId, patch) {
    return unwrap(await this.request('PATCH', `/api/v1/sessions/${sessionId}`, patch));
  }

  deleteSession(sessionId) {
    return this.request('DELETE', `/api/v1/sessions/${sessionId}`);
  }

  cancelSession(sessionId) {
    return this.request('POST', `/api/v1/sessions/${sessionId}/cancel`);
  }

  async createTurn(sessionId, { input, stream = false } = {}) {
    return unwrap(await this.request('POST', `/api/v1/sessions/${sessionId}/turns`, { input, stream }));
  }

  async getTurn(sessionId, turnId) {
    return unwrap(await this.request('GET', `/api/v1/sessions/${sessionId}/turns/${turnId}`));
  }

  async getTurnEvents(sessionId, turnId) {
    const res = await this.request('GET', `/api/v1/sessions/${sessionId}/turns/${turnId}/events`);
    return res?.data ?? res?.events ?? res ?? [];
  }

  async listTurns(sessionId) {
    const res = await this.request('GET', `/api/v1/sessions/${sessionId}/turns`);
    return res?.data ?? res ?? [];
  }

  // Live SSE subscription to a running turn. Calls onEvent for each parsed
  // event payload; resolves when the stream ends or the signal aborts.
  async subscribeTurn(sessionId, turnId, { onEvent, signal } = {}) {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/sessions/${sessionId}/turns/${turnId}/subscribe`,
      { headers: { accept: 'text/event-stream' }, signal }
    );
    if (!res.ok || !res.body) {
      throw new TrueForgeError(`subscribe -> ${res.status}`, { status: res.status, method: 'GET', path: 'subscribe' });
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseFrame(frame);
        if (event !== undefined) onEvent?.(event);
      }
    }
  }
}

function parseSseFrame(frame) {
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return undefined;
  const raw = dataLines.join('\n');
  try { return JSON.parse(raw); } catch { return raw; }
}

function isConflict(error) {
  return error instanceof TrueForgeError && (error.status === 409 || /exists|conflict/i.test(error.message));
}

function unwrap(res) {
  return res?.data ?? res;
}
