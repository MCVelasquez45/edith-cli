import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { NativeTurnRenderer, createTurnEvents, friendlyActivity } from '../src/native/progress-renderer.js';
import { sanitizeText, TerminalUI } from '../src/ui/terminal.js';

describe('native progress renderer', () => {
  it('renders semantic tool status before one streamed response header', () => {
    const ui = testUi({ isTTY: false });
    const renderer = new NativeTurnRenderer({ ui });
    const events = createTurnEvents(renderer);

    events.activity('Checking weather for Mesa, Arizona');
    events.streamStart('EDITH');
    events.streamChunk('Weather is current.');
    events.streamEnd();

    const out = ui.output();
    assert.match(out, /Checking weather/);
    assert.match(out, /Weather updated/);
    assert.equal((out.match(/EDITH:/g) ?? []).length, 1);
    assert.match(out, /Weather is current/);
  });

  it('keeps non-TTY output free of spinner control sequences and ANSI', () => {
    const oldNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const ui = testUi({ isTTY: false });
      const renderer = new NativeTurnRenderer({ ui });
      renderer.emit({ type: 'tool:start', message: 'Searching the web' });
      renderer.emit({ type: 'tool:success', message: 'Search complete' });
      const out = ui.output();
      assert.doesNotMatch(out, /\x1b\[/);
      assert.doesNotMatch(out, /\r/);
      assert.match(out, /Searching the web/);
      assert.match(out, /Search complete/);
    } finally {
      if (oldNoColor == null) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = oldNoColor;
    }
  });

  it('supports cancellation and suppresses later events', () => {
    const ui = testUi({ isTTY: false });
    const renderer = new NativeTurnRenderer({ ui });
    const events = createTurnEvents(renderer);

    events.activity('Searching the web');
    renderer.cancel();
    events.streamStart('EDITH');
    events.streamChunk('late output');
    events.streamEnd();

    const out = ui.output();
    assert.match(out, /Operation cancelled/);
    assert.doesNotMatch(out, /late output/);
  });

  it('preserves UTF-8 status and response text', () => {
    const ui = testUi({ isTTY: false });
    const renderer = new NativeTurnRenderer({ ui });
    renderer.emit({ type: 'tool:start', message: 'Checking café résumé — don’t break 😄' });
    renderer.emit({ type: 'response:start', label: 'EDITH' });
    renderer.emit({ type: 'response:delta', text: 'café résumé — don’t 😄' });
    renderer.emit({ type: 'response:end' });

    const out = ui.output();
    assert.match(out, /café résumé — don’t break 😄/);
    assert.match(out, /café résumé — don’t 😄/);
    assert.doesNotMatch(out, /�/);
  });

  it('repairs common replacement-character contractions in streamed model output', () => {
    assert.equal(sanitizeText('Why don�t skeletons fight? I�m not sure.'), 'Why don’t skeletons fight? I’m not sure.');
  });

  it('truncates active TTY status to terminal width', () => {
    const ui = testUi({ isTTY: true, columns: 24 });
    const renderer = new NativeTurnRenderer({ ui, spinnerDelayMs: 0, spinnerIntervalMs: 10000 });
    renderer.emit({ type: 'tool:start', message: 'Searching the web for a very long status message that should fit' });
    renderer.emit({ type: 'tool:success' });

    const longest = ui.output().split(/\r|\n/).reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
    assert.ok(longest <= 80);
  });

  it('maps internal activity strings to human-readable labels', () => {
    assert.equal(friendlyActivity('Fetching https://example.com/page'), 'Reading sources');
    assert.equal(friendlyActivity('Checking Google Tasks'), 'Checking tasks');
    assert.equal(friendlyActivity('Running OpenCode coding agent'), 'Asking OpenCode');
  });
});

function testUi({ isTTY = false, columns = 80 } = {}) {
  let buffer = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString('utf8');
      callback();
    }
  });
  stdout.isTTY = isTTY;
  stdout.columns = columns;
  const ui = new TerminalUI({ stdout });
  ui.isTTY = isTTY;
  ui.stdout.columns = columns;
  ui.output = () => buffer;
  return ui;
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
