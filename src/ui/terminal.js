import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const colors = {
  reset: '\x1b[0m',
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`
};

export class TerminalUI {
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
    process.stdout.write(`${text}\n`);
  }

  activity(text) {
    this.line(`${colors.cyan('●')} ${text}`);
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
    process.stdout.write(`\n${colors.bold(`${label}:`)}\n`);
  }

  streamChunk(text) {
    process.stdout.write(renderMarkdownLite(text));
  }

  streamEnd() {
    process.stdout.write('\n');
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

function renderMarkdownLite(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => colors.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, strong) => colors.bold(strong));
}
