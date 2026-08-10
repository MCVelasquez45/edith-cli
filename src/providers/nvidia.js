const DEFAULT_BASE =
  process.env.EDITH_NVIDIA_BASE_URL ??
  'https://integrate.api.nvidia.com/v1';

const DEFAULT_MODELS = [
  {
    id: 'z-ai/glm-5.2',
    capabilities: ['CHAT', 'CODING', 'REASONING', 'TOOL_CALLING']
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    capabilities: ['CHAT', 'CODING', 'REASONING', 'TOOL_CALLING']
  },
  {
    id: 'minimaxai/minimax-m3',
    capabilities: ['CHAT', 'CODING', 'REASONING', 'VISION', 'TOOL_CALLING']
  },
  {
    id: 'stepfun-ai/step-3.7-flash',
    capabilities: ['CHAT', 'CODING', 'REASONING']
  },
  {
    id: 'poolside/laguna-xs-2.1',
    capabilities: ['CHAT', 'CODING', 'REASONING']
  }
];

export class NvidiaProvider {
  id = 'nvidia';
  name = 'NVIDIA NIM';

  constructor({
    apiKey = process.env.NVIDIA_API_KEY,
    baseUrl = DEFAULT_BASE,
    fetchImpl = fetch
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  headers() {
    if (!this.apiKey) {
      throw new Error(
        'NVIDIA_API_KEY is not configured. Export NVIDIA_API_KEY before starting EDITH.'
      );
    }

    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`
    };
  }

  async health() {
    if (!this.apiKey) {
      return {
        name: this.name,
        ok: false,
        detail: 'NVIDIA_API_KEY not configured'
      };
    }

    try {
      const res = await this.fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        return {
          name: this.name,
          ok: false,
          detail: `HTTP ${res.status}`
        };
      }

      return {
        name: this.name,
        ok: true,
        detail: `connected @ ${this.baseUrl}`
      };
    } catch (error) {
      return {
        name: this.name,
        ok: false,
        detail: redactSecret(error.message, this.apiKey)
      };
    }
  }

  async listModels() {
    if (!this.apiKey) return [];

    try {
      const res = await this.fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const body = await res.json();

        if (Array.isArray(body.data) && body.data.length) {
          return body.data.map((model) => ({
            id: model.id,
            provider: this.id,
            capabilities: classifyNvidiaModel(model.id),
            state: 'remote'
          }));
        }
      }
    } catch {
      // Fall back to known NVIDIA-hosted models below.
    }

    return DEFAULT_MODELS.map((model) => ({
      ...model,
      provider: this.id,
      state: 'remote'
    }));
  }

  async *streamChat({
    model,
    messages,
    maxTokens = 900,
    temperature = 0.2
  }) {
    const res = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!res.ok) throw new Error(`NVIDIA chat failed: HTTP ${res.status}`);

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

          const content =
            json.choices?.[0]?.delta?.content ??
            json.choices?.[0]?.text ??
            '';

          if (content) yield content;
        }
      }
    }
  }
}

function classifyNvidiaModel(id = '') {
  const lower = id.toLowerCase();

  if (lower.includes('embed')) return ['EMBEDDING'];

  const caps = ['CHAT'];

  if (
    lower.includes('glm') ||
    lower.includes('nemotron') ||
    lower.includes('minimax') ||
    lower.includes('step') ||
    lower.includes('laguna') ||
    lower.includes('coder')
  ) {
    caps.push('CODING');
  }

  if (
    lower.includes('reason') ||
    lower.includes('glm') ||
    lower.includes('nemotron')
  ) {
    caps.push('REASONING');
  }

  if (
    lower.includes('vision') ||
    lower.includes('vl') ||
    lower.includes('omni') ||
    lower.includes('minimax')
  ) {
    caps.push('VISION');
  }

  return caps;
}

function redactSecret(message, secret) {
  if (!secret) return message;
  return String(message).split(secret).join('<REDACTED>');
}
