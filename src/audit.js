import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { redactDeep } from './security/redact.js';

const DEFAULT_AUDIT_DIR = process.env.EDITH_AUDIT_DIR ?? path.join(os.homedir(), '.edith', 'audit');

export class AuditLog {
  constructor(root = DEFAULT_AUDIT_DIR) {
    this.root = root;
  }

  async record(event) {
    await fs.mkdir(this.root, { recursive: true });
    const safe = redact({
      timestamp: new Date().toISOString(),
      ...event
    });
    const file = path.join(this.root, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await fs.appendFile(file, `${JSON.stringify(safe)}\n`);
  }
}

export function redact(value) {
  return redactDeep(value, { marker: '<REDACTED>' });
}
