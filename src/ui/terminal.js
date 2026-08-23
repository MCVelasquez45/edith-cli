import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const colors = {
  get reset() { return supportsColor() ? '\x1b[0m' : ''; },
  bold: (s) => colorize('1', s),
  dim: (s) => colorize('2', s),
  green: (s) => colorize('32', s),
  cyan: (s) => colorize('36', s),
  yellow: (s) => colorize('33', s),
  red: (s) => colorize('31', s),
  gray: (s) => colorize('90', s)
};

export class TerminalUI {
  constructor({ stdout = process.stdout, stderr = process.stderr } = {}) {
    this.stdout = stdout;
    this.stderr = stderr;
    this.isTTY = Boolean(stdout.isTTY);
    this.useColor = supportsColor(stdout);
    this.unicode = supportsUnicode();
  }

  banner({ provider, model, cwd, sessionId, approval }) {
    const lines = [
      'EDITH',
      '',
      `${model} · ${provider}`,
      cwd,
      `session ${sessionId.slice(0, 8)} · approval ${approval}`
    ];
    const width = Math.max(...lines.map((l) => l.length), 44);
    this.line(colors.cyan(`╭${'─'.repeat(width + 2)}╮`));
    for (const line of lines) this.line(colors.cyan('│ ') + line.padEnd(width) + colors.cyan(' │'));
    this.line(colors.cyan(`╰${'─'.repeat(width + 2)}╯`));
  }

  line(text = '') {
    this.stdout.write(`${text}\n`);
  }

  activity(text) {
    this.line(`${this.symbol('working')} ${text}`);
  }

  warn(text) {
    this.line(`${colors.yellow('WARN')} ${text}`);
  }

  error(text) {
    this.line(`${colors.red('ERROR')} ${text}`);
  }

  section(title) {
    this.line(`\n${colors.bold(title)}`);
  }

  streamStart(label = 'EDITH') {
    this.stdout.write(`\n${colors.bold(`${label}:`)}\n`);
  }

  streamChunk(text) {
    this.stdout.write(renderMarkdownLite(sanitizeText(text)));
  }

  streamEnd() {
    this.stdout.write('\n');
  }

  symbol(kind) {
    const unicode = {
      working: colors.cyan('◆'),
      success: colors.green('✓'),
      error: colors.red('✗'),
      warning: colors.yellow('!'),
      spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    };
    const ascii = {
      working: '*',
      success: 'OK',
      error: 'FAIL',
      warning: 'WARN',
      spinner: ['-', '\\', '|', '/']
    };
    return (this.unicode ? unicode : ascii)[kind];
  }

  diff(diffText) {
    for (const line of diffText.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) this.line(colors.green(line));
      else if (line.startsWith('-') && !line.startsWith('---')) this.line(colors.red(line));
      else if (line.startsWith('@@')) this.line(colors.cyan(line));
      else this.line(line);
    }
  }

  async approve({ title, body, choices = ['Yes', 'No'] }) {
    this.section(title);
    if (body) this.line(body);
    choices.forEach((choice, idx) => this.line(`${idx === 0 ? '❯' : ' '} ${choice}`));
    const rl = createInterface({ input, output, terminal: true });
    try {
      const answer = (await rl.question(colors.green('Select: '))).trim().toLowerCase();
      if (!answer) return choices[0];
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1];
      return choices.find((c) => c.toLowerCase().startsWith(answer)) ?? 'No';
    } finally {
      rl.close();
    }
  }
}

export function supportsColor(stream = process.stdout) {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

export function supportsUnicode() {
  return process.platform !== 'win32' || /utf-?8/i.test(process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? '');
}

function colorize(code, value) {
  if (!supportsColor()) return String(value);
  return `\x1b[${code}m${value}\x1b[0m`;
}

function renderMarkdownLite(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => colors.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, strong) => colors.bold(strong));
}

export function sanitizeText(text) {
  return String(text)
    .replace(/\bdon�t\b/g, 'don’t')
    .replace(/\bcan�t\b/g, 'can’t')
    .replace(/\bwon�t\b/g, 'won’t')
    .replace(/\bisn�t\b/g, 'isn’t')
    .replace(/\baren�t\b/g, 'aren’t')
    .replace(/\bdoesn�t\b/g, 'doesn’t')
    .replace(/\bdidn�t\b/g, 'didn’t')
    .replace(/\bI�m\b/g, 'I’m')
    .replace(/\byou�re\b/g, 'you’re')
    .replace(/\bthey�re\b/g, 'they’re')
    .replace(/\bwe�re\b/g, 'we’re');
}
