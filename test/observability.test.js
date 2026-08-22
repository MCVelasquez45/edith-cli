import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Telemetry } from '../src/observability.js';

test('observability', async (t) => {
  await t.test('records structured turn metrics as JSONL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-telemetry-'));
    const telemetry = new Telemetry({ file: path.join(dir, 'edith.jsonl') });
    const recorder = telemetry.turnRecorder({ sessionId: 's1', workspace: '/w', model: 'ollama-local/qwen3-8b', agent: 'edith-local' });
    recorder.onEvent({ type: 'tool-call' });
    recorder.onEvent({ type: 'tool-call' });
    recorder.onEvent({ type: 'approval-required' });
    await recorder.finish({ state: 'COMPLETED' });
    const lines = (await fs.readFile(path.join(dir, 'edith.jsonl'), 'utf8')).trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.kind, 'turn');
    assert.equal(entry.toolCalls, 2);
    assert.equal(entry.approvals, 1);
    assert.equal(entry.state, 'COMPLETED');
    assert.ok(entry.durationMs >= 0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await t.test('redacts secrets and never throws on write failure', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-telemetry-'));
    const telemetry = new Telemetry({ file: path.join(dir, 'edith.jsonl') });
    await telemetry.record('turn', { error: 'request failed: api_key=sk-supersecret123 rejected' });
    const body = await fs.readFile(path.join(dir, 'edith.jsonl'), 'utf8');
    assert.ok(!body.includes('supersecret123'), 'secret must be redacted');
    // Unwritable location must not throw.
    const broken = new Telemetry({ file: '/nonexistent-root-dir/edith.jsonl' });
    await broken.record('turn', {});
    await fs.rm(dir, { recursive: true, force: true });
  });
});
