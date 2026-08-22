import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveWorkspacePath, relativePath } from '../tools/path.js';
import { redactSecrets } from '../security/redact.js';

const MAX_READ_BYTES = 48000;
const MAX_OUTPUT_BYTES = 64000;
const SECRET_FILE_PATTERNS = [
  /^\.env(\.|$)?/,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /credentials/i,
  /secrets?/i
];

export class WorkspaceTools {
  constructor({ workspace }) {
    this.workspace = path.resolve(workspace);
  }

  async listDirectory({ path: requestedPath = '.' } = {}) {
    const absolute = resolveWorkspacePath(this.workspace, requestedPath);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const lines = entries
      .filter((entry) => !entry.name.startsWith('.git'))
      .slice(0, 200)
      .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
      .join('\n');
    return {
      tool: 'list_directory',
      title: `Listing ${relativePath(this.workspace, absolute)}`,
      output: lines || '(empty directory)'
    };
  }

  async readFile({ path: requestedPath }) {
    if (!requestedPath) throw new Error('read_file requires path');
    assertSafeReadPath(requestedPath);
    const absolute = resolveWorkspacePath(this.workspace, requestedPath);
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_READ_BYTES) throw new Error(`File too large for native read tool: ${requestedPath}`);
    const text = await fs.readFile(absolute, 'utf8');
    return {
      tool: 'read_file',
      title: `Reading ${relativePath(this.workspace, absolute)}`,
      output: redactSecrets(text)
    };
  }

  async searchFiles({ query }) {
    if (!query) throw new Error('search_files requires query');
    const result = await runCommand('rg', ['--line-number', '--glob', '!node_modules', query, '.'], {
      cwd: this.workspace,
      timeoutMs: 10000
    }).catch((error) => ({ code: 1, stdout: '', stderr: error.message }));
    return {
      tool: 'search_files',
      title: `Searching for ${query}`,
      output: redactSecrets(trimOutput(result.stdout || result.stderr || '(no matches)'))
    };
  }

  async gitStatus() {
    const result = await runCommand('git', ['status', '--short', '--branch'], { cwd: this.workspace, timeoutMs: 10000 });
    return {
      tool: 'git_status',
      title: 'Checking Git status',
      output: trimOutput(result.stdout || result.stderr || '(no git status output)')
    };
  }

  async gitDiff() {
    const [unstaged, staged, untracked] = await Promise.all([
      runCommand('git', ['diff', '--', '.'], { cwd: this.workspace, timeoutMs: 10000 }),
      runCommand('git', ['diff', '--cached', '--', '.'], { cwd: this.workspace, timeoutMs: 10000 }),
      this.untrackedSummary()
    ]);
    const output = [
      '## Unstaged diff',
      unstaged.stdout || '(none)',
      '## Staged diff',
      staged.stdout || '(none)',
      '## Untracked files',
      untracked || '(none)'
    ].join('\n\n');
    return {
      tool: 'git_diff',
      title: 'Checking Git diff',
      output: redactSecrets(trimOutput(output))
    };
  }

  async untrackedSummary() {
    const result = await runCommand('git', ['ls-files', '--others', '--exclude-standard'], { cwd: this.workspace, timeoutMs: 10000 });
    const files = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20);
    const chunks = [];
    for (const file of files) {
      try {
        assertSafeReadPath(file);
        const absolute = resolveWorkspacePath(this.workspace, file);
        const stat = await fs.stat(absolute);
        if (stat.isDirectory()) {
          chunks.push(`### ${file}\n(directory)`);
          continue;
        }
        if (stat.size > 12000) {
          chunks.push(`### ${file}\n(file too large: ${stat.size} bytes)`);
          continue;
        }
        chunks.push(`### ${file}\n${await fs.readFile(absolute, 'utf8')}`);
      } catch (error) {
        chunks.push(`### ${file}\n(unavailable: ${error.message})`);
      }
    }
    return chunks.join('\n\n');
  }
}

export async function detectWorkspace(cwd) {
  const root = await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd, timeoutMs: 3000 })
    .then((result) => result.code === 0 ? result.stdout.trim() : '')
    .catch(() => '');
  const branch = await runCommand('git', ['branch', '--show-current'], { cwd, timeoutMs: 3000 })
    .then((result) => result.code === 0 ? result.stdout.trim() : '')
    .catch(() => '');
  return {
    cwd,
    gitRoot: root || null,
    branch: branch || null,
    workspace: root || cwd
  };
}

function trimOutput(value) {
  if (value.length <= MAX_OUTPUT_BYTES) return value;
  return `${value.slice(0, MAX_OUTPUT_BYTES)}\n...(truncated)`;
}

function runCommand(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk.toString());
      truncated ||= stdout.length >= MAX_OUTPUT_BYTES;
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk.toString());
      truncated ||= stderr.length >= MAX_OUTPUT_BYTES;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 130 : code ?? 1, stdout: markTruncated(stdout, truncated), stderr: markTruncated(stderr, truncated) });
    });
  });
}

function appendBounded(current, next) {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return (current + next).slice(0, MAX_OUTPUT_BYTES);
}

function markTruncated(value, truncated) {
  return truncated ? `${value}\n...(truncated)` : value;
}

function assertSafeReadPath(requestedPath) {
  const normalized = requestedPath.split('/').filter(Boolean);
  for (const segment of normalized) {
    if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(segment))) {
      throw new Error(`Refusing to read likely secret-bearing file: ${requestedPath}`);
    }
  }
}
