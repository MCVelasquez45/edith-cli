// Workspace awareness: when `edith` starts in a directory it understands the
// repository, project type, tooling, and any workspace instructions — without
// dumping the repo into model context. The summary below goes into agent
// instructions; everything deeper is retrieved progressively through tools.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const INSTRUCTION_FILES = ['EDITH.md', '.edith/EDITH.md', 'AGENTS.md', 'CLAUDE.md'];
const MAX_INSTRUCTIONS_BYTES = 6000;

function run(command, args, cwd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(null); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0 ? stdout : null); });
  });
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

export async function describeWorkspace(cwd) {
  const root = (await run('git', ['rev-parse', '--show-toplevel'], cwd))?.trim() || null;
  const workspace = root ?? cwd;

  const [branch, status, project, instructions] = await Promise.all([
    run('git', ['branch', '--show-current'], workspace).then((out) => out?.trim() || null),
    run('git', ['status', '--porcelain'], workspace),
    detectProjectProfile(workspace),
    loadWorkspaceInstructions(workspace)
  ]);

  const changedFiles = status === null ? null : status.split('\n').filter(Boolean).length;

  return {
    cwd,
    root: workspace,
    isGitRepo: root !== null,
    branch,
    changedFiles,
    name: project.name ?? path.basename(workspace),
    project,
    instructions
  };
}

async function detectProjectProfile(workspace) {
  const profile = { types: [], packageManager: null, name: null, scripts: {}, commands: {}, configFiles: [] };
  const at = (file) => path.join(workspace, file);

  if (await exists(at('package.json'))) {
    profile.types.push('node');
    try {
      const pkg = JSON.parse(await fs.readFile(at('package.json'), 'utf8'));
      profile.name = pkg.name ?? null;
      profile.scripts = pkg.scripts ?? {};
    } catch { /* unreadable */ }
    profile.packageManager = (await exists(at('pnpm-lock.yaml'))) ? 'pnpm'
      : (await exists(at('yarn.lock'))) ? 'yarn'
        : (await exists(at('bun.lock'))) || (await exists(at('bun.lockb'))) ? 'bun'
          : 'npm';
    if (profile.scripts.test) profile.commands.test = `${profile.packageManager} test`;
    if (profile.scripts.lint) profile.commands.lint = `${profile.packageManager === 'npm' ? 'npm run' : profile.packageManager} lint`;
    if (profile.scripts.build) profile.commands.build = `${profile.packageManager === 'npm' ? 'npm run' : profile.packageManager} build`;
    if (profile.scripts.typecheck) profile.commands.typecheck = `${profile.packageManager === 'npm' ? 'npm run' : profile.packageManager} typecheck`;
  }
  if (await exists(at('pyproject.toml')) || await exists(at('requirements.txt'))) {
    profile.types.push('python');
    profile.commands.test ??= 'pytest';
  }
  if (await exists(at('Cargo.toml'))) {
    profile.types.push('rust');
    profile.commands.test ??= 'cargo test';
  }
  if (await exists(at('go.mod'))) {
    profile.types.push('go');
    profile.commands.test ??= 'go test ./...';
  }
  for (const file of ['tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'Dockerfile', 'docker-compose.yml', '.github/workflows']) {
    if (await exists(at(file))) profile.configFiles.push(file);
  }
  if (!profile.types.length) profile.types.push('unknown');
  return profile;
}

async function loadWorkspaceInstructions(workspace) {
  for (const candidate of INSTRUCTION_FILES) {
    const file = path.join(workspace, candidate);
    if (await exists(file)) {
      const body = await fs.readFile(file, 'utf8');
      return {
        source: candidate,
        text: body.length > MAX_INSTRUCTIONS_BYTES ? `${body.slice(0, MAX_INSTRUCTIONS_BYTES)}\n...(truncated)` : body
      };
    }
  }
  return null;
}

// Compact context block for agent instructions. Deliberately small: the
// agent retrieves anything deeper with its tools.
export function workspaceContextBlock(ws) {
  const lines = [
    `Workspace: ${ws.root}`,
    ws.isGitRepo
      ? `Git: branch ${ws.branch ?? '(detached)'} · ${ws.changedFiles ?? 0} changed file(s)`
      : 'Git: not a repository',
    `Project: ${ws.name} (${ws.project.types.join(', ')})${ws.project.packageManager ? ` · ${ws.project.packageManager}` : ''}`
  ];
  const commands = Object.entries(ws.project.commands);
  if (commands.length) lines.push(`Commands: ${commands.map(([kind, cmd]) => `${kind}: ${cmd}`).join(' · ')}`);
  if (ws.project.configFiles.length) lines.push(`Notable config: ${ws.project.configFiles.join(', ')}`);
  if (ws.instructions) {
    lines.push(`Workspace instructions (${ws.instructions.source}):\n${ws.instructions.text}`);
  }
  return lines.join('\n');
}
