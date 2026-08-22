import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createProviderRouter } from '../providers/index.js';
import { defaultConfig } from '../config.js';

export function createEdithMcpServer() {
  const server = new McpServer({ name: 'edith', version: '0.1.0' });

  server.registerTool(
    'edith_status',
    {
      title: 'EDITH Status',
      description: 'Return basic EDITH health and available safe capabilities.',
      inputSchema: z.object({})
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ ok: true, name: 'EDITH', capabilities: ['models', 'local-chat'] }, null, 2) }]
    })
  );

  server.registerTool(
    'list_local_models',
    {
      title: 'List Local Models',
      description: 'List live EDITH model inventory.',
      inputSchema: z.object({})
    },
    async () => {
      const router = await createProviderRouter({ ui: null });
      return {
        content: [{ type: 'text', text: JSON.stringify(await router.listModels(), null, 2) }]
      };
    }
  );

  server.registerTool(
    'ask_local_model',
    {
      title: 'Ask Local Model',
      description: 'Ask the default local chat model a short question.',
      inputSchema: z.object({
        prompt: z.string().min(1).max(2000)
      })
    },
    async ({ prompt }) => {
      const router = await createProviderRouter({ ui: null });
      const localChat = defaultConfig().defaults;
      const preferred = router.findModel(localChat.localChatProvider, localChat.localChatModel)
        ?? router.modelGroups
          .filter((group) => group.providerId === 'lm-studio' || group.providerId === 'ollama')
          .flatMap((group) => group.models.map((model) => ({ providerId: group.providerId, model })))
          .find((item) => item.model.capabilities?.includes('CHAT'));
      if (!preferred) throw new Error('No local chat model available');
      router.setCurrent(preferred.providerId, preferred.model.id);
      let text = '';
      for await (const chunk of await router.stream([{ role: 'user', content: prompt }], { maxTokens: 256 })) text += chunk;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerResource(
    'edith://status',
    'edith://status',
    {
      title: 'EDITH Status',
      description: 'Static EDITH MCP server status.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ok: true }, null, 2) }]
    })
  );

  server.registerPrompt(
    'local-model-smoke-test',
    {
      title: 'Local Model Smoke Test',
      description: 'Prompt that verifies local model routing.'
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'Reply with exactly LOCAL EDITH OK' } }]
    })
  );

  return server;
}

export function serveEdithMcpStdio() {
  serveStdio(() => createEdithMcpServer(), {
    onerror(error) {
      process.stderr.write(`EDITH MCP error: ${error.message}\n`);
    }
  });
}
