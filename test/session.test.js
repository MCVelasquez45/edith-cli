import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SessionStore } from '../src/runtime/session.js';

describe('session store', () => {
  it('redacts common secret strings before saving', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-sessions-'));
    const store = new SessionStore(root);
    const session = await store.create('/tmp/workspace');
    session.conversation.push({ role: 'user', content: 'token ghp_abc123', at: new Date().toISOString() });

    await store.save(session);
    const saved = await fs.readFile(path.join(root, `${session.id}.json`), 'utf8');

    assert.match(saved, /<REDACTED>/);
    assert.doesNotMatch(saved, /ghp_abc123/);
  });
});
