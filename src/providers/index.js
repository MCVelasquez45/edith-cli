import { OllamaProvider } from './ollama.js';
import { LMStudioProvider } from './lm-studio.js';

export async function createProviderRouter({ ui }) {
  const router = new ProviderRouter({
    providers: [new LMStudioProvider(), new OllamaProvider()],
    ui
  });
  await router.refresh();
  return router;
}

export class ProviderRouter {
  constructor({ providers, ui }) {
    this.providers = providers;
    this.ui = ui;
    this.current = null;
    this.modelGroups = [];
  }

  async refresh() {
    this.modelGroups = [];
    for (const provider of this.providers) {
      let models = [];
      try {
        models = await provider.listModels();
      } catch {
        models = [];
      }
      this.modelGroups.push({ providerId: provider.id, providerName: provider.name, provider, models });
    }
  }

  async health() {
    const results = [];
    for (const provider of this.providers) {
      try {
        results.push(await provider.health());
      } catch (error) {
        results.push({ name: provider.name, ok: false, detail: error.message });
      }
    }
    return results;
  }

  async listModels() {
    await this.refresh();
    return this.modelGroups.map(({ providerId, providerName, models }) => ({ providerId, providerName, models }));
  }

  async selectInitial(providerId, modelId) {
    await this.refresh();
    const restored = this.findModel(providerId, modelId);
    if (restored && isUsableModel(restored.model)) return this.setCurrent(restored.providerId, restored.model.id);
    const verifiedCoding = this.findModel('lm-studio', 'qwen/qwen3-vl-4b');
    if (verifiedCoding && isUsableModel(verifiedCoding.model)) return this.setCurrent('lm-studio', verifiedCoding.model.id);
    const loadedLm = this.modelGroups
      .find((g) => g.providerId === 'lm-studio')?.models
      .find((m) => m.state === 'loaded' && !m.capabilities?.includes('EMBEDDING'));
    if (loadedLm) return this.setCurrent('lm-studio', loadedLm.id);
    const firstLm = this.modelGroups.find((g) => g.providerId === 'lm-studio')?.models.find(isUsableModel);
    if (firstLm) return this.setCurrent('lm-studio', firstLm.id);
    const firstOllama = this.modelGroups.find((g) => g.providerId === 'ollama')?.models[0];
    if (firstOllama) return this.setCurrent('ollama', firstOllama.id);
    return null;
  }

  findModel(providerId, modelId) {
    const group = this.modelGroups.find((g) => g.providerId === providerId);
    const model = group?.models.find((m) => m.id === modelId);
    return model ? { providerId, model } : null;
  }

  setCurrent(providerId, modelId) {
    const group = this.modelGroups.find((g) => g.providerId === providerId);
    if (!group) throw new Error(`Unknown provider ${providerId}`);
    const model = group.models.find((m) => m.id === modelId);
    if (!model) throw new Error(`Unknown model ${modelId}`);
    this.current = { providerId, providerName: group.providerName, provider: group.provider, model };
    return this.current;
  }

  async stream(messages, options = {}) {
    if (!this.current) throw new Error('No model selected. Use /model.');
    return this.current.provider.streamChat({ model: this.current.model.id, messages, ...options });
  }

  async complete(messages, options = {}) {
    let out = '';
    for await (const chunk of await this.stream(messages, options)) out += chunk;
    return out;
  }
}

function isUsableModel(model) {
  return !model.capabilities?.includes('EMBEDDING') && (!model.state || model.state === 'loaded' || model.state === 'unknown');
}
