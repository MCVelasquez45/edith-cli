import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveWorkspacePath, relativePath } from './path.js';
import { unifiedDiff } from './diff.js';
import { Risk } from './policy.js';

export class ToolEngine {
  constructor({ workspace, ui, policy }) {
    this.workspace = path.resolve(workspace);
    this.ui = ui;
    this.policy = policy;
    this.lastDiffs = [];
    this.changedFiles = new Set();
  }

  async listDirectory(dir = '.') {
    this.ui.activity(`Reading ${dir}`);
    const abs = resolveWorkspacePath(this.workspace, dir);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => !['node_modules', '.git', '.edith'].includes(e.name))
      .slice(0, 200)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
  }

  async readFile(file) {
    this.ui.activity(`Reading ${file}`);
    const abs = resolveWorkspacePath(this.workspace, file);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error(`${file} is not a file`);
    if (stat.size > 500_000) throw new Error(`${file} is too large to read safely`);
    return fs.readFile(abs, 'utf8');
  }

  async searchFiles(pattern = '') {
    this.ui.activity(`Searching files ${pattern || ''}`.trim());
    const results = [];
    await walk(this.workspace, results, pattern);
    return results.slice(0, 300).map((p) => relativePath(this.workspace, p));
  }

  async searchText(query) {
    this.ui.activity(`Searching for ${query}`);
    const files = [];
    await walk(this.workspace, files, '');
    const hits = [];
    for (const file of files.slice(0, 800)) {
      const rel = relativePath(this.workspace, file);
      if (isBinaryLike(file)) continue;
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      const lines = text.split('\n');
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query.toLowerCase())) hits.push({ file: rel, line: idx + 1, text: line.trim().slice(0, 240) });
      });
      if (hits.length > 100) return hits;
    }
    return hits;
  }

  async inspectRepository() {
    this.ui.activity('Inspecting repository');
    const topLevel = await this.listDirectory('.');
    const metadata = {};
    for (const candidate of ['package.json', 'README.md', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
      try {
        metadata[candidate] = (await this.readFile(candidate)).slice(0, 5000);
      } catch {}
    }
    const git = await this.gitState().catch((error) => ({ error: error.message }));
    return { topLevel, metadata, git };
  }

  async gitState() {
    const [status, branch, diff] = await Promise.all([
      this.runShell('git status --short', { forceReadOnly: true }),
      this.runShell('git branch --show-current', { forceReadOnly: true }),
      this.runShell('git diff --stat', { forceReadOnly: true })
    ]);
    return { branch: branch.stdout.trim(), status: status.stdout.trim(), diffStat: diff.stdout.trim() };
  }

  async proposeReplace({ file, search, replace, reason }) {
    const before = await this.readFile(file);
    if (!before.includes(search)) throw new Error(`Could not find target text in ${file}`);
    const after = before.replace(search, replace);
    const diff = unifiedDiff({ filePath: file, before, after });
    this.ui.activity(`Editing ${file}`);
    this.ui.diff(diff.text);
    const choice = await this.ui.approve({
      title: 'Apply this change?',
      body: reason ?? `${file}: ${diff.adds} additions, ${diff.dels} deletions`,
      choices: ['Yes', 'No']
    });
    if (choice !== 'Yes') return { applied: false, file, diff };
    await this.writeFile(file, after, { approved: true });
    this.lastDiffs.push({ file, ...diff });
    this.changedFiles.add(file);
    return { applied: true, file, diff };
  }

  async writeFile(file, content, { approved = false } = {}) {
    const allowed = approved || await this.policy.authorize({ ui: this.ui, action: `write ${file}`, risk: Risk.WORKSPACE_WRITE });
    if (!allowed) return { applied: false };
    const abs = resolveWorkspacePath(this.workspace, file);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.edith-${process.pid}.tmp`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, abs);
    this.changedFiles.add(file);
    return { applied: true };
  }

  async runShell(command, { forceReadOnly = false } = {}) {
    const risk = forceReadOnly ? Risk.READ_ONLY : this.policy.classifyCommand(command);
    const allowed = await this.policy.authorize({ ui: this.ui, action: 'run a shell command', risk, command });
    if (!allowed) return { denied: true, stdout: '', stderr: '' };
    this.ui.activity(`Running ${command}`);
    return new Promise((resolve) => {
      const child = spawn('/bin/zsh', ['-lc', command], { cwd: this.workspace, env: safeEnv(process.env) });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => resolve({ code, stdout: trim(stdout), stderr: trim(stderr), risk }));
    });
  }
}

async function walk(dir, results, pattern) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (['node_modules', '.git', '.next', 'dist', 'build', 'coverage'].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, results, pattern);
    else if (!pattern || e.name.toLowerCase().includes(pattern.toLowerCase())) results.push(abs);
    if (results.length > 1000) return;
  }
}

function isBinaryLike(file) {
  return /\.(png|jpg|jpeg|gif|webp|pdf|zip|gz|tar|sqlite|db|safetensors|gguf)$/i.test(file);
}

function trim(text, max = 20000) {
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function safeEnv(env) {
  const allowed = {};
  for (const key of ['PATH', 'HOME', 'SHELL', 'USER', 'TMPDIR', 'NVM_DIR', 'PNPM_HOME']) {
    if (env[key]) allowed[key] = env[key];
  }
  return allowed;
}
