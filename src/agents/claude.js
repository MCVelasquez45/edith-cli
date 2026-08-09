import { commandVersion, runProcess } from './process.js';

export class ClaudeAdapter {
  id = 'claude';
  name = 'Claude Code';
  integrationType = 'print-json-cli';
  capabilities = ['non-interactive', 'json-output', 'stream-json-output', 'mcp-client', 'permissions'];

  async health() {
    const version = await commandVersion('claude');
    return {
      id: this.id,
      name: this.name,
      available: version.available,
      version: version.version,
      integrationType: this.integrationType,
      capabilities: this.capabilities,
      detail: version.available ? 'claude CLI available' : version.error
    };
  }

  async sendTask(prompt, { cwd = process.cwd(), timeoutMs = 180000 } = {}) {
    const result = await runProcess('claude', [
      '--print',
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--tools', '',
      '--no-session-persistence',
      prompt
    ], { cwd, timeoutMs });
    const parsed = parseClaudeJson(result.stdout);
    if (result.code !== 0) throw new Error(parsed.text || result.stderr || `claude exited ${result.code}`);
    return parsed;
  }
}

function parseClaudeJson(stdout) {
  try {
    const json = JSON.parse(stdout);
    return {
      text: json.result ?? json.message?.content?.map?.((item) => item.text ?? '').join('') ?? stdout.trim(),
      raw: json
    };
  } catch {
    return { text: stdout.trim(), raw: stdout };
  }
}
