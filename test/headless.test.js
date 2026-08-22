import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PassThrough } from 'node:stream';
import { parseRunArgs, exitCodeFor, runHeadless } from '../src/app/headless.js';
import { EdithState } from '../src/runtime/events.js';
import { discoverLocalProviders } from '../src/runtime/models.js';

function sink() {
  const stream = new PassThrough();
  let text = '';
  stream.on('data', (chunk) => { text += chunk; });
  return { stream, text: () => text };
}

function fakeRuntime({ result, startError = null, hooks = {} } = {}) {
  return {
    selection: { ref: 'ollama-local/qwen3-8b' },
    async start() { if (startError) throw startError; },
    async createSession() { return { id: 'session-1', agentName: 'edith-local' }; },
    async runTurn({ text, onEvent, requestApproval }) {
      hooks.prompt = text;
      for (const event of result.emit ?? []) onEvent(event);
      if (result.needsApproval) hooks.decision = await requestApproval({ toolCalls: [{ id: 't1', tool: 'delete_file' }] });
      return result;
    },
    async stop() { hooks.stopped = true; }
  };
}

describe('edith run argument parsing', () => {
  it('parses flags and joins positional prompt words', () => {
    const options = parseRunArgs(['--workspace', '/tmp/ws', '--model', 'qwen3:8b', '--json', '--approve-all', 'fix', 'the', 'tests']);
    assert.equal(options.workspace, '/tmp/ws');
    assert.equal(options.model, 'qwen3:8b');
    assert.equal(options.json, true);
    assert.equal(options.approveAll, true);
    assert.equal(options.prompt, 'fix the tests');
    assert.equal(options.error, null);
  });

  it('prefers --prompt over positionals and rejects unknown flags', () => {
    assert.equal(parseRunArgs(['--prompt', 'a', 'b']).prompt, 'a');
    assert.match(parseRunArgs(['--nope']).error, /Unknown flag/);
    assert.match(parseRunArgs(['--timeout', 'nope']).error, /positive number/);
    assert.match(parseRunArgs(['--timeout', '-3']).error, /positive number/);
  });

  it('defaults: deny gated approvals, 600s timeout, safe mode', () => {
    const options = parseRunArgs(['-p', 'x']);
    assert.equal(options.approveAll, false);
    assert.equal(options.strict, false);
    assert.equal(options.timeoutSeconds, 600);
  });
});

describe('edith run exit codes', () => {
  it('maps turn states to exit codes', () => {
    assert.equal(exitCodeFor({ state: EdithState.COMPLETED }), 0);
    assert.equal(exitCodeFor({ state: EdithState.FAILED }), 1);
    assert.equal(exitCodeFor({ state: EdithState.CANCELLED }), 124);
    assert.equal(exitCodeFor({ cancelled: true }), 124);
  });
});

