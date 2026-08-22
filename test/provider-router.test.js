import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProviderRouter, ProviderRouter } from '../src/providers/index.js';
import { NvidiaProvider } from '../src/providers/nvidia.js';

describe('provider router', () => {
  it('prefers a loaded LM Studio model', async () => {
    const router = new ProviderRouter({
      providers: [
        provider('lm-studio', 'LM Studio', [{ id: 'cold', state: 'not-loaded' }, { id: 'hot', state: 'loaded' }]),
        provider('ollama', 'Ollama', [{ id: 'qwen3:8b' }])
      ]
    });

    const selected = await router.selectInitial();

    assert.equal(selected.providerId, 'lm-studio');
    assert.equal(selected.model.id, 'hot');
  });

  it('does not restore an unloaded LM Studio model', async () => {
    const router = new ProviderRouter({
      providers: [
        provider('lm-studio', 'LM Studio', [{ id: 'cold', state: 'not-loaded' }]),
        provider('ollama', 'Ollama', [])
      ]
    });

    const selected = await router.selectInitial('lm-studio', 'cold');

    assert.equal(selected, null);
    assert.equal(router.current, null);
  });

  it('falls back to Ollama when LM Studio has no loaded models', async () => {
    const router = new ProviderRouter({
      providers: [
        provider('lm-studio', 'LM Studio', [{ id: 'cold', state: 'not-loaded' }]),
        provider('ollama', 'Ollama', [{ id: 'qwen3:8b' }])
      ]
    });

    const selected = await router.selectInitial();

    assert.equal(selected.providerId, 'ollama');
    assert.equal(selected.model.id, 'qwen3:8b');
  });

  it('registers NVIDIA without making it the automatic default', async () => {
    const previousKey = process.env.NVIDIA_API_KEY;
    const previousFetch = globalThis.fetch;
    delete process.env.NVIDIA_API_KEY;
    globalThis.fetch = async () => {
      throw new Error('network disabled in test');
    };
    try {
      const router = await createProviderRouter({});

      assert.ok(router.modelGroups.some((group) => group.providerId === 'nvidia'));
    } finally {
      if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it('does not select NVIDIA by default when only NVIDIA has models', async () => {
    const router = new ProviderRouter({
      providers: [
        provider('lm-studio', 'LM Studio', []),
        provider('ollama', 'Ollama', []),
        provider('nvidia', 'NVIDIA NIM', [{ id: 'z-ai/glm-5.2', capabilities: ['CHAT'], state: 'remote' }])
      ]
    });

    const selected = await router.selectInitial();

    assert.equal(selected, null);
    assert.equal(router.current, null);
  });

  it('selects configured NVIDIA models with slash-containing IDs', async () => {
    const router = new ProviderRouter({
      providers: [
        provider('lm-studio', 'LM Studio', []),
        provider('ollama', 'Ollama', []),
        provider('nvidia', 'NVIDIA NIM', [{ id: 'z-ai/glm-5.2', capabilities: ['CHAT'], state: 'remote' }])
      ]
    });

    const selected = await router.selectInitial('nvidia', 'z-ai/glm-5.2');

    assert.equal(selected.providerId, 'nvidia');
    assert.equal(selected.model.id, 'z-ai/glm-5.2');
  });

  // Model-string parsing (nvidia:z-ai/glm-5.2, ollama/qwen3:8b shorthand)
  // moved to the runtime catalog: see resolveModelSelection coverage in
  // test/headless.test.js and test/runtime-governance.test.js.
});

describe('NvidiaProvider', () => {
  it('reports missing API key without fetching', async () => {
    let called = false;
    const nvidia = new NvidiaProvider({
      apiKey: '',
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      }
    });

    assert.equal((await nvidia.health()).ok, false);
    assert.deepEqual(await nvidia.listModels(), []);
    await assert.rejects(
      async () => {
        for await (const _ of nvidia.streamChat({ model: 'z-ai/glm-5.2', messages: [] })) {
          // unreachable
        }
      },
      /NVIDIA_API_KEY/
    );
    assert.equal(called, false);
  });

  it('discovers models from the OpenAI-compatible models endpoint', async () => {
    const requests = [];
    const nvidia = new NvidiaProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return jsonResponse({ data: [{ id: 'z-ai/glm-5.2' }, { id: 'vendor/model/with/slashes' }] });
      }
    });

    const models = await nvidia.listModels();

    assert.deepEqual(models.map((model) => model.id), ['z-ai/glm-5.2', 'vendor/model/with/slashes']);
    assert.equal(models[0].provider, 'nvidia');
    assert.equal(requests[0].url, 'https://example.test/v1/models');
    assert.equal(requests[0].options.headers.authorization, 'Bearer test-key');
  });

  it('redacts the configured key from health errors', async () => {
    const nvidia = new NvidiaProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        throw new Error('failed with test-key');
      }
    });

    const health = await nvidia.health();

    assert.equal(health.ok, false);
    assert.equal(health.detail, 'failed with <REDACTED>');
  });

  it('falls back to known NVIDIA models when discovery fails', async () => {
    const nvidia = new NvidiaProvider({
      apiKey: 'test-key',
      fetchImpl: async () => new Response('unavailable', { status: 503 })
    });

    const models = await nvidia.listModels();

    assert.ok(models.some((model) => model.id === 'z-ai/glm-5.2'));
    assert.ok(models.some((model) => model.id === 'nvidia/nemotron-3-ultra-550b-a55b'));
    assert.ok(models.some((model) => model.id === 'minimaxai/minimax-m3'));
    assert.ok(models.some((model) => model.id === 'stepfun-ai/step-3.7-flash'));
    assert.ok(models.some((model) => model.id === 'poolside/laguna-xs-2.1'));
  });

  it('parses OpenAI-compatible streaming chat SSE frames', async () => {
    const requests = [];
    const nvidia = new NvidiaProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1/',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: [DONE]\n\n'
        ]);
      }
    });

    let output = '';
    for await (const chunk of nvidia.streamChat({ model: 'z-ai/glm-5.2', messages: [{ role: 'user', content: 'hi' }] })) {
      output += chunk;
    }

    assert.equal(output, 'Hello');
    assert.equal(requests[0].url, 'https://example.test/v1/chat/completions');
    assert.equal(JSON.parse(requests[0].options.body).model, 'z-ai/glm-5.2');
  });

  it('does not include upstream error bodies in NVIDIA chat errors', async () => {
    const nvidia = new NvidiaProvider({
      apiKey: 'test-key',
      fetchImpl: async () => new Response('test-key', { status: 401 })
    });

    await assert.rejects(
      async () => {
        for await (const _ of nvidia.streamChat({ model: 'z-ai/glm-5.2', messages: [] })) {
          // unreachable
        }
      },
      (error) => error.message === 'NVIDIA chat failed: HTTP 401'
    );
  });
});

function provider(id, name, models) {
  return {
    id,
    name,
    async listModels() {
      return models;
    },
    async health() {
      return { name, ok: true, detail: 'ok' };
    }
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  }));
}
