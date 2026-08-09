import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline/promises';

const PASTE_START = Buffer.from('\x1b[200~');
const PASTE_END = Buffer.from('\x1b[201~');
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

export class AtomicInputComposer extends EventEmitter {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    super();
    this.input = input;
    this.output = output;
    this.tty = Boolean(input.isTTY && output.isTTY && typeof input.setRawMode === 'function');
    this.readline = null;
    this.started = false;
    this.paused = false;
    this.eof = false;
    this.pending = Buffer.alloc(0);
    this.inPaste = false;
    this.line = '';
    this.cursor = 0;
    this.history = [];
    this.historyIndex = -1;
    this.readResolver = null;
    this.promptText = '';
    this.decoder = new TextDecoder('utf-8');
    this.onData = (chunk) => this.handleData(chunk);
    this.onEnd = () => {
      this.eof = true;
      this.resolve({ type: 'eof', text: '' });
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (this.tty) {
      this.input.setRawMode(true);
      this.input.resume();
      this.input.on('data', this.onData);
      this.input.once('end', this.onEnd);
      this.output.write(ENABLE_BRACKETED_PASTE);
    } else {
      this.readline = createInterface({ input: this.input, crlfDelay: Infinity, terminal: false });
      this.readline.on('close', this.onEnd);
    }
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.tty) {
      this.input.off('data', this.onData);
      this.input.off('end', this.onEnd);
      this.input.setRawMode(false);
      this.output.write(DISABLE_BRACKETED_PASTE);
    } else {
      this.readline?.close();
      this.readline = null;
    }
    this.resolve({ type: 'eof', text: '' });
  }

  prompt(text) {
    this.promptText = text;
    if (!this.tty) {
      this.output.write(text);
      return;
    }
    this.output.write(text);
  }

  setPaused(value) {
    this.paused = value;
    if (!value) this.redraw();
  }

  async read() {
    if (!this.started) this.start();
    if (this.eof) return { type: 'eof', text: '' };
    if (!this.tty) {
      try {
        return { type: 'line', text: await this.readline.question('') };
      } catch {
        return { type: 'eof', text: '' };
      }
    }
    return new Promise((resolve) => {
      this.readResolver = resolve;
    });
  }

  cancelInput() {
    this.line = '';
    this.cursor = 0;
    this.historyIndex = -1;
    this.resolve({ type: 'cancel', text: '' });
    this.redraw(true);
  }

  handleData(chunk) {
    const bytes = Buffer.from(chunk);
    if (bytes.includes(3)) {
      this.emit('cancel');
      if (!this.paused) this.cancelInput();
      return;
    }
    if (this.paused) return;
    this.pending = Buffer.concat([this.pending, bytes]);
    this.consumePending();
  }

  consumePending() {
    while (this.pending.length) {
      if (this.inPaste) {
        const end = this.pending.indexOf(PASTE_END);
        if (end < 0) return;
        const pasted = normalizePastedText(this.pending.subarray(0, end).toString('utf8'));
        this.pending = this.pending.subarray(end + PASTE_END.length);
        this.inPaste = false;
        this.submit(`${this.line}${pasted}`, { pasted: true });
        continue;
      }

      const start = this.pending.indexOf(PASTE_START);
      if (start >= 0) {
        this.processNormal(this.pending.subarray(0, start));
        this.pending = this.pending.subarray(start + PASTE_START.length);
        this.inPaste = true;
        continue;
      }

      const partialStart = trailingPrefixLength(this.pending, PASTE_START);
      if (partialStart > 0) {
        const processable = this.pending.length - partialStart;
        if (processable) this.processNormal(this.pending.subarray(0, processable));
        this.pending = this.pending.subarray(processable);
        return;
      }

      const newlineCount = countNewlines(this.pending);
      if (newlineCount > 1 || (newlineCount === 1 && this.pending[this.pending.length - 1] !== 10 && this.pending[this.pending.length - 1] !== 13)) {
        const pasted = normalizePastedText(this.pending.toString('utf8'));
        this.pending = Buffer.alloc(0);
        this.submit(`${this.line}${pasted}`, { pasted: true });
        continue;
      }

      const bytes = this.pending;
      this.pending = Buffer.alloc(0);
      this.processNormal(this.decoder.decode(bytes, { stream: true }));
    }
  }

  processNormal(text) {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '\u001b' && text[index + 1] === '[') {
        const key = text.slice(index, index + 3);
        if (key === '\u001b[D') this.moveCursor(-1);
        else if (key === '\u001b[C') this.moveCursor(1);
        else if (key === '\u001b[A') this.restoreHistory(-1);
        else if (key === '\u001b[B') this.restoreHistory(1);
        index += 2;
        continue;
      }
      if (char === '\r' || char === '\n') {
        this.submit(this.line);
      } else if (char === '\u007f' || char === '\b') {
        if (this.cursor > 0) {
          this.line = `${this.line.slice(0, this.cursor - 1)}${this.line.slice(this.cursor)}`;
          this.cursor -= 1;
          this.redraw();
        }
      } else if (char >= ' ' || char === '\t') {
        this.line = `${this.line.slice(0, this.cursor)}${char}${this.line.slice(this.cursor)}`;
        this.cursor += char.length;
        this.redraw();
      }
    }
  }

  moveCursor(delta) {
    this.cursor = Math.max(0, Math.min(this.line.length, this.cursor + delta));
    this.redraw();
  }

  restoreHistory(delta) {
    if (!this.history.length) return;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + delta));
    this.line = this.historyIndex < 0 ? '' : this.history[this.history.length - 1 - this.historyIndex];
    this.cursor = this.line.length;
    this.redraw(true);
  }

  submit(text, { pasted = false } = {}) {
    if (this.readResolver) {
      if (text.length) this.history.unshift(text);
      this.line = '';
      this.cursor = 0;
      this.historyIndex = -1;
      this.redraw(true);
      this.resolve({ type: 'line', text, pasted });
    }
  }

  resolve(value) {
    const resolver = this.readResolver;
    this.readResolver = null;
    resolver?.(value);
  }

  redraw(clear = false) {
    if (!this.tty || this.paused) return;
    if (clear) this.output.write('\r\x1b[2K');
    else {
      const tail = this.line.length - this.cursor;
      this.output.write(`\r\x1b[2K${this.promptText}${this.line}${tail ? `\x1b[${tail}D` : ''}`);
    }
  }
}

export function normalizePastedText(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function countNewlines(buffer) {
  let count = 0;
  for (const byte of buffer) if (byte === 10 || byte === 13) count += 1;
  return count;
}

function trailingPrefixLength(buffer, pattern) {
  const max = Math.min(buffer.length, pattern.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (buffer.subarray(buffer.length - length).equals(pattern.subarray(0, length))) return length;
  }
  return 0;
}
