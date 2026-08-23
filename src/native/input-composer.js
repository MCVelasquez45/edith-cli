import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const stringWidth = require('string-width');

const PASTE_START = Buffer.from('\x1b[200~');
const PASTE_END = Buffer.from('\x1b[201~');
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
    this.cursor = 0; // code-unit index, always on a grapheme boundary
    this.history = [];
    this.historyIndex = -1;
    this.readResolver = null;
    this.promptText = '';
    this.placeholder = '';
    this.decoder = new TextDecoder('utf-8');
    // Rows below the first render row that the cursor currently sits on;
    // redraw() climbs back up from here before repainting the region.
    this.cursorRowOffset = 0;
    this.onData = (chunk) => this.handleData(chunk);
    this.onResize = () => {
      if (!this.paused && this.readResolver) this.redraw();
    };
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
      this.output.on?.('resize', this.onResize);
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
      this.output.off?.('resize', this.onResize);
      this.input.setRawMode(false);
      this.input.pause();
      this.output.write(DISABLE_BRACKETED_PASTE);
    } else {
      this.readline?.close();
      this.readline = null;
    }
    this.resolve({ type: 'eof', text: '' });
  }

  // The prompt is re-written on every keystroke, so the stored prompt must be
  // a single line. Anything up to the last newline is emitted once, here.
  prompt(text, { placeholder = '' } = {}) {
    const split = text.lastIndexOf('\n');
    if (split >= 0) {
      this.output.write(text.slice(0, split + 1));
      this.promptText = text.slice(split + 1);
    } else {
      this.promptText = text;
    }
    this.placeholder = placeholder;
    if (!this.tty) {
      this.output.write(this.promptText);
      return;
    }
    this.cursorRowOffset = 0;
    this.redraw();
  }

  // Unpausing does not repaint: the next prompt() decides what the screen
  // shows. Repainting here would ghost the previous prompt above the new one.
  setPaused(value) {
    this.paused = value;
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
    this.clearRegion();
    this.resolve({ type: 'cancel', text: '' });
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
        if (pasted.includes('\n')) {
          // Multiline paste stays one atomic submission — never split into turns.
          this.submit(`${this.line}${pasted}`, { pasted: true });
        } else {
          this.insertText(pasted);
        }
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
    text = typeof text === 'string' ? text : this.decoder.decode(text, { stream: true });
    let index = 0;
    let insertBuf = '';
    const flushInsert = () => {
      if (insertBuf) {
        this.insertText(insertBuf);
        insertBuf = '';
      }
    };
    while (index < text.length) {
      const char = text[index];
      if (char === '\u001b') {
        flushInsert();
        index += this.handleEscape(text.slice(index));
        continue;
      }
      index += 1;
      if (char === '\r' || char === '\n') {
        flushInsert();
        this.submit(this.line);
      } else if (char === '\u007f' || char === '\b') {
        flushInsert();
        this.deleteBackward();
      } else if (char === '\u0001') { // Ctrl+A
        flushInsert();
        this.setCursor(0);
      } else if (char === '\u0005') { // Ctrl+E
        flushInsert();
        this.setCursor(this.line.length);
      } else if (char === '\u0015') { // Ctrl+U — kill to start of line
        flushInsert();
        this.line = this.line.slice(this.cursor);
        this.cursor = 0;
        this.redraw();
      } else if (char === '\u000b') { // Ctrl+K — kill to end of line
        flushInsert();
        this.line = this.line.slice(0, this.cursor);
        this.redraw();
      } else if (char === '\u0017') { // Ctrl+W — delete previous word
        flushInsert();
        this.deleteWordBackward();
      } else if (char === '\t') {
        insertBuf += '  ';
      } else if (char >= ' ' || char.charCodeAt(0) > 0x7f) {
        insertBuf += char;
      }
    }
    flushInsert();
  }

  // Parses one escape sequence at the start of `text`; returns consumed length.
  handleEscape(text) {
    if (text[1] === '[') {
      let end = 2;
      while (end < text.length && !isCsiFinal(text[end])) end += 1;
      if (end >= text.length) return text.length; // truncated sequence — drop
      const params = text.slice(2, end);
      const final = text[end];
      if (final === 'D') this.moveCursor(-1);
      else if (final === 'C') this.moveCursor(1);
      else if (final === 'A') this.restoreHistory(1);
      else if (final === 'B') this.restoreHistory(-1);
      else if (final === 'H') this.setCursor(0);
      else if (final === 'F') this.setCursor(this.line.length);
      else if (final === '~') {
        const code = params.split(';')[0];
        if (code === '1' || code === '7') this.setCursor(0);
        else if (code === '4' || code === '8') this.setCursor(this.line.length);
        else if (code === '3') this.deleteForward();
      }
      return end + 1;
    }
    if (text[1] === 'O' && text.length >= 3) {
      const final = text[2];
      if (final === 'D') this.moveCursor(-1);
      else if (final === 'C') this.moveCursor(1);
      else if (final === 'A') this.restoreHistory(1);
      else if (final === 'B') this.restoreHistory(-1);
      else if (final === 'H') this.setCursor(0);
      else if (final === 'F') this.setCursor(this.line.length);
      return 3;
    }
    return text.length >= 2 ? 2 : 1; // lone ESC / Alt+key — ignore
  }

  insertText(text) {
    if (!text) return;
    this.line = `${this.line.slice(0, this.cursor)}${text}${this.line.slice(this.cursor)}`;
    this.cursor += text.length;
    this.redraw();
  }

  deleteBackward() {
    if (this.cursor === 0) return;
    const start = prevBoundary(this.line, this.cursor);
    this.line = `${this.line.slice(0, start)}${this.line.slice(this.cursor)}`;
    this.cursor = start;
    this.redraw();
  }

  deleteForward() {
    if (this.cursor >= this.line.length) return;
    const end = nextBoundary(this.line, this.cursor);
    this.line = `${this.line.slice(0, this.cursor)}${this.line.slice(end)}`;
    this.redraw();
  }

  deleteWordBackward() {
    if (this.cursor === 0) return;
    let start = this.cursor;
    while (start > 0 && /\s/.test(this.line[start - 1])) start -= 1;
    while (start > 0 && !/\s/.test(this.line[start - 1])) start -= 1;
    this.line = `${this.line.slice(0, start)}${this.line.slice(this.cursor)}`;
    this.cursor = start;
    this.redraw();
  }

  moveCursor(delta) {
    const next = delta < 0 ? prevBoundary(this.line, this.cursor) : nextBoundary(this.line, this.cursor);
    this.setCursor(next);
  }

  setCursor(index) {
    this.cursor = Math.max(0, Math.min(this.line.length, index));
    this.redraw();
  }

  restoreHistory(delta) {
    if (!this.history.length) return;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + delta));
    this.line = this.historyIndex < 0 ? '' : this.history[this.historyIndex];
    this.cursor = this.line.length;
    this.redraw();
  }

  submit(text, { pasted = false } = {}) {
    if (this.readResolver) {
      if (text.length) this.history.unshift(text);
      this.finalizeRegion(text);
      this.line = '';
      this.cursor = 0;
      this.historyIndex = -1;
      this.resolve({ type: 'line', text, pasted });
    }
  }

  resolve(value) {
    const resolver = this.readResolver;
    this.readResolver = null;
    resolver?.(value);
  }

  columns() {
    return Math.max(20, this.output.columns ?? 80);
  }

  // Climb to the first row of the input region and clear everything below.
  clearRegion() {
    if (!this.tty) return;
    if (this.cursorRowOffset > 0) this.output.write(`\x1b[${this.cursorRowOffset}A`);
    this.output.write('\r\x1b[J');
    this.cursorRowOffset = 0;
  }

  // Leave the submitted entry in the transcript as a single `> …` line.
  finalizeRegion(text) {
    if (!this.tty || this.paused) return;
    this.clearRegion();
    const lines = String(text).split('\n');
    const preview = lines.length > 1
      ? `${lines.find((l) => l.trim()) ?? ''}\u001b[2m … (+${lines.length - 1} lines)\u001b[0m`
      : text;
    this.output.write(`${this.promptText}${preview}\n`);
  }

  redraw() {
    if (!this.tty || this.paused) return;
    const cols = this.columns();
    this.clearRegion();

    const promptWidth = stringWidth(this.promptText);
    const showPlaceholder = !this.line && this.placeholder;
    const body = showPlaceholder ? `\u001b[2m${this.placeholder}\u001b[0m` : this.line;
    this.output.write(`${this.promptText}${body}`);

    const endPos = promptWidth + stringWidth(showPlaceholder ? this.placeholder : this.line);
    const cursorPos = promptWidth + (showPlaceholder ? 0 : stringWidth(this.line.slice(0, this.cursor)));
    // Physical row the terminal cursor rests on after the write. With deferred
    // wrap, a width that lands exactly on a column boundary keeps the cursor on
    // the previous row.
    const endRow = endPos > 0 ? Math.floor((endPos - 1) / cols) : 0;
    const cursorRow = Math.floor(cursorPos / cols);
    const cursorCol = cursorPos % cols;
    if (cursorPos < endPos || showPlaceholder) {
      if (endRow > cursorRow) this.output.write(`\x1b[${endRow - cursorRow}A`);
      this.output.write(`\x1b[${cursorCol + 1}G`);
      this.cursorRowOffset = cursorRow;
    } else {
      this.cursorRowOffset = endRow;
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

function isCsiFinal(char) {
  const code = char.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function prevBoundary(line, index) {
  if (index <= 0) return 0;
  let prev = 0;
  for (const seg of graphemes.segment(line)) {
    if (seg.index >= index) break;
    prev = seg.index;
  }
  return prev;
}

function nextBoundary(line, index) {
  if (index >= line.length) return line.length;
  for (const seg of graphemes.segment(line)) {
    if (seg.index > index) return seg.index;
  }
  return line.length;
}
