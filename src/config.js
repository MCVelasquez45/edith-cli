import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const EDITH_CONFIG_DIR = process.env.EDITH_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'edith');
export const EDITH_CONFIG_PATH = path.join(EDITH_CONFIG_DIR, 'config.json');
export const DEFAULT_PROCESSING_MODE = 'local-first';
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function defaultConfig() {
  return {
    version: 1,
    defaults: {
      codeModel: process.env.EDITH_CODE_MODEL ?? 'lmstudio-local/qwen/qwen3-vl-4b',
      defaultAssistantProvider: process.env.EDITH_ASSISTANT_PROVIDER ?? 'lm-studio',
      defaultAssistantModel: process.env.EDITH_ASSISTANT_MODEL ?? 'qwen/qwen3-vl-4b',
      defaultCodingProvider: process.env.EDITH_CODING_PROVIDER ?? 'lm-studio',
      defaultCodingModel: process.env.EDITH_CODING_MODEL ?? 'qwen/qwen3-vl-4b',
      defaultVisionProvider: process.env.EDITH_VISION_PROVIDER ?? 'lm-studio',
      defaultVisionModel: process.env.EDITH_VISION_MODEL ?? 'qwen/qwen3-vl-4b',
      localChatProvider: 'lm-studio',
      localChatModel: 'qwen/qwen3-vl-4b'
    },
    processing: {
      mode: process.env.EDITH_PROCESSING_MODE ?? DEFAULT_PROCESSING_MODE
    },
    mcp: {
      servers: {
        self: {
          transport: 'stdio',
          command: process.execPath,
          args: [path.join(PACKAGE_ROOT, 'bin/edith.js'), 'mcp-server'],
          enabled: true,
          allowTools: ['edith_status', 'list_local_models', 'ask_local_model'],
          timeoutMs: 30000
        }
      }
    },
    tools: {
      defaultTimeoutMs: 30000,
      maxOutputBytes: 64000
    },
    agents: {
      defaultTimeoutMs: 120000
    }
  };
}

export async function loadConfig(cwd = process.cwd()) {
  const base = defaultConfig();
  let user = {};
  try {
    user = JSON.parse(await fs.readFile(EDITH_CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = mergeConfig(base, user);
  return config;
}

export async function saveConfig(config) {
  await fs.mkdir(EDITH_CONFIG_DIR, { recursive: true });
  await fs.writeFile(EDITH_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function mergeConfig(base, user) {
  if (!user || typeof user !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(user)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = mergeConfig(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
