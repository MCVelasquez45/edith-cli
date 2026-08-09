import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export class SessionStore {
  constructor(root = path.join(os.homedir(), '.edith', 'sessions')) {
    this.root = root;
  }

  async create(workspace) {
    const session = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspace,
      providerId: null,
      modelId: null,
      conversation: [],
      files: {},
      changedFiles: []
    };
    await this.save(session);
    return session;
  }

  async loadLatest(workspace) {
    await fs.mkdir(this.root, { recursive: true });
    const files = await fs.readdir(this.root).catch(() => []);
    const sessions = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(await fs.readFile(path.join(this.root, file), 'utf8'));
      if (data.workspace === workspace) sessions.push(data);
    }
    sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return sessions[0] ?? this.create(workspace);
  }

  async save(session) {
    session.updatedAt = new Date().toISOString();
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(path.join(this.root, `${session.id}.json`), JSON.stringify(redactSession(session), null, 2));
    await fs.writeFile(path.join(this.root, `latest-${hash(session.workspace)}.txt`), session.id);
  }
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function redactSession(session) {
  return JSON.parse(JSON.stringify(session, (_key, value) => {
    if (typeof value === 'string' && /(github_pat_|sk-|ghp_|gho_|Bearer\s+)/i.test(value)) return '<REDACTED>';
    return value;
  }));
}
