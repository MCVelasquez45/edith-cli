import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { describeWorkspace, workspaceContextBlock } from '../src/workspace/workspace.js';

test('workspace awareness', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-ws-'));
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));

  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'demo-app',
    scripts: { test: 'node --test', lint: 'eslint .', build: 'vite build' }
  }));
  await fs.writeFile(path.join(dir, 'yarn.lock'), '');
  await fs.writeFile(path.join(dir, 'tsconfig.json'), '{}');
  await fs.writeFile(path.join(dir, 'EDITH.md'), '# Rules\nAlways run tests before finishing.\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'dirty.txt'), 'x');
  const sub = path.join(dir, 'src');
  await fs.mkdir(sub);

  await t.test('detects repo root from a subdirectory', async () => {
    const ws = await describeWorkspace(sub);
    assert.equal(await fs.realpath(ws.root), await fs.realpath(dir));
    assert.equal(ws.isGitRepo, true);
    assert.equal(ws.cwd, sub);
  });

  await t.test('detects project profile, package manager, and commands', async () => {
    const ws = await describeWorkspace(dir);
    assert.equal(ws.name, 'demo-app');
    assert.ok(ws.project.types.includes('node'));
    assert.equal(ws.project.packageManager, 'yarn');
    assert.equal(ws.project.commands.test, 'yarn test');
    assert.ok(ws.project.configFiles.includes('tsconfig.json'));
    assert.equal(ws.changedFiles, 1);
  });

  await t.test('loads workspace instructions', async () => {
    const ws = await describeWorkspace(dir);
    assert.equal(ws.instructions.source, 'EDITH.md');
    assert.match(ws.instructions.text, /Always run tests/);
  });

  await t.test('context block is compact and complete', async () => {
    const ws = await describeWorkspace(dir);
    const block = workspaceContextBlock(ws);
    assert.match(block, /Project: demo-app \(node\) · yarn/);
    assert.match(block, /Commands: .*test: yarn test/);
    assert.match(block, /Workspace instructions \(EDITH\.md\)/);
    assert.ok(block.length < 8000, 'context block must stay bounded');
  });

  await t.test('handles non-git non-project directories gracefully', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-empty-'));
    const ws = await describeWorkspace(empty);
    assert.equal(ws.isGitRepo, false);
    assert.deepEqual(ws.project.types, ['unknown']);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
