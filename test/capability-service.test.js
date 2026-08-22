import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CapabilityService } from '../src/capability/server.js';

// Speaks the same streamable-http JSON-RPC dialect TrueForge's MCP client uses.
async function rpc(url, method, params, id = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (!res.ok) throw new Error(`${method} -> ${res.status}: ${body.slice(0, 300)}`);
  if (contentType.includes('text/event-stream')) {
    const events = body.split('\n\n').filter((frame) => frame.includes('data:'));
    const last = events[events.length - 1];
    const data = last.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
    return JSON.parse(data);
  }
  return JSON.parse(body);
}

test('capability service over loopback streamable-http', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-capsvc-'));
  await fs.writeFile(path.join(workspace, 'hello.txt'), 'capability bus works\n');
  const service = new CapabilityService({ workspace });
  const url = await service.start();
  t.after(async () => {
    await service.stop();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  await t.test('binds to loopback only', () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  await t.test('answers MCP initialize', async () => {
    const result = await rpc(url, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'edith-test', version: '0' }
    });
    assert.equal(result.result.serverInfo.name, 'edith-capabilities');
  });

  await t.test('lists tools with safety annotations', async () => {
    const result = await rpc(url, 'tools/list', {}, 2);
    const tools = result.result.tools;
    const readFile = tools.find((tool) => tool.name === 'read_file');
    const deleteFile = tools.find((tool) => tool.name === 'delete_file');
    assert.ok(readFile.annotations.readOnlyHint);
    assert.ok(!readFile.annotations.destructiveHint);
    assert.ok(deleteFile.annotations.destructiveHint);
    assert.ok(tools.length >= 15, `expected full toolset, got ${tools.length}`);
  });

  await t.test('executes a tool call end-to-end', async () => {
    const result = await rpc(url, 'tools/call', { name: 'read_file', arguments: { path: 'hello.txt' } }, 3);
    assert.match(result.result.content[0].text, /capability bus works/);
  });

  await t.test('returns tool errors as results, not protocol failures', async () => {
    const result = await rpc(url, 'tools/call', { name: 'read_file', arguments: { path: '../etc/passwd' } }, 4);
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, /escapes workspace/);
  });
});
