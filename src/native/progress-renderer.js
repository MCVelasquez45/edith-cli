import { colors } from '../ui/terminal.js';

const DEFAULT_SPINNER_DELAY_MS = 180;
const DEFAULT_SPINNER_INTERVAL_MS = 90;

export class NativeTurnRenderer {
  constructor({
    ui,
    verbose = false,
    spinnerDelayMs = DEFAULT_SPINNER_DELAY_MS,
    spinnerIntervalMs = DEFAULT_SPINNER_INTERVAL_MS,
    clock = () => Date.now()
  } = {}) {
    this.ui = ui;
    this.verbose = verbose;
    this.spinnerDelayMs = spinnerDelayMs;
    this.spinnerIntervalMs = spinnerIntervalMs;
    this.clock = clock;
    this.startedAt = this.clock();
    this.active = null;
    this.spinnerTimer = null;
    this.spinnerInterval = null;
    this.spinnerFrame = 0;
    this.responding = false;
    this.cancelled = false;
  }

  emit(event) {
    if (this.cancelled && event.type !== 'session:error') return;
    if (event.type === 'agent:working') return this.startWorking(event.message ?? 'Thinking');
    if (event.type === 'tool:start' || event.type === 'delegate:start') return this.startWorking(event.message ?? friendlyStatus(event), { immediate: true });
    if (event.type === 'tool:success' || event.type === 'delegate:success') return this.finishActive('success', event.message ?? completeStatus(event));
    if (event.type === 'tool:error' || event.type === 'delegate:error') return this.finishActive('error', event.message ?? failedStatus(event));
    if (event.type === 'response:start') return this.startResponse(event.label ?? 'EDITH');
    if (event.type === 'response:delta') return this.ui.streamChunk(event.text ?? '');
    if (event.type === 'response:end') return this.endResponse();
    if (event.type === 'session:error') return this.showError(event.message ?? 'Operation failed');
    return null;
  }

  startWorking(message, { immediate = false } = {}) {
    if (this.responding) return;
    if (this.active?.message === message) return;
    this.finishActive('success');
    this.active = { message, startedAt: this.clock(), shown: false, dynamic: false };
    if (immediate || !this.ui.isTTY) return this.showActiveLine();
    this.spinnerTimer = setTimeout(() => this.startSpinner(), this.spinnerDelayMs);
  }

  startSpinner() {
    if (!this.active || this.active.shown || !this.ui.isTTY) return;
    this.active.shown = true;
    this.active.dynamic = true;
    this.renderSpinner();
    this.spinnerInterval = setInterval(() => this.renderSpinner(), this.spinnerIntervalMs);
  }

  renderSpinner() {
    if (!this.active) return;
    const frames = this.ui.symbol('spinner');
    const frame = Array.isArray(frames) ? frames[this.spinnerFrame % frames.length] : frames;
    this.spinnerFrame += 1;
    this.replaceLine(`${colors.cyan(frame)} ${truncateStatus(this.active.message)}`);
  }

  showActiveLine() {
    if (!this.active || this.active.shown) return;
    this.active.shown = true;
    this.ui.line(`${this.ui.symbol('working')} ${this.active.message}`);
  }

  finishActive(kind = 'success', message = null) {
    if (!this.active) return;
    const active = this.active;
    this.clearTimers();
    const final = message ?? completeStatus({ message: active.message });
    const elapsed = this.clock() - active.startedAt;
    if (this.ui.isTTY && active.dynamic) this.replaceLine('');
    if ((active.shown || message) && active.message !== 'Thinking') {
      const symbol = kind === 'error' ? this.ui.symbol('error') : this.ui.symbol('success');
      const suffix = this.verbose ? ` · ${elapsed}ms` : '';
      this.ui.line(`${symbol} ${final}${suffix}`);
    }
    this.active = null;
  }

  startResponse(label = 'EDITH') {
    this.finishActive('success');
    if (this.responding) return;
    this.responding = true;
    this.ui.streamStart(label);
  }

  endResponse() {
    this.finishActive('success');
    if (!this.responding) return;
    this.responding = false;
    if (this.verbose) {
      const total = this.clock() - this.startedAt;
      this.ui.streamChunk(`\n${colors.dim(`total ${total}ms`)}`);
    }
    this.ui.streamEnd();
  }

