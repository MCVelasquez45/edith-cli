import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkspaceTools } from '../src/native/workspace-tools.js';

describe('native workspace tools', () => {
  it('returns bounded patch content for git diff', async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, 'file.txt'), 'before\n');
    spawnSync('git', ['init'], { cwd: workspace, encoding: 'utf8' });
    spawnSync('git', ['add', 'file.txt'], { cwd: workspace, encoding: 'utf8' });
    await fs.writeFile(path.join(workspace, 'file.txt'), 'after\n');

    const result = await new WorkspaceTools({ workspace }).gitDiff();

    assert.match(result.output, /-before/);
    assert.match(result.output, /\+after/);
  });

  it('includes staged and untracked content in git diff context', async () => {
    const workspace = await makeWorkspace();
    spawnSync('git', ['init'], { cwd: workspace, encoding: 'utf8' });
    await fs.writeFile(path.join(workspace, 'staged.txt'), 'staged\n');
    spawnSync('git', ['add', 'staged.txt'], { cwd: workspace, encoding: 'utf8' });
    await fs.writeFile(path.join(workspace, 'new.txt'), 'untracked\n');

    const result = await new WorkspaceTools({ workspace }).gitDiff();

    assert.match(result.output, /## Staged diff/);
    assert.match(result.output, /\+staged/);
    assert.match(result.output, /## Untracked files/);
    assert.match(result.output, /### new\.txt/);
    assert.match(result.output, /untracked/);
  });

  it('refuses to read likely secret-bearing files', async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, '.env'), 'TOKEN=secret\n');
    const tools = new WorkspaceTools({ workspace });

    await assert.rejects(() => tools.readFile({ path: '.env' }), /Refusing to read/);
  });

  it('redacts secret-like values from readable files', async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, 'config.txt'), 'api_key=sk-1234567890abcdef\n');
    const result = await new WorkspaceTools({ workspace }).readFile({ path: 'config.txt' });

    assert.match(result.output, /\[REDACTED\]/);
    assert.doesNotMatch(result.output, /1234567890abcdef/);
  });
});

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'edith-tools-'));
}
