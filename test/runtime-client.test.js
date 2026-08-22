import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrueForgeClient, TrueForgeError } from '../src/runtime/client.js';

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const result = await handler(String(url), init);
    return result;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test('TrueForge client', async (t) => {
  await t.test('unwraps data envelopes on session create', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ data: { id: 'sess-1', status: 'active' } }));
    const client = new TrueForgeClient({ baseUrl: 'http://[::1]:8619', fetchImpl });
    const session = await client.createSession({ agentName: 'edith-local' });
    assert.equal(session.id, 'sess-1');
    assert.equal(fetchImpl.calls[0].url, 'http://[::1]:8619/api/v1/sessions');
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { agent: { name: 'edith-local' } });
  });

  await t.test('falls back to PUT when provider registration conflicts', async () => {
    const fetchImpl = fakeFetch((url, init) => {
      if (init.method === 'POST') return jsonResponse({ error: 'already exists' }, { status: 409 });
      return jsonResponse({ ok: true });
    });
    const client = new TrueForgeClient({ baseUrl: 'http://[::1]:8619', fetchImpl });
    await client.upsertModelProvider({ type: 'custom', name: 'ollama-local' });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1].init.method, 'PUT');
  });

  await t.test('raises typed errors with status codes', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'nope' }, { status: 500 }));
    const client = new TrueForgeClient({ baseUrl: 'http://[::1]:8619', fetchImpl });
    await assert.rejects(client.listModels(), (error) => {
      assert.ok(error instanceof TrueForgeError);
      assert.equal(error.status, 500);
      return true;
    });
  });

  await t.test('health returns false instead of throwing when unreachable', async () => {
    const fetchImpl = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
    const client = new TrueForgeClient({ baseUrl: 'http://[::1]:1', fetchImpl });
    assert.equal(await client.health(), false);
  });

  await t.test('parses SSE frames from turn subscription', async () => {
    const frames = [
      'data: {"type":"model.message.delta","delta":"Hel"}\n\n',
      'data: {"type":"model.message.delta","delta":"lo"}\n\ndata: {"type":"turn.done"}\n\n'
    ];
    const body = (async function* () {
      for (const frame of frames) yield Buffer.from(frame);
    })();
    const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, body }));
    const client = new TrueForgeClient({ baseUrl: 'http://[::1]:8619', fetchImpl });
    const events = [];
    await client.subscribeTurn('s1', 't1', { onEvent: (event) => events.push(event) });
    assert.equal(events.length, 3);
    assert.equal(events[0].delta, 'Hel');
    assert.equal(events[2].type, 'turn.done');
  });
});