describe('edith run headless execution', () => {
  it('prints the final answer to stdout and exits 0 on completion', async () => {
    const out = sink();
    const hooks = {};
    const code = await runHeadless({
      args: ['--prompt', 'say hi'],
      stdout: out.stream,
      stderr: sink().stream,
      stdin: { isTTY: true },
      createRuntime: () => fakeRuntime({ result: { state: EdithState.COMPLETED, text: 'hi there' }, hooks })
    });
    assert.equal(code, 0);
    assert.equal(out.text(), 'hi there\n');
    assert.equal(hooks.prompt, 'say hi');
    assert.equal(hooks.stopped, true);
  });

  it('emits JSONL events and a final result envelope with --json', async () => {
    const out = sink();
    const code = await runHeadless({
      args: ['--prompt', 'task', '--json'],
      stdout: out.stream,
      stderr: sink().stream,
      stdin: { isTTY: true },
      createRuntime: () => fakeRuntime({
        result: {
          state: EdithState.COMPLETED,
          text: 'done',
          emit: [{ type: 'tool-call', tool: 'read_file', state: 'TOOL_RUNNING' }, { type: 'done', state: 'COMPLETED' }]
        }
      })
    });
    assert.equal(code, 0);
    const lines = out.text().trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines[0].event, 'tool-call');
    assert.equal(lines[0].tool, 'read_file');
    const final = lines.at(-1);
    assert.equal(final.event, 'result');
    assert.equal(final.exitCode, 0);
    assert.equal(final.text, 'done');
    assert.equal(final.events.length, 2);
  });

  it('denies gated tools without --approve-all and approves with it', async () => {
    for (const [args, expected] of [[['--prompt', 'x'], false], [['--prompt', 'x', '--approve-all'], true]]) {
      const hooks = {};
      await runHeadless({
        args,
        stdout: sink().stream,
        stderr: sink().stream,
        stdin: { isTTY: true },
        createRuntime: () => fakeRuntime({ result: { state: EdithState.COMPLETED, text: 'ok', needsApproval: true }, hooks })
      });
      assert.equal(hooks.decision.approved, expected);
    }
  });

  it('exits 2 on usage errors and 1 on startup failure', async () => {
    const noPrompt = await runHeadless({
      args: [],
      stdout: sink().stream,
      stderr: sink().stream,
      stdin: { isTTY: true },
      createRuntime: () => fakeRuntime({ result: {} })
    });
    assert.equal(noPrompt, 2);

    const badStart = await runHeadless({
      args: ['--prompt', 'x'],
      stdout: sink().stream,
      stderr: sink().stream,
      stdin: { isTTY: true },
      createRuntime: () => fakeRuntime({ result: {}, startError: new Error('no provider') })
    });
    assert.equal(badStart, 1);
  });

  it('reads the prompt from piped stdin', async () => {
    const stdin = new PassThrough();
    stdin.isTTY = false;
    stdin.end('do the thing\n');
    const hooks = {};
    const code = await runHeadless({
      args: [],
      stdout: sink().stream,
      stderr: sink().stream,
      stdin,
      createRuntime: () => fakeRuntime({ result: { state: EdithState.COMPLETED, text: 'ok' }, hooks })
    });
    assert.equal(code, 0);
    assert.equal(hooks.prompt, 'do the thing');
  });
});

describe('generic OpenAI-compatible provider discovery', () => {
  it('registers EDITH_OPENAI_BASE_URL with an explicit model without probing', async () => {
    process.env.EDITH_OPENAI_BASE_URL = 'http://models.internal:9999/v1/';
    process.env.EDITH_OPENAI_MODEL = 'qwen3:8b';
    try {
      const providers = await discoverLocalProviders({
        fetchImpl: async () => { throw new Error('unreachable'); }
      });
      const generic = providers.find((p) => p.providerName === 'openai-compatible');
      assert.ok(generic, 'generic provider registered');
      assert.equal(generic.baseUrl, 'http://models.internal:9999/v1');
      assert.equal(generic.location, 'LOCAL');
      assert.equal(generic.apiKeyEnv, 'EDITH_OPENAI_API_KEY');
      assert.equal(generic.models[0].model_id, 'qwen3:8b');
    } finally {
      delete process.env.EDITH_OPENAI_BASE_URL;
      delete process.env.EDITH_OPENAI_MODEL;
    }
  });

  it('probes {base}/models when no explicit model is set', async () => {
    process.env.EDITH_OPENAI_BASE_URL = 'http://models.internal:9999/v1';
    try {
      const providers = await discoverLocalProviders({
        fetchImpl: async (url) => {
          if (String(url) === 'http://models.internal:9999/v1/models') {
            return { ok: true, json: async () => ({ data: [{ id: 'coder-x' }, { id: 'text-embed-1' }] }) };
          }
          throw new Error('unreachable');
        }
      });
      const generic = providers.find((p) => p.providerName === 'openai-compatible');
      assert.equal(generic.models.length, 1);
      assert.equal(generic.models[0].model_id, 'coder-x');
    } finally {
      delete process.env.EDITH_OPENAI_BASE_URL;
    }
  });
});
