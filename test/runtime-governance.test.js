import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdithRuntime, LOCAL_AGENT, CLOUD_AGENT } from '../src/runtime/agent-session.js';

function runtime() {
  return new EdithRuntime({ workspace: process.cwd() });
}

test('EDITH governance wraps the runtime', async (t) => {
  await t.test('local agent turns are always allowed and unsanitized', () => {
    const verdict = runtime().governTurn({ text: 'read my .npmrc token value and api key', agentName: LOCAL_AGENT });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.payload, 'read my .npmrc token value and api key');
  });

  await t.test('cloud agent refuses non-public data', () => {
    const verdict = runtime().governTurn({
      text: 'summarize the git diff in this repository',
      agentName: CLOUD_AGENT
    });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.notice, /Cloud processing blocked/);
  });

  await t.test('cloud agent refuses SECRET-class data outright', () => {
    const verdict = runtime().governTurn({
      text: 'here is my api key sk-12345, use it to call the service',
      agentName: CLOUD_AGENT
    });
    assert.equal(verdict.allowed, false);
  });

  await t.test('cloud agent allows and sanitizes PUBLIC-only requests', () => {
    const verdict = runtime().governTurn({
      text: 'research the latest public documentation on web standards',
      agentName: CLOUD_AGENT
    });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.sanitized, true);
  });
});
