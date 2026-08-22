import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../src/sessions/store.js';

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-sessions-'));
  return { store: new SessionStore({ file: path.join(dir, 'sessions.json') }), dir };
}

test('session store', async (t) => {
  await t.test('records, touches, and lists by recency', async () => {
    const { store, dir } = await tempStore();
    await store.record({ id: 'sess-a', workspace: '/w1', agentName: 'edith-local', model: 'm' });
    await store.record({ id: 'sess-b', workspace: '/w1', agentName: 'edith-local', model: 'm' });
    await store.touch('sess-a', { userMessage: 'fix the failing auth tests please' });
    const sessions = await store.list({ workspace: '/w1' });
    assert.equal(sessions[0].id, 'sess-a'); // touched most recently
    assert.equal(sessions[0].title, 'fix the failing auth tests please');
    assert.equal(sessions[0].turns, 1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await t.test('latest respects workspace association', async () => {
    const { store, dir } = await tempStore();
    await store.record({ id: 'w1-sess', workspace: '/w1', agentName: 'a', model: 'm' });
    await store.record({ id: 'w2-sess', workspace: '/w2', agentName: 'a', model: 'm' });
    assert.equal((await store.latest({ workspace: '/w1' })).id, 'w1-sess');
    assert.equal((await store.latest({ workspace: '/w2' })).id, 'w2-sess');
    assert.equal((await store.latest()).id, 'w2-sess');
    await fs.rm(dir, { recursive: true, force: true });
  });

  await t.test('supports id-prefix lookup, rename, archive, remove', async () => {
    const { store, dir } = await tempStore();
    await store.record({ id: '01m0abcdef', workspace: '/w', agentName: 'a', model: 'm' });
    assert.equal((await store.get('01m0ab')).id, '01m0abcdef');
    await store.rename('01m0ab', 'auth fix session');
    assert.equal((await store.get('01m0ab')).title, 'auth fix session');
    await store.archive('01m0ab');
    assert.equal((await store.list()).length, 0);
    assert.equal((await store.list({ includeArchived: true })).length, 1);
    await store.remove('01m0ab');
    assert.equal((await store.list({ includeArchived: true })).length, 0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await t.test('survives a corrupted index file', async () => {
    const { store, dir } = await tempStore();
    await fs.mkdir(path.dirname(store.file), { recursive: true });
    await fs.writeFile(store.file, '{corrupted');
    assert.deepEqual(await store.load(), []);
    await store.record({ id: 'fresh', workspace: '/w', agentName: 'a', model: 'm' });
    assert.equal((await store.list()).length, 1);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
