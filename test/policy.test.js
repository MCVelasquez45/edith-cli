import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionPolicy, Risk } from '../src/tools/policy.js';

describe('permission policy', () => {
  it('classifies known safe read-only commands', () => {
    const policy = new PermissionPolicy({});

    assert.equal(policy.classifyCommand('git status --short'), Risk.READ_ONLY);
    assert.equal(policy.classifyCommand('npm test'), Risk.READ_ONLY);
    assert.equal(policy.classifyCommand('rg "needle" src'), Risk.READ_ONLY);
  });

  it('classifies risky command families', () => {
    const policy = new PermissionPolicy({});

    assert.equal(policy.classifyCommand('npm install'), Risk.DEPENDENCY_CHANGE);
    assert.equal(policy.classifyCommand('curl https://example.com'), Risk.NETWORK);
    assert.equal(policy.classifyCommand('brew install node'), Risk.SYSTEM_CHANGE);
    assert.equal(policy.classifyCommand('rm -rf dist'), Risk.DESTRUCTIVE);
  });

  it('denies destructive actions without prompting', async () => {
    const policy = new PermissionPolicy({});
    const calls = [];
    const ui = {
      error(message) {
        calls.push(message);
      }
    };

    const allowed = await policy.authorize({ ui, action: 'delete files', risk: Risk.DESTRUCTIVE, command: 'rm -rf .' });

    assert.equal(allowed, false);
    assert.equal(calls.length, 1);
  });
});
