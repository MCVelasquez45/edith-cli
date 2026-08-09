import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoutingMode,
  applyRoutingMode,
  cockpitViewModel,
  createTask,
  extractPromptTarget,
  finishTask,
  normalizeRoutingMode,
  renderAgentsView,
  renderStartupCockpit,
  renderStatusLine,
  renderTasksView
} from '../src/native/cockpit-view.js';

describe('native cockpit view model', () => {
  it('renders compact startup cockpit across common terminal widths', () => {
    const view = cockpitViewModel(fakeCore(), { routingMode: RoutingMode.AUTO, tasks: [] });
    for (const width of [80, 100, 120, 160]) {
      const output = renderStartupCockpit(view, { width });
      assert.match(output, /EDITH/);
      assert.match(output, /LOCAL ORCHESTRATOR/);
      assert.match(output, /\[AUTO\]/);
      assert.match(output, /Codex/);
      for (const line of output.split('\n')) assert.ok(stripAnsi(line).length <= Math.max(112, width));
    }
  });

  it('renders active routing and status line without overflowing narrow terminals', () => {
    const view = cockpitViewModel(fakeCore(), { routingMode: RoutingMode.CODEX, tasks: [] });
    const status = renderStatusLine(view, { width: 80 });
    assert.match(status, /CODEX/);
    assert.match(renderStartupCockpit(view, { width: 80 }), /\[CODEX\]/);
    assert.ok(stripAnsi(status).length <= 80);
  });

  it('maps prompt targets and pinned routing to route overrides', () => {
    assert.equal(normalizeRoutingMode('code'), RoutingMode.OPENCODE);
    assert.deepEqual(extractPromptTarget('@codex review this'), { routingMode: RoutingMode.CODEX, text: 'review this' });
    assert.deepEqual(applyRoutingMode('review this', RoutingMode.CODEX), {
      text: 'Ask Codex review this',
      routeOverride: 'agent:codex',
      owner: 'Codex'
    });
    assert.deepEqual(applyRoutingMode('answer this', RoutingMode.LOCAL), {
      text: 'answer this',
      routeOverride: 'local',
      owner: 'Local'
    });
  });

  it('renders agent management view with ready, working, waiting, error, and offline states', () => {
    const tasks = [
      { id: 1, title: 'review', owner: 'Codex', status: 'WORKING' },
      { id: 2, title: 'authorize', owner: 'OpenCode', status: 'WAITING' },
      { id: 3, title: 'answer', owner: 'Local', status: 'ERROR' }
    ];
    const view = cockpitViewModel(fakeCore({ claudeAvailable: false }), { routingMode: RoutingMode.AUTO, tasks });
    const output = renderAgentsView(view);
    assert.match(output, /Claude\n  status    offline/);
    assert.match(output, /Codex\n  status    working/);
    assert.match(output, /OpenCode\n  status    waiting/);
    assert.match(output, /Local\n  status    error/);
  });

  it('renders real session tasks without fake persistence', () => {
    const tasks = [];
    assert.match(renderTasksView(tasks), /No session tasks yet/);
    const first = createTask(tasks, 'Fix authentication tests', 'Codex');
    finishTask(first, 'DONE');
    const second = createTask(tasks, 'Inspect repository', 'Local');
    finishTask(second, 'ERROR');
    const output = renderTasksView(tasks);
    assert.match(output, /✓ #1\s+Fix authentication tests/);
    assert.match(output, /✕ #2\s+Inspect repository/);
  });
});

function fakeCore({ claudeAvailable = true } = {}) {
  return {
    agentHealth: [
      { id: 'claude', name: 'Claude', available: claudeAvailable, version: 'Claude Code' },
      { id: 'codex', name: 'Codex', available: true, version: 'codex-cli' },
      { id: 'opencode', name: 'OpenCode', available: true, version: '1.18.15' }
    ],
    status: () => ({
      model: 'qwen/qwen3-vl-4b',
      provider: 'LM Studio',
      cwd: '/Users/markvelasquez/orca/edith-cli',
      workspace: '/Users/markvelasquez/orca/edith-cli',
      branch: 'main',
      toolsReady: 22
    })
  };
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
