// EDITH's durable session index. TrueForge owns the conversation data
// (turns, events, compaction) in its SQLite store; EDITH keeps the product
// metadata — titles, workspace association, recency — so `edith --resume`,
// `edith --continue`, and `edith sessions` work across restarts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { sessionIndexFile } from '../runtime/paths.js';

export class SessionStore {
  constructor({ file = sessionIndexFile() } = {}) {
    this.file = file;
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch {
      return [];
    }
  }

  async save(sessions) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`);
  }

  async record({ id, workspace, agentName, model, title = null }) {
    const sessions = await this.load();
    const now = new Date().toISOString();
    const existing = sessions.find((session) => session.id === id);
    if (existing) {
      Object.assign(existing, { workspace, agentName, model, updatedAt: now });
    } else {
      sessions.push({ id, workspace, agentName, model, title, createdAt: now, updatedAt: now, turns: 0, archived: false });
    }
    await this.save(sessions);
    return sessions.find((session) => session.id === id);
  }

  // Called after each turn so recency and auto-titles stay fresh.
  async touch(id, { userMessage = null } = {}) {
    const sessions = await this.load();
    const session = sessions.find((item) => item.id === id);
    if (!session) return null;
    session.updatedAt = new Date().toISOString();
    session.turns = (session.turns ?? 0) + 1;
    if (userMessage && !session.title) {
      session.title = String(userMessage).replace(/\s+/g, ' ').trim().slice(0, 64);
    }
    await this.save(sessions);
    return session;
  }

  async list({ workspace = null, includeArchived = false } = {}) {
    const sessions = await this.load();
    return sessions
      .map((session, index) => ({ session, index }))
      .filter(({ session }) => !session.archived || includeArchived)
      .filter(({ session }) => !workspace || session.workspace === workspace)
      // Recency, with insertion order breaking same-millisecond ties.
      .sort((a, b) => (b.session.updatedAt ?? '').localeCompare(a.session.updatedAt ?? '') || b.index - a.index)
      .map(({ session }) => session);
  }

  async latest({ workspace = null } = {}) {
    const sessions = await this.list({ workspace });
    return sessions[0] ?? null;
  }

  async get(id) {
    const sessions = await this.load();
    return sessions.find((session) => session.id === id || session.id.startsWith(id)) ?? null;
  }

  async rename(id, title) {
    const sessions = await this.load();
    const session = sessions.find((item) => item.id === id || item.id.startsWith(id));
    if (!session) throw new Error(`Session not found: ${id}`);
    session.title = title;
    session.updatedAt = new Date().toISOString();
    await this.save(sessions);
    return session;
  }

  async archive(id) {
    const sessions = await this.load();
    const session = sessions.find((item) => item.id === id || item.id.startsWith(id));
    if (!session) throw new Error(`Session not found: ${id}`);
    session.archived = true;
    await this.save(sessions);
    return session;
  }

  async remove(id) {
    const sessions = await this.load();
    const remaining = sessions.filter((item) => item.id !== id && !item.id.startsWith(id));
    if (remaining.length === sessions.length) throw new Error(`Session not found: ${id}`);
    await this.save(remaining);
  }
}
