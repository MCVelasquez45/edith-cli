// `edith doctor` — product diagnostics for the TrueForge-backed EDITH stack.
// Every failing check comes with a concrete remediation.

import fs from 'node:fs/promises';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { colors } from './ui/terminal.js';
import { RuntimeSupervisor } from './runtime/supervisor.js';
import { discoverLocalProviders, OLLAMA_BASE, LMSTUDIO_BASE } from './runtime/models.js';
import { describeWorkspace } from './workspace/workspace.js';
import { discoverSkills } from './skills/registry.js';
import { buildToolset } from './capability/toolset.js';
import { SessionStore } from './sessions/store.js';
import { runtimeDbPath, edithDataDir } from './runtime/paths.js';
import { AgentRegistry } from './agents/registry.js';
import { AuthRegistry } from './auth/registry.js';

export async function runDoctor({ cwd, ui }) {
  ui.line(colors.bold('\nEDITH Doctor\n'));
  const issues = [];
  const ok = (label, detail = '') => ui.line(`${colors.green('✓')} ${label}${detail ? colors.dim(` — ${detail}`) : ''}`);
  const warn = (label, remedy = '') => { ui.line(`${colors.yellow('⚠')} ${label}${remedy ? colors.dim(`\n    fix: ${remedy}`) : ''}`); };
  const fail = (label, remedy = '') => {
    issues.push(label);
    ui.line(`${colors.red('✗')} ${label}${remedy ? colors.dim(`\n    fix: ${remedy}`) : ''}`);
  };

  // Node + install
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 22) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old`, 'install Node 22 or newer');

  // TrueForge runtime
  const supervisor = new RuntimeSupervisor();
  try {
    const cliPath = await supervisor.resolveCliPath();
    ok('TrueForge runtime installed', cliPath.replace(process.env.HOME ?? '', '~'));
  } catch (error) {
    fail('TrueForge runtime not found', 'run `npm install` in the EDITH package, or set EDITH_TRUEFORGE_CLI');
  }
  const status = await supervisor.status();
  if (status.running) ok('Runtime healthy', status.state.baseUrl);
  else ui.line(`${colors.green('✓')} Runtime not running ${colors.dim('— starts automatically with `edith`')}`);

  // Session database
  try {
    await fs.access(runtimeDbPath());
    ok('Session database', runtimeDbPath().replace(process.env.HOME ?? '', '~'));
  } catch {
    ui.line(`${colors.green('✓')} Session database ${colors.dim('— created on first run')}`);
  }

  // Local model providers
  const providers = await discoverLocalProviders();
  const ollama = providers.find((provider) => provider.providerName === 'ollama-local');
  const lmstudio = providers.find((provider) => provider.providerName === 'lmstudio-local');
  if (ollama) {
    ok(`Ollama (${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'})`, ollama.models.map((model) => model.model_id).slice(0, 4).join(', '));
    const toolCapable = ollama.models.filter((model) => model.toolCapable);
    if (toolCapable.length) ok(`Tool-capable local model: ${toolCapable[0].model_id}`);
    else warn('No tool-capable Ollama model', 'ollama pull qwen3:8b');
  } else {
    warn(`Ollama not reachable at ${OLLAMA_BASE}`, 'ollama serve  (then: ollama pull qwen3:8b)');
  }
  if (lmstudio) ok(`LM Studio (${lmstudio.models.length} model${lmstudio.models.length === 1 ? '' : 's'})`);
  else warn(`LM Studio not running at ${LMSTUDIO_BASE}`, 'optional — start LM Studio and enable its local server');
  if (!ollama && !lmstudio) fail('No local model provider available', 'EDITH is local-first and needs Ollama or LM Studio running');

  // Cloud
  if (process.env.NVIDIA_API_KEY) ok('Cloud provider configured', 'key injected at request time; never stored in runtime state');
  else ui.line(`${colors.green('✓')} Cloud provider not configured ${colors.dim('— optional; EDITH is fully functional locally')}`);

  // Workspace
  const ws = await describeWorkspace(cwd);
  ok(`Workspace: ${ws.name}`, `${ws.project.types.join(', ')}${ws.isGitRepo ? ` · branch ${ws.branch ?? '(detached)'}` : ' · no git'}`);
  await fs.access(ws.root, fs.constants?.W_OK ?? 2).then(
    () => ok('Workspace writable'),
    () => fail('Workspace is not writable', `check permissions on ${ws.root}`)
  );

  // Tools + skills
  const tools = buildToolset({ workspace: ws.root });
  ok(`${tools.length} workspace tools`, 'read auto · write policy · destructive approval');
  const skills = await discoverSkills({ workspace: ws.root });
  if (skills.length) ok(`${skills.length} skill${skills.length === 1 ? '' : 's'}`, skills.map((skill) => skill.name).join(', '));
  else warn('No skills discovered', 'reinstall EDITH or add skills under ~/.edith/skills');

  // Sessions index
  const sessions = await new SessionStore().list({ includeArchived: true }).catch(() => null);
  if (sessions === null) fail('Session index unreadable', `inspect ${edithDataDir()}/sessions.json`);
  else ok(`Session index (${sessions.length} session${sessions.length === 1 ? '' : 's'})`);

  // Specialists
  for (const agent of await new AgentRegistry().list()) {
    if (agent.available) ok(`Specialist ${agent.name}`, agent.version || '');
    else ui.line(`${colors.green('✓')} Specialist ${agent.name} not installed ${colors.dim('— optional')}`);
  }

  // Keychain-backed auth
  try {
    for (const row of await new AuthRegistry().status()) {
      const label = row.profile ? `${row.name} (${row.profile})` : row.name;
      if (row.status === 'CONNECTED') ok(`Auth ${label}`, `${row.account ?? ''} · ${row.storage ?? 'Keychain'}`);
      else ui.line(`${colors.green('✓')} Auth ${label}: ${row.status.toLowerCase()} ${colors.dim('— optional')}`);
    }
  } catch { /* auth stack optional */ }

  // Local network posture
  const lmBind = spawnSync('lsof', ['-nP', '-iTCP:1234', '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (/\*:1234/.test(lmBind.stdout ?? '')) warn('LM Studio is listening on all interfaces (*:1234)', 'restrict LM Studio server to localhost');

  ui.line('');
  if (issues.length) {
    ui.line(`${colors.red(`${issues.length} issue${issues.length === 1 ? '' : 's'} found.`)} Fix the items above and re-run \`edith doctor\`.`);
    process.exitCode = 1;
  } else {
    ui.line(colors.green('EDITH is ready.'));
  }
}
