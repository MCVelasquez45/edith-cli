// EDITH's coding-agent toolset, served to the TrueForge runtime over the
// loopback MCP capability service. Every tool carries a safety class:
//   READ         — safe, may auto-run
//   WRITE        — mutates the workspace; follows EDITH policy
//   DESTRUCTIVE  — requires explicit human approval (enforced by TrueForge's
//                  approval protocol via destructiveHint annotations)
// All paths are confined to the workspace root; secret-bearing files are
// refused for read and write; outputs are secret-redacted and bounded.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { resolveWorkspacePath, relativePath } from '../tools/path.js';
import { redactSecrets } from '../security/redact.js';
import { PermissionPolicy, Risk } from '../tools/policy.js';

export const Safety = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  DESTRUCTIVE: 'destructive'
});

const MAX_READ_BYTES = 64000;
const MAX_OUTPUT_BYTES = 64000;
const MAX_WRITE_BYTES = 512000;
const SECRET_FILE_PATTERNS = [
  /^\.env(\.|$)?/,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /credentials/i,
  /secrets?/i
];

function assertSafePath(requestedPath) {
  for (const segment of String(requestedPath).split('/').filter(Boolean)) {
    if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(segment))) {
      throw new Error(`Refusing to touch likely secret-bearing path: ${requestedPath}`);
    }
  }
}

function bounded(text, limit = MAX_OUTPUT_BYTES) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...(truncated)`;
}

export function runCommand(command, args, { cwd, timeoutMs = 30000, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
      reject(new Error(`${shell ? command : [command, ...args].join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 130 : code ?? 1, stdout: bounded(stdout), stderr: bounded(stderr) });
    });
  });
}

function text(value) {
  return { content: [{ type: 'text', text: bounded(redactSecrets(String(value ?? '')))} ] };
}

function commandResult({ code, stdout, stderr }, { label = '' } = {}) {
  const parts = [];
  if (label) parts.push(label);
  parts.push(`exit code: ${code}`);
  if (stdout?.trim()) parts.push(`stdout:\n${stdout.trim()}`);
  if (stderr?.trim()) parts.push(`stderr:\n${stderr.trim()}`);
  return text(parts.join('\n\n'));
}

async function detectProject(workspace) {
  const exists = (file) => fs.access(path.join(workspace, file)).then(() => true, () => false);
  const info = { types: [], packageManager: null, scripts: {}, commands: {} };
  if (await exists('package.json')) {
    info.types.push('node');
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8'));
      info.name = pkg.name;
      info.scripts = pkg.scripts ?? {};
    } catch { /* unreadable package.json */ }
    info.packageManager = (await exists('pnpm-lock.yaml')) ? 'pnpm'
      : (await exists('yarn.lock')) ? 'yarn'
        : (await exists('bun.lockb')) || (await exists('bun.lock')) ? 'bun'
          : 'npm';
    const run = info.packageManager === 'npm' ? 'npm run' : info.packageManager;
    if (info.scripts.test) info.commands.test = `${info.packageManager} test`;
    if (info.scripts.lint) info.commands.lint = `${run} lint`;
    if (info.scripts.typecheck) info.commands.typecheck = `${run} typecheck`;
    else if (await exists('tsconfig.json')) info.commands.typecheck = 'npx tsc --noEmit';
  }
  if (await exists('pyproject.toml') || await exists('requirements.txt') || await exists('setup.py')) {
    info.types.push('python');
    info.commands.test ??= 'pytest';
  }
  if (await exists('Cargo.toml')) {
    info.types.push('rust');
    info.commands.test ??= 'cargo test';
    info.commands.lint ??= 'cargo clippy';
    info.commands.typecheck ??= 'cargo check';
  }
  if (await exists('go.mod')) {
    info.types.push('go');
    info.commands.test ??= 'go test ./...';
    info.commands.typecheck ??= 'go vet ./...';
  }
  if (!info.types.length) info.types.push('unknown');
  return info;
}

async function searchWithRipgrepOrGrep(workspace, args, grepArgs, timeoutMs = 15000) {
  const rg = await runCommand('rg', args, { cwd: workspace, timeoutMs }).catch(() => null);
  if (rg && (rg.code === 0 || rg.code === 1)) return rg; // 1 = no matches
  return runCommand('grep', grepArgs, { cwd: workspace, timeoutMs }).catch((error) => ({ code: 1, stdout: '', stderr: error.message }));
}

