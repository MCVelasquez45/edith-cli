const DEFAULT_BASE = process.env.EDITH_OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';

export class OllamaProvider {
  id = 'ollama';
  name = 'Ollama';
  baseUrl = DEFAULT_BASE;
  openCodeProviderId = 'ollama-local';

  async health() {
    const res = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { name: this.name, ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { name: this.name, ok: true, detail: `version ${body.version} @ ${this.baseUrl}` };
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Ollama model discovery failed: ${res.status}`);
    const body = await res.json();
    return (body.models ?? []).map((m) => ({
      id: m.model ?? m.name,
      provider: this.id,
      family: m.details?.family,
      size: m.size,
      quantization: m.details?.quantization_level,
      contextLength: m.details?.context_length,
      capabilities: normalizeCapabilities(m.capabilities ?? [])
    }));
  }

  async *streamChat({ model, messages, maxTokens = 900 }) {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { num_predict: maxTokens } }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`Ollama chat failed: HTTP ${res.status} ${await res.text()}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line);
        if (json.error) throw new Error(json.error);
        if (json.message?.content) yield json.message.content;
      }
    }
  }
}

function normalizeCapabilities(capabilities) {
  const out = [];
  if (capabilities.includes('completion')) out.push('CHAT');
  if (capabilities.includes('tools')) out.push('TOOL_CALLING');
  if (capabilities.includes('thinking')) out.push('REASONING');
  return out.length ? out : ['UNKNOWN'];
}
