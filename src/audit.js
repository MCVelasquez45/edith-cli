import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

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
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    return item
      .replace(/github_pat_[A-Za-z0-9_]+/g, '<REDACTED>')
      .replace(/gh[opsu]_[A-Za-z0-9_]+/g, '<REDACTED>')
      .replace(/1\/\/[A-Za-z0-9._~+/=-]+/g, '<REDACTED>')
      .replace(/ya29\.[A-Za-z0-9._~+/=-]+/g, '<REDACTED>')
      .replace(/sk-[A-Za-z0-9_-]+/g, '<REDACTED>')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <REDACTED>');
  }));
}
