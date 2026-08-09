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
