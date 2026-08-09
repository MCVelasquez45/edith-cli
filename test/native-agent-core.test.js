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
});