  cancel() {
    this.cancelled = true;
    this.clearTimers();
    if (this.ui.isTTY && this.active?.dynamic) this.replaceLine('');
    this.active = null;
    if (this.responding) {
      this.ui.streamEnd();
      this.responding = false;
    }
    this.ui.line('Operation cancelled.');
  }

  showError(message) {
    this.finishActive('error');
    this.ui.error(message);
  }

  clearTimers() {
    if (this.spinnerTimer) clearTimeout(this.spinnerTimer);
    if (this.spinnerInterval) clearInterval(this.spinnerInterval);
    this.spinnerTimer = null;
    this.spinnerInterval = null;
  }

  replaceLine(text) {
    if (!this.ui.isTTY) {
      if (text) this.ui.line(text);
      return;
    }
    const width = Math.max(20, this.ui.stdout?.columns ?? process.stdout.columns ?? 80);
    this.ui.stdout.write(`\r${truncateStatus(text, width - 1).padEnd(width - 1)}\r`);
  }
}

export function createTurnEvents(renderer) {
  return {
    working: (message = 'Thinking') => renderer.emit({ type: 'agent:working', message }),
    activity: (message) => {
      const kind = classifyActivity(message);
      renderer.emit({ type: kind, message: friendlyActivity(message) });
    },
    streamStart: (label) => renderer.emit({ type: 'response:start', label }),
    streamChunk: (text) => renderer.emit({ type: 'response:delta', text }),
    streamEnd: () => renderer.emit({ type: 'response:end' }),
    error: (message) => renderer.emit({ type: 'session:error', message })
  };
}

export function classifyActivity(message) {
  if (/asking|running opencode|codex|claude/i.test(message)) return 'delegate:start';
  return 'tool:start';
}

export function friendlyActivity(message) {
  return String(message)
    .replace(/^Checking weather for .+/i, 'Checking weather')
    .replace(/^Fetching .+/i, 'Reading sources')
    .replace(/^Searching web.*/i, 'Searching the web')
    .replace(/^Reading official documentation$/i, 'Reading documentation')
    .replace(/^Checking Google Calendar list$/i, 'Checking calendar')
    .replace(/^Checking calendar events$/i, 'Checking calendar')
    .replace(/^Checking tomorrow calendar events$/i, 'Checking calendar')
    .replace(/^Checking next calendar event$/i, 'Checking calendar')
    .replace(/^Checking Gmail$/i, 'Checking Gmail')
    .replace(/^Searching Gmail.*/i, 'Checking Gmail')
    .replace(/^Checking Google Tasks$/i, 'Checking tasks')
    .replace(/^Checking GitHub\/GitLab.*/i, 'Checking GitHub and GitLab')
    .replace(/^Checking GitHub$/i, 'Checking GitHub')
    .replace(/^Checking GitLab$/i, 'Checking GitLab')
    .replace(/^Building personal brief$/i, 'Building your brief')
    .replace(/^Building updated personal brief$/i, 'Building updated brief')
    .replace(/^Asking Codex.*$/i, 'Asking Codex')
    .replace(/^Asking Claude.*$/i, 'Asking Claude')
    .replace(/^Running OpenCode.*$/i, 'Asking OpenCode');
}

function friendlyStatus(event) {
  return friendlyActivity(event.message ?? event.tool ?? event.agent ?? 'Working');
}

function completeStatus(event) {
  if (/reading sources/i.test(event.message ?? '')) return 'Sources read';
  if (/search/i.test(event.message ?? '')) return 'Search complete';
  if (/weather/i.test(event.message ?? '')) return 'Weather updated';
  if (/calendar/i.test(event.message ?? '')) return 'Calendar checked';
  if (/gmail/i.test(event.message ?? '')) return 'Gmail checked';
  if (/tasks/i.test(event.message ?? '')) return 'Tasks checked';
  if (/github and gitlab/i.test(event.message ?? '')) return 'Development context checked';
  if (/github/i.test(event.message ?? '')) return 'GitHub checked';
  if (/gitlab/i.test(event.message ?? '')) return 'GitLab checked';
  if (/brief/i.test(event.message ?? '')) return 'Brief built';
  if (/codex/i.test(event.message ?? '')) return 'Codex completed';
  if (/claude/i.test(event.message ?? '')) return 'Claude completed';
  if (/opencode/i.test(event.message ?? '')) return 'OpenCode completed';
  return event.message ?? 'Complete';
}

function failedStatus(event) {
  return event.message ?? 'Failed';
}

function truncateStatus(value, width = 76) {
  const text = String(value ?? '');
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
