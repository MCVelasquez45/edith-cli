const DEFAULT_BASE = process.env.EDITH_LM_STUDIO_BASE_URL ?? 'http://127.0.0.1:1234';

export class LMStudioProvider {
  id = 'lm-studio';
  name = 'LM Studio';
  baseUrl = DEFAULT_BASE;
  openCodeProviderId = 'lmstudio-local';

  async health() {
    const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { name: this.name, ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { name: this.name, ok: true, detail: `${body.data?.length ?? 0} models @ ${this.baseUrl}` };
  }

  async listModels() {
    const native = await this.nativeModels().catch(() => null);
    if (native?.data?.length) {
      return native.data.map((m) => ({
        id: m.id,
        provider: this.id,
        type: m.type,
        family: m.arch,
        quantization: m.quantization,
        contextLength: m.max_context_length,
        loadedContextLength: m.loaded_context_length,
        state: m.state,
        capabilities: classifyLMStudioModel(m),
        rawCapabilities: m.capabilities ?? []
      }));
    }
    const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`LM Studio model discovery failed: ${res.status}`);
    const body = await res.json();
    return (body.data ?? []).map((m) => ({
      id: m.id,
      provider: this.id,
      capabilities: classifyById(m.id),
      state: 'unknown'
    }));
  }

  async nativeModels() {
    const res = await fetch(`${this.baseUrl}/api/v0/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`LM Studio native discovery failed: ${res.status}`);
    return res.json();
  }

  async *streamChat({ model, messages, maxTokens = 900 }) {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, temperature: 0.2 }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`LM Studio chat failed: HTTP ${res.status} ${await res.text()}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
          if (content) yield content;
        }
      }
    }
  }
}

function classifyLMStudioModel(model) {
  if (model.type === 'embeddings') return ['EMBEDDING'];
  const caps = classifyById(model.id);
  if (model.type === 'vlm' && !caps.includes('VISION')) caps.push('VISION');
  return caps;
}

function classifyById(id) {
  const lower = id.toLowerCase();
  if (lower.includes('embed')) return ['EMBEDDING'];
  const caps = ['CHAT'];
  if (lower.includes('qwen') || lower.includes('mistral') || lower.includes('coder')) caps.push('CODING');
  if (lower.includes('vl')) caps.push('VISION');
  if (lower.includes('qwen3-vl-4b')) caps.push('TOOL_CALLING');
  return caps;
}
