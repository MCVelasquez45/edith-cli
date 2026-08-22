import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildToolset, toolNamesBySafety, Safety } from '../src/capability/toolset.js';

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-toolset-'));
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fixture',
    scripts: { test: 'node -e "console.log(\'ok\')"', lint: 'node -e "console.log(\'lint ok\')"' }
  }, null, 2));
  await fs.mkdir(path.join(dir, 'src'));
  await fs.writeFile(path.join(dir, 'src', 'app.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'build code: FIXTURE-42\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function toolMap(workspace) {
  const tools = buildToolset({ workspace });
  return { tools, get: (name) => tools.find((tool) => tool.name === name) };
}

function textOf(result) {
  return result.content.map((item) => item.text).join('\n');
}

test('capability toolset', async (t) => {
  const workspace = await makeWorkspace();
  const { tools, get } = toolMap(workspace);
  t.after(async () => fs.rm(workspace, { recursive: true, force: true }));

  await t.test('covers the required coding-agent surface with safety classes', () => {
    const bySafety = toolNamesBySafety(tools);
    for (const name of ['list_directory', 'read_file', 'search_code', 'search_files', 'project_info', 'git_status', 'git_diff', 'git_log', 'git_branch']) {
      assert.ok(bySafety[Safety.READ].includes(name), `${name} should be READ`);
    }
    for (const name of ['create_file', 'write_file', 'edit_file', 'move_file', 'run_command', 'run_tests', 'run_lint', 'run_typecheck']) {
      assert.ok(bySafety[Safety.WRITE].includes(name), `${name} should be WRITE`);
    }
    for (const name of ['delete_file', 'run_destructive_command']) {
      assert.ok(bySafety[Safety.DESTRUCTIVE].includes(name), `${name} should be DESTRUCTIVE`);
    }
  });

  await t.test('reads files and line ranges', async () => {
    const whole = textOf(await get('read_file').handler({ path: 'src/app.js' }));
    assert.match(whole, /return a \+ b/);
    const range = textOf(await get('read_file').handler({ path: 'src/app.js', start_line: 2, end_line: 2 }));
    assert.match(range, /^2\treturn a \+ b;$|2\t {2}return a \+ b;/m);
  });

  await t.test('refuses secret-bearing paths for read and write', async () => {
    await fs.writeFile(path.join(workspace, '.env'), 'API_KEY=xyz\n');
    await assert.rejects(get('read_file').handler({ path: '.env' }), /secret-bearing/);
    await assert.rejects(get('write_file').handler({ path: '.env', content: 'x' }), /secret-bearing/);
    await assert.rejects(get('delete_file').handler({ path: '.env' }), /secret-bearing/);
  });

  await t.test('blocks path escapes', async () => {
    await assert.rejects(get('read_file').handler({ path: '../outside.txt' }), /escapes workspace/);
  });

  await t.test('searches code', async () => {
    const result = textOf(await get('search_code').handler({ query: 'FIXTURE-42' }));
    assert.match(result, /notes\.txt/);
  });

  await t.test('edit_file requires unique match and reports line delta', async () => {
    await assert.rejects(get('edit_file').handler({ path: 'src/app.js', old_text: 'nope', new_text: 'x' }), /not found/);
    const result = textOf(await get('edit_file').handler({
      path: 'src/app.js',
      old_text: 'return a + b;',
      new_text: 'const sum = a + b;\n  return sum;'
    }));
    assert.match(result, /Edited src\/app\.js/);
    const body = await fs.readFile(path.join(workspace, 'src', 'app.js'), 'utf8');
    assert.match(body, /const sum = a \+ b;/);
  });

  await t.test('create_file refuses to overwrite; write_file refuses to create', async () => {
    await assert.rejects(get('create_file').handler({ path: 'notes.txt', content: 'x' }));
    await assert.rejects(get('write_file').handler({ path: 'brand-new.txt', content: 'x' }), /does not exist/);
    const created = textOf(await get('create_file').handler({ path: 'docs/new.md', content: '# hi\n' }));
    assert.match(created, /Created docs\/new\.md/);
  });

  await t.test('move and delete work within the workspace', async () => {
    await get('move_file').handler({ from: 'docs/new.md', to: 'docs/renamed.md' });
    const deleted = textOf(await get('delete_file').handler({ path: 'docs/renamed.md' }));
    assert.match(deleted, /Deleted/);
  });

  await t.test('run_command refuses destructive and system-changing commands', async () => {
    await assert.rejects(get('run_command').handler({ command: 'rm -rf src' }), /DESTRUCTIVE/);
    await assert.rejects(get('run_command').handler({ command: 'sudo ls' }), /SYSTEM_CHANGE/);
    const ok = textOf(await get('run_command').handler({ command: 'echo hello-edith' }));
    assert.match(ok, /hello-edith/);
    assert.match(ok, /exit code: 0/);
  });

  await t.test('run_tests auto-detects the project test command', async () => {
    const result = textOf(await get('run_tests').handler({}));
    assert.match(result, /npm test/);
    assert.match(result, /\bok\b/);
  });

  await t.test('git tools report repository state', async () => {
    const status = textOf(await get('git_status').handler({}));
    assert.match(status, /## /);
    const log = textOf(await get('git_log').handler({ limit: 1 }));
    assert.match(log, /init/);
    const info = textOf(await get('project_info').handler({}));
    const parsed = JSON.parse(info);
    assert.equal(parsed.project.packageManager, 'npm');
    assert.ok(parsed.project.types.includes('node'));
  });

  await t.test('redacts secret-looking values from tool output', async () => {
    await fs.writeFile(path.join(workspace, 'config.md'), 'api_key = sk-abc123def456\n');
    const result = textOf(await get('read_file').handler({ path: 'config.md' }));
    assert.ok(!result.includes('abc123def456'), 'secret value should be redacted');
  });
});
