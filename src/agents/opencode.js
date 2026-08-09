import { commandVersion, runProcess } from './process.js';

export class OpenCodeAdapter {
  id = 'opencode';
  name = 'OpenCode';
  integrationType = 'cli-subprocess';
  capabilities = ['interactive-tui', 'non-interactive-json-events', 'mcp-client', 'acp-server', 'sessions'];

  async health() {
    const version = await commandVersion('opencode');
    return {
      id: this.id,
      name: this.name,
      available: version.available,
      version: version.version,
      integrationType: this.integrationType,
      capabilities: this.capabilities,
      detail: version.available ? 'opencode CLI available' : version.error
    };
  }

  async sendTask(prompt, { cwd = process.cwd(), model = null, timeoutMs = 180000, autoApprove = false } = {}) {
    const selectedModel = model ?? 'lmstudio-local/qwen/qwen3-vl-4b';
    const args = ['run', '--format', 'json', '--model', selectedModel, '--dir', cwd];
    if (autoApprove) args.push('--auto');
    args.push(prompt);
    const result = await runProcess('opencode', args, { cwd, timeoutMs });
    if (result.code !== 0) throw new Error(result.stderr || `opencode exited ${result.code}`);
    return parseOpenCodeOutput(result.stdout);
  }
}

function parseOpenCodeOutput(stdout) {
  let text = '';
  const events = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      events.push(event);
      text += extractText(event);
    } catch {
      text += `${line}\n`;
    }
  }
  return { text: text.trim(), events };
}

function extractText(event) {
  if (typeof event.text === 'string') return event.text;
  if (event.part) return extractText(event.part);
  if (typeof event.message === 'string') return event.message;
  if (typeof event.content === 'string') return event.content;
  if (Array.isArray(event.parts)) return event.parts.map(extractText).join('');
  if (event.type === 'message' && Array.isArray(event.content)) return event.content.map(extractText).join('');
  return '';
}
