import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { AtomicInputComposer, normalizePastedText } from '../src/native/input-composer.js';

describe('native input composer', () => {
  it('submits a bracketed multiline paste as one atomic turn', async () => {
    const composer = testComposer();
    composer.start();
    composer.prompt('> ');
    const read = composer.read();
    composer.handleData(Buffer.from('\x1b[200~Check these things:\n\n- weather in Mesa\n- current Node.js release\n\n```js\nconsole.log(\'café\');\n```\x1b[201~'));

    const entry = await read;
    assert.equal(entry.type, 'line');
    assert.equal(entry.pasted, true);
    assert.equal(entry.text, "Check these things:\n\n- weather in Mesa\n- current Node.js release\n\n```js\nconsole.log('café');\n```");
  });

  it('waits for a split paste end marker and preserves Unicode and blank lines', async () => {
    const composer = testComposer();
    composer.start();
    const read = composer.read();
    composer.handleData(Buffer.from('\x1b[200~don’t\n\nré'));
    composer.handleData(Buffer.from('sumé\n—\n😄\x1b[201~'));

    const entry = await read;
    assert.equal(entry.text, 'don’t\n\nrésumé\n—\n😄');
  });

  it('handles a paste start marker split across input chunks', async () => {
    const composer = testComposer();
    composer.start();
    const read = composer.read();
    composer.handleData(Buffer.from('\x1b[2'));
    composer.handleData(Buffer.from('00~first\nsecond\x1b[201~'));

    assert.equal((await read).text, 'first\nsecond');
  });

  it('uses the existing backslash continuation for typed lines', async () => {
    const composer = testComposer();
    composer.start();
    const firstRead = composer.read();
    composer.handleData(Buffer.from('first\\\r'));
    const first = await firstRead;
    assert.equal(first.pasted, false);
    assert.equal(first.text, 'first\\');

    const secondRead = composer.read();
    composer.handleData(Buffer.from('second\r'));
    assert.equal((await secondRead).text, 'second');
  });

  it('does not interpret a pasted slash-looking block as commands', async () => {
    const composer = testComposer();
    composer.start();
    const read = composer.read();
    composer.handleData(Buffer.from('\x1b[200~/help\nThis is still user content.\x1b[201~'));

    const entry = await read;
    assert.equal(entry.text, '/help\nThis is still user content.');
  });

  it('cancels an unfinished input without returning partial text', async () => {
    const composer = testComposer();
    composer.start();
    const read = composer.read();
    composer.handleData(Buffer.from('half a request'));
    composer.handleData(Buffer.from([3]));

    assert.deepEqual(await read, { type: 'cancel', text: '' });
  });

  it('typing never emits a newline or vertical movement (per-char line-skip regression)', () => {
    const composer = testComposer();
    composer.start();
    composer.prompt('\n\x1b[32m> \x1b[0m');
    composer.read();
    const before = composer.output.text();
    composer.handleData(Buffer.from('what time is it'));
    const typed = composer.output.text().slice(before.length);
    assert.ok(!typed.includes('\n'), 'no newline while typing');
    assert.ok(!/\x1b\[\d*[AB]/.test(typed), 'no vertical cursor movement while typing');
    assert.equal(composer.line, 'what time is it');
  });

  it('stores only the last prompt line for redraws, emitting leading newlines once', () => {
    const composer = testComposer();
    composer.start();
    composer.prompt('\n> ');
    assert.equal(composer.promptText, '> ');
    composer.handleData(Buffer.from('abc'));
    assert.equal((composer.output.text().match(/\n/g) ?? []).length, 1);
  });

  it('Delete key removes forward instead of inserting a literal tilde', () => {
    const composer = testComposer();
    composer.start();
    composer.read();
    composer.handleData(Buffer.from('abc'));
    composer.handleData(Buffer.from('\x1b[D\x1b[D')); // left ×2 → cursor after "a"
    composer.handleData(Buffer.from('\x1b[3~'));      // delete forward → "ac"
    assert.equal(composer.line, 'ac');
    assert.equal(composer.cursor, 1);
  });

  it('Home and End position the cursor at the line boundaries', () => {
    const composer = testComposer();
    composer.start();
    composer.read();
    composer.handleData(Buffer.from('hello'));
    composer.handleData(Buffer.from('\x1b[H'));
    assert.equal(composer.cursor, 0);
    composer.handleData(Buffer.from('\x1b[F'));
    assert.equal(composer.cursor, 5);
    composer.handleData(Buffer.from('\x1b[1~'));
    assert.equal(composer.cursor, 0);
    composer.handleData(Buffer.from('\x1b[4~'));
    assert.equal(composer.cursor, 5);
  });

  it('backspace removes a whole emoji grapheme, not half a surrogate pair', () => {
    const composer = testComposer();
    composer.start();
    composer.read();
    composer.handleData(Buffer.from('hi 👍'));
    composer.handleData(Buffer.from('\x7f'));
    assert.equal(composer.line, 'hi ');
    composer.handleData(Buffer.from('\x7f'));
    assert.equal(composer.line, 'hi');
  });

  it('a single-line bracketed paste inserts at the cursor instead of submitting', async () => {
    const composer = testComposer();
    composer.start();
    const read = composer.read();
    composer.handleData(Buffer.from('see '));
    composer.handleData(Buffer.from('\x1b[200~https://example.com\x1b[201~'));
    assert.equal(composer.line, 'see https://example.com');
    composer.handleData(Buffer.from('\r'));
    assert.equal((await read).text, 'see https://example.com');
  });

  it('submitting leaves the entry in the transcript as a single prompt line', async () => {
    const composer = testComposer();
    composer.start();
    composer.prompt('> ');
    const read = composer.read();
    composer.handleData(Buffer.from('hello\r'));
    await read;
    assert.ok(composer.output.text().includes('> hello\n'));
  });

  it('Up arrow recalls the most recent entry, Down returns to empty', async () => {
    const composer = testComposer();
    composer.start();
    const first = composer.read();
    composer.handleData(Buffer.from('older entry\r'));
    await first;
    const second = composer.read();
    composer.handleData(Buffer.from('newest entry\r'));
    await second;
    composer.read();
    composer.handleData(Buffer.from('\x1b[A'));
    assert.equal(composer.line, 'newest entry');
    composer.handleData(Buffer.from('\x1b[A'));
    assert.equal(composer.line, 'older entry');
    composer.handleData(Buffer.from('\x1b[B'));
    assert.equal(composer.line, 'newest entry');
    composer.handleData(Buffer.from('\x1b[B'));
    assert.equal(composer.line, '');
  });

  it('accepts a bounded large paste without loss or duplication', async () => {
    const composer = testComposer();
    composer.start();
    const lines = Array.from({ length: 500 }, (_, index) => `line ${index + 1}`);
    const read = composer.read();
    composer.handleData(Buffer.from(`\x1b[200~${lines.join('\n')}\x1b[201~`));

    const entry = await read;
    assert.equal(entry.text.split('\n').length, 500);
    assert.equal(entry.text, lines.join('\n'));
    assert.equal(normalizePastedText(entry.text), entry.text);
  });
});

function testComposer() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.resume = () => {};
  let outputText = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputText += chunk.toString();
      callback();
    }
  });
  output.isTTY = true;
  output.columns = 100;
  output.text = () => outputText;
  return new AtomicInputComposer({ input, output });
}