// Builds the full tool list for a workspace. `extras` lets later layers
// (skills, specialist delegation) contribute tools through the same service.
export function buildToolset({ workspace, extras = [] }) {
  const root = path.resolve(workspace);
  const policy = new PermissionPolicy({ approvalMode: 'safe' });
  const abs = (rel) => resolveWorkspacePath(root, rel ?? '.');

  const tools = [
    {
      name: 'list_directory',
      title: 'List directory',
      description: 'List files and directories at a workspace-relative path. Read-only.',
      safety: Safety.READ,
      schema: { path: z.string().max(500).optional() },
      async handler({ path: rel = '.' } = {}) {
        const target = abs(rel);
        const entries = await fs.readdir(target, { withFileTypes: true });
        const lines = [];
        for (const entry of entries.slice(0, 300)) {
          if (entry.name === '.git' || entry.name === 'node_modules') {
            lines.push(`${entry.name}/ (not expanded)`);
            continue;
          }
          if (entry.isDirectory()) { lines.push(`${entry.name}/`); continue; }
          const size = await fs.stat(path.join(target, entry.name)).then((s) => s.size).catch(() => null);
          lines.push(`${entry.name}${size === null ? '' : ` (${size} bytes)`}`);
        }
        return text(lines.join('\n') || '(empty directory)');
      }
    },
    {
      name: 'read_file',
      title: 'Read file',
      description: 'Read a workspace file, optionally a line range (1-indexed, inclusive). Read-only.',
      safety: Safety.READ,
      schema: {
        path: z.string().min(1).max(500),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional()
      },
      async handler({ path: rel, start_line: startLine, end_line: endLine }) {
        assertSafePath(rel);
        const target = abs(rel);
        const stat = await fs.stat(target);
        if (!startLine && stat.size > MAX_READ_BYTES) {
          throw new Error(`File is ${stat.size} bytes; too large for a full read. Use start_line/end_line to read a range.`);
        }
        const body = await fs.readFile(target, 'utf8');
        if (!startLine && !endLine) return text(body);
        const lines = body.split('\n');
        const from = (startLine ?? 1) - 1;
        const to = endLine ?? Math.min(lines.length, from + 400);
        const slice = lines.slice(from, to).map((line, index) => `${from + index + 1}\t${line}`);
        return text(slice.join('\n') || '(empty range)');
      }
    },
    {
      name: 'search_code',
      title: 'Search code',
      description: 'Search file contents in the workspace with a regex or literal query. Returns file:line matches. Read-only.',
      safety: Safety.READ,
      schema: { query: z.string().min(1).max(500), glob: z.string().max(200).optional() },
      async handler({ query, glob }) {
        const rgArgs = ['--line-number', '--no-heading', '--max-count', '50', '--glob', '!node_modules', '--glob', '!.git'];
        if (glob) rgArgs.push('--glob', glob);
        rgArgs.push('--', query, '.');
        const grepArgs = ['-rn', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', query, '.'];
        const result = await searchWithRipgrepOrGrep(root, rgArgs, grepArgs);
        return text(result.stdout.trim() || '(no matches)');
      }
    },
    {
      name: 'search_files',
      title: 'Find files by name',
      description: 'Find files whose path matches a glob pattern (e.g. **/*.test.js). Read-only.',
      safety: Safety.READ,
      schema: { pattern: z.string().min(1).max(200) },
      async handler({ pattern }) {
        const result = await searchWithRipgrepOrGrep(
          root,
          ['--files', '--glob', pattern, '--glob', '!node_modules', '--glob', '!.git'],
          ['-rl', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', '', '.']
        );
        const lines = result.stdout.split('\n').filter(Boolean).slice(0, 200);
        return text(lines.join('\n') || '(no files matched)');
      }
    },
    {
      name: 'project_info',
      title: 'Inspect project',
      description: 'Summarize the workspace: project type, package manager, scripts, git branch and status counts. Read-only.',
      safety: Safety.READ,
      async handler() {
        const info = await detectProject(root);
        const branch = await runCommand('git', ['branch', '--show-current'], { cwd: root, timeoutMs: 5000 }).catch(() => null);
        const status = await runCommand('git', ['status', '--porcelain'], { cwd: root, timeoutMs: 5000 }).catch(() => null);
        const changed = status?.stdout.split('\n').filter(Boolean).length ?? null;
        return text(JSON.stringify({
          workspace: root,
          project: info,
          git: branch?.code === 0 ? { branch: branch.stdout.trim() || '(detached)', changedFiles: changed } : null
        }, null, 2));
      }
    },
    {
      name: 'git_status',
      title: 'Git status',
      description: 'Show git branch and working-tree status. Read-only.',
      safety: Safety.READ,
      async handler() {
        return commandResult(await runCommand('git', ['status', '--short', '--branch'], { cwd: root, timeoutMs: 10000 }));
      }
    },
    {
      name: 'git_diff',
      title: 'Git diff',
      description: 'Show unstaged (default) or staged changes, optionally limited to a path. Read-only.',
      safety: Safety.READ,
      schema: { staged: z.boolean().optional(), path: z.string().max(500).optional() },
      async handler({ staged, path: rel } = {}) {
        const args = ['diff'];
        if (staged) args.push('--cached');
        if (rel) args.push('--', rel);
        const result = await runCommand('git', args, { cwd: root, timeoutMs: 10000 });
        return text(result.stdout.trim() || '(no changes)');
      }
    },
    {
      name: 'git_log',
      title: 'Git log',
      description: 'Show recent commits. Read-only.',
      safety: Safety.READ,
      schema: { limit: z.number().int().min(1).max(50).optional() },
      async handler({ limit = 10 } = {}) {
        return commandResult(await runCommand('git', ['log', '--oneline', '-n', String(limit)], { cwd: root, timeoutMs: 10000 }));
      }
    },
    {
      name: 'git_branch',
      title: 'Git branches',
      description: 'List local branches with the current one marked. Read-only.',
      safety: Safety.READ,
      async handler() {
        return commandResult(await runCommand('git', ['branch'], { cwd: root, timeoutMs: 10000 }));
      }
    },
    {
      name: 'create_file',
      title: 'Create file',
      description: 'Create a new file with the given content. Fails if the file already exists.',
      safety: Safety.WRITE,
      schema: { path: z.string().min(1).max(500), content: z.string().max(MAX_WRITE_BYTES) },
      async handler({ path: rel, content }) {
        assertSafePath(rel);
        const target = abs(rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, { flag: 'wx' });
        return text(`Created ${relativePath(root, target)} (${Buffer.byteLength(content)} bytes)`);
      }
    },
    {
      name: 'write_file',
      title: 'Write file',
      description: 'Overwrite an existing file with new content. Use edit_file for targeted changes.',
      safety: Safety.WRITE,
      schema: { path: z.string().min(1).max(500), content: z.string().max(MAX_WRITE_BYTES) },
      async handler({ path: rel, content }) {
        assertSafePath(rel);
        const target = abs(rel);
        await fs.access(target).catch(() => { throw new Error(`${rel} does not exist. Use create_file for new files.`); });
        await fs.writeFile(target, content);
        return text(`Wrote ${relativePath(root, target)} (${Buffer.byteLength(content)} bytes)`);
      }
    },
    {
      name: 'edit_file',
      title: 'Edit file',
      description: 'Replace an exact text snippet in a file. old_text must appear exactly once unless replace_all is true.',
      safety: Safety.WRITE,
      schema: {
        path: z.string().min(1).max(500),
        old_text: z.string().min(1).max(MAX_WRITE_BYTES),
        new_text: z.string().max(MAX_WRITE_BYTES),
        replace_all: z.boolean().optional()
      },
      async handler({ path: rel, old_text: oldText, new_text: newText, replace_all: replaceAll }) {
        assertSafePath(rel);
        const target = abs(rel);
        const body = await fs.readFile(target, 'utf8');
        const occurrences = body.split(oldText).length - 1;
        if (occurrences === 0) throw new Error(`old_text not found in ${rel}. Read the file and match the existing text exactly.`);
        if (occurrences > 1 && !replaceAll) throw new Error(`old_text appears ${occurrences} times in ${rel}. Provide more context or set replace_all.`);
        const updated = replaceAll ? body.split(oldText).join(newText) : body.replace(oldText, newText);
        await fs.writeFile(target, updated);
        const delta = updated.split('\n').length - body.split('\n').length;
        return text(`Edited ${relativePath(root, target)} (${occurrences} replacement${occurrences === 1 ? '' : 's'}, line delta ${delta >= 0 ? '+' : ''}${delta})`);
      }
    },
    {
      name: 'move_file',
      title: 'Move or rename file',
      description: 'Move or rename a file within the workspace.',
      safety: Safety.WRITE,
      schema: { from: z.string().min(1).max(500), to: z.string().min(1).max(500) },
      async handler({ from, to }) {
        assertSafePath(from);
        assertSafePath(to);
        const source = abs(from);
        const target = abs(to);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(source, target);
        return text(`Moved ${relativePath(root, source)} -> ${relativePath(root, target)}`);
      }
    },
    {
      name: 'delete_file',
      title: 'Delete file',
      description: 'Permanently delete a file from the workspace. Destructive: requires approval.',
      safety: Safety.DESTRUCTIVE,
      schema: { path: z.string().min(1).max(500) },
      async handler({ path: rel }) {
        assertSafePath(rel);
        const target = abs(rel);
        const stat = await fs.stat(target);
        if (stat.isDirectory()) throw new Error('delete_file only deletes files, not directories.');
        await fs.rm(target);
        return text(`Deleted ${relativePath(root, target)}`);
      }
    },
    {
      name: 'run_command',
      title: 'Run shell command',
      description: 'Run a shell command in the workspace. Commands classified destructive (rm, git reset, git clean, dd, ...) are refused here — use run_destructive_command, which requires approval.',
      safety: Safety.WRITE,
      schema: { command: z.string().min(1).max(2000), timeout_seconds: z.number().int().min(1).max(600).optional() },
      async handler({ command, timeout_seconds: timeoutSeconds = 120 }) {
        const risk = policy.classifyCommand(command);
        if (risk === Risk.DESTRUCTIVE) {
          throw new Error(`Command classified DESTRUCTIVE (${command}). Use run_destructive_command with a reason; it requires human approval.`);
        }
        if (risk === Risk.SYSTEM_CHANGE) {
          throw new Error(`Command classified SYSTEM_CHANGE (${command}); EDITH does not run system-changing commands from the agent loop.`);
        }
        const result = await runCommand(command, [], { cwd: root, timeoutMs: timeoutSeconds * 1000, shell: true });
        return commandResult(result, { label: `$ ${command}` });
      }
    },
    {
      name: 'run_destructive_command',
      title: 'Run destructive shell command',
      description: 'Run a destructive shell command (deletes/reverts data). Requires explicit human approval before execution.',
      safety: Safety.DESTRUCTIVE,
      schema: { command: z.string().min(1).max(2000), reason: z.string().min(1).max(500) },
      async handler({ command, reason }) {
        const risk = policy.classifyCommand(command);
        if (risk === Risk.SYSTEM_CHANGE) {
          throw new Error('System-changing commands (sudo, brew, launchctl, chmod, chown) are never run from the agent loop.');
        }
        const result = await runCommand(command, [], { cwd: root, timeoutMs: 120000, shell: true });
        return commandResult(result, { label: `$ ${command}\n(reason: ${reason})` });
      }
    },
    {
      name: 'run_tests',
      title: 'Run tests',
      description: 'Run the project test suite (auto-detected; e.g. npm test). Optionally pass extra args.',
      safety: Safety.WRITE,
      schema: { args: z.string().max(500).optional() },
      async handler({ args = '' } = {}) {
        const info = await detectProject(root);
        const command = info.commands.test;
        if (!command) throw new Error('No test command detected for this project.');
        const full = args ? `${command} ${args}` : command;
        const result = await runCommand(full, [], { cwd: root, timeoutMs: 300000, shell: true });
        return commandResult(result, { label: `$ ${full}` });
      }
    },
    {
      name: 'run_lint',
      title: 'Run lint',
      description: 'Run the project linter if one is configured.',
      safety: Safety.WRITE,
      async handler() {
        const info = await detectProject(root);
        const command = info.commands.lint;
        if (!command) throw new Error('No lint command detected for this project.');
        const result = await runCommand(command, [], { cwd: root, timeoutMs: 180000, shell: true });
        return commandResult(result, { label: `$ ${command}` });
      }
    },
    {
      name: 'run_typecheck',
      title: 'Run typecheck',
      description: 'Run the project type checker if one is configured.',
      safety: Safety.WRITE,
      async handler() {
        const info = await detectProject(root);
        const command = info.commands.typecheck;
        if (!command) throw new Error('No typecheck command detected for this project.');
        const result = await runCommand(command, [], { cwd: root, timeoutMs: 180000, shell: true });
        return commandResult(result, { label: `$ ${command}` });
      }
    },
    ...extras
  ];

  return tools;
}

export function toolNamesBySafety(tools) {
  const bySafety = { [Safety.READ]: [], [Safety.WRITE]: [], [Safety.DESTRUCTIVE]: [] };
  for (const tool of tools) bySafety[tool.safety]?.push(tool.name);
  return bySafety;
}
