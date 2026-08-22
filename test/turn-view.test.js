import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnView, toolActivityLabel, summarizeToolResult, friendlyError } from '../src/app/turn-view.js';
import { parseFlags } from '../src/app/edith-app.js';

function fakeUi() {
  const lines = [];
  return {
    lines,
    line: (text = '') => lines.push(String(text)),
    stdout: { write: (text) => lines.push(String(text)) },
    isTTY: false
  };
}

test('turn view rendering', async (t) => {
  await t.test('tool labels read like actions, not plumbing', () => {
    assert.equal(toolActivityLabel('read_file', { path: 'src/auth.js' }), 'Read src/auth.js');
    assert.equal(toolActivityLabel('search_code', { query: 'refreshToken' }), 'Search "refreshToken"');
    assert.equal(toolActivityLabel('run_tests', {}), 'Running tests');
    assert.equal(toolActivityLabel('edit_file', { path: 'a.js' }), 'Edit a.js');
    assert.equal(toolActivityLabel('delegate_specialist', { agent: 'codex' }), 'Delegate to codex');
  });

  await t.test('search results summarize to a count', () => {
    const summary = summarizeToolResult('search_code', 'a.js:1:x\nb.js:2:y\n');
    assert.deepEqual(summary.lines, ['Found 2 matches']);
    assert.deepEqual(summarizeToolResult('search_code', '(no matches)').lines, ['No matches']);
  });

  await t.test('command output renders as a compact block with clamping', () => {
    const long = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
    const summary = summarizeToolResult('run_tests', `$ npm test\nexit code: 0\nstdout:\n${long}`);
    assert.equal(summary.kind, 'block');
    assert.ok(summary.lines.length < 16, 'must clamp long output');
    assert.ok(summary.lines[0].startsWith('$ npm test'));
  });

  await t.test('thinking shows once, tool activity resets it', () => {
    const ui = fakeUi();
    const view = new TurnView({ ui });
    view.handle({ type: 'reasoning-delta', text: 'a' });
    view.handle({ type: 'reasoning-delta', text: 'b' });
    assert.equal(ui.lines.filter((line) => line.includes('Thinking')).length, 1);
    view.handle({ type: 'tool-call', toolCallId: '1', tool: 'git_status', args: {} });
    view.handle({ type: 'reasoning-delta', text: 'c' });
    assert.equal(ui.lines.filter((line) => line.includes('Thinking')).length, 2);
  });

  await t.test('unstreamed answers are printed at finish', () => {
    const ui = fakeUi();
    const view = new TurnView({ ui });
    view.finish({ state: 'COMPLETED', text: 'The answer is 4.' });
    assert.ok(ui.lines.some((line) => line.includes('The answer is 4.')));
  });

  await t.test('cancellation renders as preserved-session notice', () => {
    const ui = fakeUi();
    new TurnView({ ui }).finish({ state: 'CANCELLED', text: '' });
    assert.ok(ui.lines.some((line) => line.includes('session preserved')));
  });

  await t.test('errors map to friendly remediation', () => {
    assert.match(friendlyError(new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:11434')), /Ollama/);
    assert.match(friendlyError(new Error("Failed to connect to remote MCP server 'edith-capabilities'")), /Restart EDITH/);
  });
});

test('CLI flag parsing', () => {
  assert.deepEqual(parseFlags(['--continue']).continue, true);
  assert.equal(parseFlags(['--resume']).resume, true);
  assert.equal(parseFlags(['--resume', 'abc123']).resume, 'abc123');
  assert.equal(parseFlags(['--model', 'local-fast']).model, 'local-fast');
  assert.equal(parseFlags(['--strict']).strict, true);
});
