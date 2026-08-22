import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { makeDelegateSpecialistTool } from '../src/agents/delegate-tool.js';

function fakeRegistry({ available = true, response = 'refactor complete', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    get(id) {
      if (!['claude', 'codex', 'opencode'].includes(id)) return null;
      return {
        id,
        name: `Fake ${id}`,
        health: async () => ({ available, detail: available ? 'ok' : 'not installed' }),
        sendTask: async (task, options) => {
          calls.push({ id, task, options });
          if (fail) throw new Error('specialist crashed');
          return { text: response };
        }
      };
    }
  };
}

test('specialist delegation tool', async (t) => {
  await t.test('delegates to an available specialist and returns its report', async () => {
    const registry = fakeRegistry();
    const tool = makeDelegateSpecialistTool({ workspace: '/w', z, registry });
    assert.equal(tool.safety, 'write');
    const result = await tool.handler({ agent: 'codex', task: 'Refactor the auth module for clarity.' });
    assert.match(result.content[0].text, /Fake codex report/);
    assert.match(result.content[0].text, /refactor complete/);
    assert.equal(registry.calls[0].options.cwd, '/w');
  });

  await t.test('reports unavailability with guidance instead of crashing the loop', async () => {
    const tool = makeDelegateSpecialistTool({ workspace: '/w', z, registry: fakeRegistry({ available: false }) });
    await assert.rejects(
      tool.handler({ agent: 'claude', task: 'Do a large multi-file refactor now.' }),
      /not available on this machine.*own tools/s
    );
  });

  await t.test('propagates specialist failures as tool errors', async () => {
    const tool = makeDelegateSpecialistTool({ workspace: '/w', z, registry: fakeRegistry({ fail: true }) });
    await assert.rejects(tool.handler({ agent: 'opencode', task: 'Try a task that will crash today.' }), /specialist crashed/);
  });
});
