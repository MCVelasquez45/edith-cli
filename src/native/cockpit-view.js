import { colors } from '../ui/terminal.js';

export const RoutingMode = Object.freeze({
  AUTO: 'AUTO',
  CLAUDE: 'CLAUDE',
  CODEX: 'CODEX',
  OPENCODE: 'OPENCODE',
  LOCAL: 'LOCAL'
});

export function cockpitViewModel(core, { routingMode = RoutingMode.AUTO, tasks = [] } = {}) {
  const status = core.status();
  const agents = agentRows(core.agentHealth ?? [], status, tasks);
  return {
    title: 'EDITH',
    subtitle: 'LOCAL ORCHESTRATOR',
    state: tasks.some((task) => task.status === 'WORKING') ? 'WORKING' : 'READY',
    cwd: compactHome(status.cwd),
    workspace: compactHome(status.workspace),
    branch: status.branch || 'no branch',
    model: compactModel(status.model),
    runtime: status.provider,
    tools: status.toolsReady,
    routingMode,
    agents,
    tasks: tasks.slice(-8)
  };
}

export function renderStartupCockpit(view, { width = process.stdout.columns ?? 100 } = {}) {
  const inner = clampWidth(width);
  const line = (text = '') => `│ ${fit(text, inner - 4)} │`;
  const agentSummary = view.agents
    .map((agent) => `${agentSymbol(agent.status)} ${agent.name}`)
    .join(' · ');
  const lines = [
    `┌ ${view.title} ─ ${view.subtitle} ${fill('─', inner - view.title.length - view.subtitle.length - view.state.length - 8)} ${stateSymbol(view.state)} ${view.state} ┐`,
    line(`${view.cwd} · ${view.branch}`),
    line(`Model ${view.model} · ${view.runtime} · ${view.tools} tools`),
    line(agentSummary),
    `└${fill('─', inner - 2)}┘`,
    renderRoutingControl(view.routingMode, { width: inner }),
    colors.dim('Type naturally. /help for commands. /agent to pin routing. \\ for multiline.')
  ];
  return lines.join('\n');
}

export function renderRoutingControl(mode, { width = 100 } = {}) {
  const modes = Object.values(RoutingMode);
  const text = modes.map((item) => item === mode ? `[${item}]` : item).join(' ');
  return fit(text, Math.max(24, width));
}

export function renderStatusLine(view, { width = process.stdout.columns ?? 100 } = {}) {
  const pieces = [
    view.routingMode,
    view.model,
    `${view.tools} tools`,
    view.branch,
    `ctx ${estimateContext(view.tasks)}%`
  ];
  return colors.dim(fit(pieces.join(' │ '), Math.max(30, width)));
}

export function renderAgentsView(view) {
  const rows = ['AGENTS', ''];
  for (const agent of view.agents) {
    rows.push(agent.name);
    rows.push(`  status    ${agent.status.toLowerCase()}`);
    rows.push(`  role      ${agent.role}`);
    rows.push(`  provider  ${agent.provider}`);
    if (agent.detail) rows.push(`  detail    ${agent.detail}`);
    rows.push('');
  }
  rows.push('Pin routing with /agent auto|claude|codex|opencode|local or use @codex in a prompt.');
  return rows.join('\n').trimEnd();
}

export function renderTasksView(tasks) {
  const rows = ['TASKS', ''];
  if (!tasks.length) {
    rows.push('No session tasks yet.');
    return rows.join('\n');
  }
  for (const task of tasks.slice().reverse()) {
    rows.push(`${taskStatusSymbol(task.status)} #${task.id}  ${fit(task.title, 34)}  ${task.owner}`);
  }
  return rows.join('\n');
}

export function normalizeRoutingMode(value) {
  const upper = String(value ?? '').trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'OPEN' || upper === 'CODE') return RoutingMode.OPENCODE;
  return Object.values(RoutingMode).includes(upper) ? upper : null;
}

export function extractPromptTarget(text) {
  const match = String(text).trim().match(/^@(claude|codex|opencode|local)\b\s*(.*)$/i);
  if (!match) return { routingMode: null, text };
  return { routingMode: normalizeRoutingMode(match[1]), text: match[2].trim() };
}

