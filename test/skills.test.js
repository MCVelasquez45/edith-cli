import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { discoverSkills, loadSkill, skillsInstructionBlock, makeReadSkillTool } from '../src/skills/registry.js';

test('skills system', async (t) => {
  await t.test('discovers bundled core skills (nested categories)', async () => {
    const skills = await discoverSkills();
    const names = skills.map((skill) => skill.name);
    for (const expected of ['commit', 'debug', 'review']) {
      assert.ok(names.includes(expected), `core skill ${expected} missing`);
    }
    assert.ok(skills.every((skill) => skill.description.length > 0));
  });

  await t.test('workspace skills shadow core skills by name and add new ones', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-skilltest-'));
    const dir = path.join(workspace, '.edith', 'skills', 'deploy');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: deploy\ndescription: Deploy this app safely.\n---\n\n# Steps\n1. build\n2. ship\n');
    const shadow = path.join(workspace, '.edith', 'skills', 'commit');
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), '---\nname: commit\ndescription: Workspace-specific commit rules.\n---\nUse ticket numbers.\n');

    const skills = await discoverSkills({ workspace });
    const deploy = skills.find((skill) => skill.name === 'deploy');
    assert.equal(deploy.source, 'workspace');
    const commit = skills.find((skill) => skill.name === 'commit');
    assert.equal(commit.source, 'workspace');
    assert.equal(commit.description, 'Workspace-specific commit rules.');

    const loaded = await loadSkill('deploy', { workspace });
    assert.match(loaded.body, /1\. build/);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  await t.test('instruction block lists names and descriptions only', async () => {
    const block = skillsInstructionBlock([
      { name: 'commit', description: 'Make clean commits.' },
      { name: 'debug', description: 'Diagnose failures.' }
    ]);
    assert.match(block, /- commit: Make clean commits\./);
    assert.match(block, /read_skill/);
    assert.ok(!block.includes('# '), 'skill bodies must not leak into instructions');
  });

  await t.test('read_skill tool loads bodies and errors helpfully', async () => {
    const tool = makeReadSkillTool({ workspace: null, z });
    assert.equal(tool.safety, 'read');
    const result = await tool.handler({ name: 'debug' });
    assert.match(result.content[0].text, /Reproduce first/);
    await assert.rejects(tool.handler({ name: 'nope' }), /Available skills/);
  });
});
