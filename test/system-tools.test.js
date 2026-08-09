import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SystemTools, extractTimezoneRequest } from '../src/native/system-tools.js';

describe('native system tools', () => {
  it('returns current local time from the runtime clock', () => {
    const tools = new SystemTools();
    const result = tools.currentTime();

    assert.equal(result.tool, 'current_time');
    assert.equal(result.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.match(result.output, /\d/);
  });

  it('resolves California and New York timezone requests', () => {
    assert.equal(extractTimezoneRequest('What time is it in California?'), 'America/Los_Angeles');
    assert.equal(extractTimezoneRequest('What time is it in New York?'), 'America/New_York');
  });

  it('reports the local timezone and system info', () => {
    const tools = new SystemTools();

    assert.equal(tools.timezone().output, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.match(tools.systemInfo().output, /platform:/);
  });
});
