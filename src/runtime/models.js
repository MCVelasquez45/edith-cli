// Local model discovery and TrueForge provider manifests.
//
// EDITH discovers what is actually running (Ollama, LM Studio) and registers
// each as a `custom` OpenAI-compatible provider in TrueForge. Cloud providers
// are registered through a loopback key-injection proxy so API keys never
// enter TrueForge's plaintext persistence.
//
// Users think in model classes (Local Fast / Local Reasoning / Cloud ...);
// classes map onto discovered concrete models here.

import { APPROVED_CLOUD_MODEL_ID } from '../routing/egress-policy.js';

export const OLLAMA_BASE = process.env.EDITH_OLLAMA_BASE ?? 'http://127.0.0.1:11434';
export const LMSTUDIO_BASE = process.env.EDITH_LMSTUDIO_BASE ?? 'http://127.0.0.1:1234';
export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

export function sanitizeModelName(modelId) {
  return String(modelId).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Discover locally served models. Returns provider descriptors:
// { providerName, baseUrl, location: 'LOCAL', models: [{ model_id, name, contextLength, toolCapable }] }
export async function discoverLocalProviders({ fetchImpl = fetch } = {}) {
  const providers = [];

  const ollama = await fetchJson(`${OLLAMA_BASE}/api/tags`, { fetchImpl });
  if (ollama?.models?.length) {
    providers.push({
      providerName: 'ollama-local',
      baseUrl: `${OLLAMA_BASE}/v1`,
      location: 'LOCAL',
      models: ollama.models
        .filter((model) => !/embed/i.test(model.name))
        .map((model) => ({
          model_id: model.name,
          name: sanitizeModelName(model.name),
          contextLength: model.details?.context_length ?? 32768,
          toolCapable: model.capabilities ? model.capabilities.includes('tools') : true,
          reasoning: (model.capabilities ?? []).includes('thinking'),
          sizeBytes: model.size ?? null
        }))
    });
  }

  const lmstudio = await fetchJson(`${LMSTUDIO_BASE}/v1/models`, { fetchImpl });
  if (lmstudio?.data?.length) {
    providers.push({
      providerName: 'lmstudio-local',
      baseUrl: `${LMSTUDIO_BASE}/v1`,
      location: 'LOCAL',
      models: lmstudio.data
        .filter((model) => !/embed/i.test(model.id))
        .map((model) => ({
          model_id: model.id,
          name: sanitizeModelName(model.id),
          contextLength: 32768,
          toolCapable: true,
          reasoning: false,
          sizeBytes: null
        }))
    });
  }

  return providers;
}

// Cloud provider descriptor (registered only when a key exists; the key is
// injected by EDITH's loopback proxy, never stored in TrueForge).
export function cloudProviderDescriptor({ proxyBaseUrl }) {
  if (!process.env.NVIDIA_API_KEY) return null;
  return {
    providerName: 'edith-cloud',
    baseUrl: proxyBaseUrl,
    location: 'CLOUD',
    models: [{
      model_id: APPROVED_CLOUD_MODEL_ID,
      name: sanitizeModelName(APPROVED_CLOUD_MODEL_ID),
      contextLength: 128000,
      toolCapable: true,
      reasoning: true,
      sizeBytes: null
    }]
  };
}

export function toTrueForgeManifest(provider) {
  return {
    type: 'custom',
    name: provider.providerName,
    base_url: provider.baseUrl,
    models: provider.models.map((model) => ({
      model_id: model.model_id,
      name: model.name,
      properties: {
        context_length: model.contextLength ?? 32768,
        max_output_tokens: 4096
      }
    }))
  };
}

// Model classes: understandable names over concrete provider/model pairs.
export const ModelClass = Object.freeze({
  LOCAL_FAST: 'local-fast',
  LOCAL_REASONING: 'local-reasoning',
  CODING: 'coding',
  CLOUD_REASONING: 'cloud-reasoning'
});

// Build the model catalog: every concrete model plus class assignments.
// Preference order inside a class: smaller = faster for LOCAL_FAST,
// reasoning-capable & larger for LOCAL_REASONING/CODING.
export function buildModelCatalog(providers) {
  const entries = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      entries.push({
        ref: `${provider.providerName}/${model.name}`,
        providerName: provider.providerName,
        location: provider.location,
        modelId: model.model_id,
        name: model.name,
        contextLength: model.contextLength,
        reasoning: !!model.reasoning,
        sizeBytes: model.sizeBytes
      });
    }
  }

  const local = entries.filter((entry) => entry.location === 'LOCAL');
  const cloud = entries.filter((entry) => entry.location === 'CLOUD');
  const bySizeAsc = [...local].sort((a, b) => (a.sizeBytes ?? Infinity) - (b.sizeBytes ?? Infinity));
  const bySizeDesc = [...local].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

  const classes = {};
  if (bySizeAsc.length) classes[ModelClass.LOCAL_FAST] = bySizeAsc[0].ref;
  const reasoningLocal = bySizeDesc.find((entry) => entry.reasoning) ?? bySizeDesc[0];
  if (reasoningLocal) {
    classes[ModelClass.LOCAL_REASONING] = reasoningLocal.ref;
    classes[ModelClass.CODING] = reasoningLocal.ref;
  }
  if (cloud.length) classes[ModelClass.CLOUD_REASONING] = cloud[0].ref;

  return { entries, classes };
}

export function resolveModelSelection(catalog, selection) {
  if (!selection) return null;
  if (catalog.classes[selection]) {
    return catalog.entries.find((entry) => entry.ref === catalog.classes[selection]) ?? null;
  }
  return catalog.entries.find((entry) => entry.ref === selection || entry.modelId === selection || entry.name === selection) ?? null;
}
