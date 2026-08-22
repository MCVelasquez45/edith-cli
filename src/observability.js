// Structured internal observability. One JSONL record per completed turn
// (and per lifecycle event) under ~/.edith/logs/edith.jsonl — model, timing,
// tool counts, outcome. Secrets are redacted before write; the normal CLI
// stays clean and this file powers diagnostics.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logsDir } from './runtime/paths.js';
import { redactSecrets } from './security/redact.js';

export class Telemetry {
  constructor({ file = path.join(logsDir(), 'edith.jsonl') } = {}) {
    this.file = file;
  }

  async record(kind, fields = {}) {
    try {
      const entry = { ts: new Date().toISOString(), kind, ...fields };
      const line = redactSecrets(JSON.stringify(entry));
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${line}\n`);
    } catch {
      // Observability must never break the product.
    }
  }

  turnRecorder({ sessionId, workspace, model, agent }) {
    const startedAt = Date.now();
    let toolCalls = 0;
    let approvals = 0;
    return {
      onEvent: (event) => {
        if (event.type === 'tool-call') toolCalls += 1;
        if (event.type === 'approval-required') approvals += 1;
      },
      finish: (result) => this.record('turn', {
        sessionId,
        workspace,
        model,
        agent,
        state: result.state,
        durationMs: Date.now() - startedAt,
        toolCalls,
        approvals,
        error: result.error ? String(result.error).slice(0, 300) : undefined
      })
    };
  }
}