export function applyRoutingMode(text, mode) {
  if (mode === RoutingMode.CLAUDE) return { text: `Ask Claude ${text}`, routeOverride: 'agent:claude', owner: 'Claude' };
  if (mode === RoutingMode.CODEX) return { text: `Ask Codex ${text}`, routeOverride: 'agent:codex', owner: 'Codex' };
  if (mode === RoutingMode.OPENCODE) return { text: `Ask OpenCode ${text}`, routeOverride: 'agent:opencode', owner: 'OpenCode' };
  if (mode === RoutingMode.LOCAL) return { text, routeOverride: 'local', owner: 'Local' };
  return { text, routeOverride: null, owner: 'AUTO' };
}

export function createTask(tasks, title, owner) {
  const task = {
    id: tasks.length ? Math.max(...tasks.map((item) => item.id)) + 1 : 1,
    title: title.replace(/\s+/g, ' ').slice(0, 80),
    owner,
    status: 'WORKING',
    startedAt: new Date().toISOString(),
    completedAt: null
  };
  tasks.push(task);
  return task;
}

export function finishTask(task, status) {
  if (!task) return;
  task.status = status;
  task.completedAt = new Date().toISOString();
}

function agentRows(rows, status, tasks = []) {
  const mapped = new Map(rows.map((agent) => [agent.id, agent]));
  const workingOwners = new Set(tasks.filter((task) => task.status === 'WORKING').map((task) => String(task.owner).toLowerCase()));
  const waitingOwners = new Set(tasks.filter((task) => task.status === 'WAITING').map((task) => String(task.owner).toLowerCase()));
  const errorOwners = new Set(tasks.filter((task) => task.status === 'ERROR').map((task) => String(task.owner).toLowerCase()));
  return [
    agentRow('local', 'Local', mapped.get('local'), { status, role: 'local model / fast answers', provider: status.provider, workingOwners, waitingOwners, errorOwners }),
    agentRow('claude', 'Claude', mapped.get('claude'), { role: 'architecture / reasoning', provider: 'Anthropic', workingOwners, waitingOwners, errorOwners }),
    agentRow('codex', 'Codex', mapped.get('codex'), { role: 'implementation / repository work', provider: 'OpenAI', workingOwners, waitingOwners, errorOwners }),
    agentRow('opencode', 'OpenCode', mapped.get('opencode'), { role: 'coding agent TUI/runtime', provider: 'OpenCode', workingOwners, waitingOwners, errorOwners })
  ];
}

function agentRow(id, name, row, fallback = {}) {
  const owner = name.toLowerCase();
  const taskState = fallback.workingOwners?.has(owner)
    ? 'WORKING'
    : fallback.waitingOwners?.has(owner)
      ? 'WAITING'
      : fallback.errorOwners?.has(owner)
        ? 'ERROR'
        : null;
  if (id === 'local') {
    return {
      id,
      name,
      status: taskState ?? (fallback.status?.model === 'none' ? 'OFFLINE' : 'READY'),
      role: fallback.role,
      provider: fallback.provider,
      detail: fallback.status?.model
    };
  }
  return {
    id,
    name,
    status: taskState ?? (row?.available ? 'READY' : 'OFFLINE'),
    role: fallback.role,
    provider: fallback.provider,
    detail: row?.detail ?? row?.version ?? ''
  };
}

function agentSymbol(status) {
  return status === 'READY' ? '●' : status === 'WORKING' ? '●' : '○';
}

function stateSymbol(status) {
  return status === 'READY' ? '●' : status === 'ERROR' ? '✕' : '●';
}

function taskStatusSymbol(status) {
  if (status === 'DONE') return '✓';
  if (status === 'ERROR') return '✕';
  return '●';
}

function estimateContext(tasks) {
  return Math.min(99, Math.max(0, Math.round(tasks.length * 3)));
}

function compactModel(model) {
  return String(model ?? 'none')
    .replace(/^qwen\//, '')
    .replace(/^lmstudio-local\//, '')
    .replace(/^models\//, '');
}

function compactHome(value) {
  const home = process.env.HOME;
  return home && value?.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function clampWidth(width) {
  return Math.max(58, Math.min(Number(width) || 100, 112));
}

function fit(value, width) {
  const text = String(value ?? '');
  if (text.length <= width) return text.padEnd(width);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function fill(char, count) {
  return char.repeat(Math.max(1, count));
}
