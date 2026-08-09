import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderRouter } from '../src/providers/index.js';

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
