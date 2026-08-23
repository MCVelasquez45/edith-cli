// Renders EDITH's normalized turn events as the single-pane activity flow:
//
//   ◆ Read src/auth/session.ts
//   ◆ Running tests
//     $ npm test -- auth
//     2 failed, 18 passed
//   ✓ Fixed authentication session refresh handling.
//
// Compact activity, no raw event objects, no debug spam. Verbose mode adds
// timing and runtime diagnostics.

import { colors } from '../ui/terminal.js';

const MAX_RESULT_LINES = 12;
const MAX_LINE_WIDTH = 100;

export function toolActivityLabel(tool, args = {}, workspace = null) {
  const a = { ...(args ?? {}) };
  // Labels stay workspace-relative even when the model passes absolute paths.
  for (const key of ['path', 'from', 'to']) {
    if (typeof a[key] === 'string' && workspace && a[key].startsWith(workspace)) {
      a[key] = a[key].slice(workspace.length).replace(/^\//, '') || '.';
    }
  }
  switch (tool) {
    case 'read_file': return `Read ${a.path ?? 'file'}${a.start_line ? ` (lines ${a.start_line}–${a.end_line ?? '…'})` : ''}`;
    case 'list_directory': return `List ${a.path ?? '.'}`;
    case 'search_code': return `Search "${a.query ?? ''}"`;
    case 'search_files': return `Find files ${a.pattern ?? ''}`;
    case 'project_info': return 'Inspecting workspace';
    case 'git_status': return 'Git status';
    case 'git_diff': return `Git diff${a.staged ? ' (staged)' : ''}`;
    case 'git_log': return 'Git log';
    case 'git_branch': return 'Git branches';
    case 'create_file': return `Create ${a.path ?? 'file'}`;
    case 'write_file': return `Write ${a.path ?? 'file'}`;
    case 'edit_file': return `Edit ${a.path ?? 'file'}`;
    case 'move_file': return `Move ${a.from ?? ''} → ${a.to ?? ''}`;
    case 'delete_file': return `Delete ${a.path ?? 'file'}`;
    case 'run_command': return `Run ${truncate(a.command ?? 'command', 70)}`;
    case 'run_destructive_command': return `Run (destructive) ${truncate(a.command ?? '', 60)}`;
    case 'run_tests': return 'Running tests';
    case 'run_lint': return 'Running lint';
    case 'run_typecheck': return 'Running typecheck';
    case 'read_skill': return `Load skill "${a.name ?? ''}"`;
    case 'delegate_specialist': return `Delegate to ${a.agent ?? 'specialist'}`;
    default: return tool ?? 'tool';
  }
}

export function summarizeToolResult(tool, content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  if (text.startsWith('Error:')) return { kind: 'error', lines: [text.split('\n')[0]] };

  switch (tool) {
    case 'search_code': {
      const count = text === '(no matches)' ? 0 : text.split('\n').filter(Boolean).length;
      return { kind: 'note', lines: [count ? `Found ${count} match${count === 1 ? '' : 'es'}` : 'No matches'] };
    }
    case 'search_files': {
      const count = text.includes('(no files matched)') ? 0 : text.split('\n').filter(Boolean).length;
      return { kind: 'note', lines: [count ? `${count} file${count === 1 ? '' : 's'}` : 'No files matched'] };
    }
    case 'edit_file':
    case 'create_file':
    case 'write_file':
    case 'move_file':
    case 'delete_file':
      return { kind: 'note', lines: [text.split('\n')[0]] };
    case 'run_command':
    case 'run_destructive_command':
    case 'run_tests':
    case 'run_lint':
    case 'run_typecheck':
      return { kind: 'block', lines: commandBlock(text) };
    case 'read_file':
    case 'list_directory': {
      const lines = text.split('\n').length;
      return { kind: 'note', lines: [`${lines} line${lines === 1 ? '' : 's'}`] };
    }
    case 'read_skill':
      return null; // loading a skill needs no output echo
    case 'delegate_specialist':
      return { kind: 'block', lines: clampLines(text.split('\n'), 8) };
    default:
      return { kind: 'note', lines: clampLines(text.split('\n'), 3) };
  }
}

function commandBlock(text) {
  const lines = text.split('\n');
  const out = [];
  let body = [];
  for (const line of lines) {
    if (line.startsWith('$ ')) { out.push(line); continue; }
    if (line.startsWith('exit code: ')) { out.unshiftExit = line; continue; }
    if (line === 'stdout:' || line === 'stderr:') continue;
    body.push(line);
  }
  body = body.filter((line, index) => line.trim() || body[index - 1]?.trim());
  out.push(...clampLines(body, MAX_RESULT_LINES));
  if (out.unshiftExit && !/exit code: 0/.test(out.unshiftExit)) out.push(colors.red(out.unshiftExit));
  return out;
}

function clampLines(lines, max) {
  const cleaned = lines.map((line) => truncate(line, MAX_LINE_WIDTH));
  if (cleaned.length <= max) return cleaned;
  return [...cleaned.slice(0, max), colors.dim(`… ${cleaned.length - max} more lines (/details for full output)`)];
}

function truncate(value, width) {
  const text = String(value);
  if (text.length <= width) return text;
  const points = [...text]; // avoid slicing through a surrogate pair
  return points.length <= width ? text : `${points.slice(0, width - 1).join('')}…`;
}

export class TurnView {
  constructor({ ui, verbose = false, workspace = null }) {
    this.ui = ui;
    this.verbose = verbose;
    this.workspace = workspace;
    this.thinkingShown = false;
    this.streaming = false;
    this.sawActivity = false;
    this.startedAt = Date.now();
    this.lastToolCall = new Map();
    this.fullOutputs = [];
  }

  handle(event) {
    switch (event.type) {
      case 'reasoning-delta':
        if (!this.thinkingShown) {
          this.thinkingShown = true;
          this.ui.line(`${colors.cyan('◆')} ${colors.dim('Thinking…')}`);
        }
        return;
      case 'tool-call': {
        this.thinkingShown = false;
        this.sawActivity = true;
        this.endStream();
        const label = toolActivityLabel(event.tool, event.args, this.workspace);
        this.lastToolCall.set(event.toolCallId, event.tool);
        this.ui.line(`${colors.cyan('◆')} ${label}`);
        return;
      }
      case 'tool-result': {
        const tool = event.tool ?? this.lastToolCall.get(event.toolCallId);
        this.fullOutputs.push({ tool, content: event.content });
        const summary = summarizeToolResult(tool, event.content);
        if (!summary) return;
        const prefix = summary.kind === 'error' ? colors.red('  ') : '  ';
        for (const line of summary.lines) this.ui.line(`${prefix}${summary.kind === 'error' ? colors.red(line) : colors.dim(line)}`);
        return;
      }
      case 'text-delta':
        this.thinkingShown = false;
        this.didStream = true;
        if (!this.streaming) {
          this.streaming = true;
          this.ui.stdout.write('\n');
        }
        this.ui.stdout.write(event.text);
        return;
      case 'text':
        if (!event.streamed && event.text) {
          this.endStream();
        }
        return;
      case 'governance':
        this.ui.line(colors.dim(`  ${event.detail}`));
        return;
      case 'governance-blocked':
        this.endStream();
        this.ui.line(`${colors.red('✗')} ${event.notice}`);
        return;
      case 'approval-decision':
        this.ui.line(colors.dim(`  ${event.approved ? 'approved' : 'denied'}: ${event.tools.filter(Boolean).join(', ')}`));
        return;
      case 'subagent-start':
        this.ui.line(`${colors.cyan('◆')} ${colors.dim('Subagent working…')}`);
        return;
      case 'runtime':
        if (this.verbose) this.ui.line(colors.gray(`  · ${event.detail}`));
        return;
      default:
        return;
    }
  }

  endStream() {
    if (this.streaming) {
      this.ui.stdout.write('\n');
      this.streaming = false;
    }
  }

  finish(result) {
    this.endStream();
    const elapsed = this.verbose ? colors.dim(` (${((Date.now() - this.startedAt) / 1000).toFixed(1)}s)`) : '';
    if (result.state === 'COMPLETED') {
      // If the answer never streamed (e.g. recovered via reconcile), print it.
      if (result.text && !this.didStream) {
        this.ui.stdout.write(`\n${result.text}\n`);
      }
      if (this.sawActivity) this.ui.line(`${colors.green('✓')} ${colors.dim('Done')}${elapsed}`);
      else if (elapsed) this.ui.line(elapsed.trim());
    } else if (result.state === 'CANCELLED') {
      this.ui.line(`${colors.yellow('■')} Cancelled — session preserved${elapsed}`);
    } else if (result.state === 'FAILED' && !result.governanceBlocked) {
      this.ui.line(`${colors.red('✗')} ${friendlyError(result.error ?? 'The request failed')}${elapsed}`);
    }
  }
}

export function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'unknown error');
  if (/ECONNREFUSED.*11434|ollama/i.test(message)) {
    return 'Local model unavailable — is Ollama running? Try: ollama serve';
  }
  if (/failed to connect to remote mcp/i.test(message)) {
    return 'EDITH\'s capability service was unreachable. Restart EDITH (/exit, then edith).';
  }
  if (/timed out/i.test(message)) {
    return `The operation timed out. ${colors.dim(message)}`;
  }
  return message.replace(/\s+/g, ' ').slice(0, 300);
}
