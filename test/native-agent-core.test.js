import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EdithAgentCore } from '../src/native/agent-core.js';

describe('native agent routing', () => {
  it('does not mistake exact response prompts for model status questions', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route('Reply with exactly MODEL SWITCH OK').route, 'local');
    assert.equal(core.route('What model are you using?').route, 'status:model');
  });

  it('does not redelegate when discussing Codex recommendations', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route("What do YOU think about Codex's recommendation?").route, 'local');
    assert.equal(core.route('Ask Codex to review this.').route, 'agent:codex');
  });

  it('routes live system and environment requests to tools', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route('What time is it right now?').route, 'system:time');
    assert.equal(core.route('What time is it in California?').route, 'system:time');
    assert.equal(core.route('What day is it?').route, 'system:date');
    assert.equal(core.route('What timezone am I in?').route, 'system:timezone');
    assert.equal(core.route('What Git branch am I on?').route, 'workspace:branch');
    assert.equal(core.route('Can you search the web?').route, 'status:web');
    assert.equal(core.route('What agents can you use right now?').route, 'status:agents');
  });

  it('routes current external information and URLs to network tools', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route('What is the latest stable version of OpenCode right now?').route, 'network:search');
    assert.equal(core.route('Check the current OpenCode documentation for MCP servers.').route, 'network:docs');
    assert.equal(core.route('Read this page: https://opencode.ai/docs/cli/').route, 'network:fetch');
    assert.equal(core.route('Read this page: file:///etc/hosts').route, 'network:fetch');
    assert.equal(core.route('Explain what an MCP server is.').route, 'local');
    assert.equal(core.route('Does our current EDITH architecture match that?').route, 'workspace:repo');
  });
});
