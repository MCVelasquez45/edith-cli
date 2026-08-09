import { commandVersion, runProcess } from './process.js';

export class CodexAdapter {
  id = 'codex';
  name = 'Codex';
  integrationType = 'exec-jsonl-cli';
  capabilities = ['non-interactive', 'jsonl-events', 'mcp-client', 'mcp-server', 'permissions'];

  async health() {
    const version = await commandVersion('codex');
    return {
      id: this.id,
      name: this.name,
      available: version.available,
      version: version.version,
      integrationType: this.integrationType,
      capabilities: this.capabilities,
      detail: version.available ? 'codex CLI available' : version.error
    };
  }

  async sendTask(prompt, { cwd = process.cwd(), timeoutMs = 180000 } = {}) {
    const result = await runProcess('codex', [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--json',
      prompt
    ], { cwd, timeoutMs });
    if (result.code !== 0) throw new Error(result.stderr || `codex exited ${result.code}`);
    return parseCodexJsonl(result.stdout);
  }
}

function parseCodexJsonl(stdout) {
  const events = [];
  let text = '';
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      events.push(event);
      text = extractCodexText(event) || text;
    } catch {
      text += `${line}\n`;
    }
  }
  return { text: text.trim() || stdout.trim(), events };
}

function extractCodexText(event) {
  if (typeof event.message === 'string') return event.message;
  if (typeof event.content === 'string') return event.content;
  if (typeof event.final_answer === 'string') return event.final_answer;
  if (typeof event.output === 'string') return event.output;
  if (event.type === 'agent_message' && typeof event.text === 'string') return event.text;
  if (event.type === 'item.completed' && typeof event.item?.text === 'string') return event.item.text;
  return '';
}
