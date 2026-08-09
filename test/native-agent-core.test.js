import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EdithAgentCore } from '../src/native/agent-core.js';

describe('native agent routing', () => {
  it('does not mistake exact response prompts for model status questions', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route('Reply with exactly MODEL SWITCH OK').route, 'local');
    assert.equal(core.route('What model are you using?').route, 'status:model');
  });

  it('keeps ordinary acknowledgements concise and routes explicit capability questions to live status', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route('ready').route, 'local:ack');
    assert.equal(core.route('hello').route, 'local:ack');
    assert.equal(core.route('What tools can you use?').route, 'status:tools');
    assert.equal(core.route('Can you modify my calendar?').route, 'status:permissions');
    assert.equal(core.route('Can you send email?').route, 'status:permissions');
  });

  it('keeps one finalized user turn paired with one assistant history entry', async () => {
    const core = new EdithAgentCore();
    await core.handleUserMessage('ready');

    assert.deepEqual(core.history, [
      { role: 'user', content: 'ready' },
      { role: 'assistant', content: 'Ready. What are we working on?' }
    ]);
  });

  it('reports live tool and write capabilities without using stale read-only claims', () => {
    const core = new EdithAgentCore();
    core.contextStatusRows = [{
      sourceType: 'calendar',
      health: 'CONNECTED',
      capabilities: ['calendars.read', 'events.read', 'events.create', 'events.update', 'events.delete']
    }];
    const tools = core.answerToolStatus();
    const permissions = core.answerPermissionStatus();

    assert.match(tools.text, /current_time/);
    assert.match(permissions.text, /available with explicit confirmation for calendar/i);
    assert.doesNotMatch(permissions.text, /read-only phase/i);

    core.router = {
      modelGroups: [],
      current: { model: { id: 'test-model' }, providerName: 'test-provider' }
    };
    core.workspaceInfo = { workspace: process.cwd() };
    core.authStatusRows = [];
    const prompt = core.systemPrompt();
    assert.match(prompt, /<internal_runtime_context>/);
    assert.match(prompt, /connected writes are confirmation-gated/);
    assert.doesNotMatch(prompt, /all read-only/i);
  });

  it('does not redelegate when discussing Codex recommendations', () => {
    const core = new EdithAgentCore();

    assert.equal(core.route("What do YOU think about Codex's recommendation?").route, 'local');
    assert.equal(core.route('Ask Codex to review this.').route, 'agent:codex');
    assert.equal(core.route('Ask Codex to inspect this repository and report risk.').route, 'agent:codex');
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

    assert.equal(core.route('whats the weather in mesa az').route, 'network:weather');
    assert.equal(core.route("What's today's forecast for Chandler, Arizona?").route, 'network:weather');
    assert.equal(core.route('Will it rain in Phoenix tomorrow?').route, 'network:weather');
    assert.equal(core.route("Don't search, just tell me today's weather in Mesa.").route, 'live:requires-tool');
    core.lastWeatherLocation = 'Mesa, Arizona, US';
    assert.equal(core.route('What about tomorrow?').route, 'network:weather');
    assert.equal(core.route('What is the latest stable version of OpenCode right now?').route, 'network:search');
    assert.equal(core.route('What is AAPL trading at?').route, 'network:search');
    assert.equal(core.route('Who won the game?').route, 'network:search');
    assert.equal(core.route('Check the current OpenCode documentation for MCP servers.').route, 'network:docs');
    assert.equal(core.route('Read this page: https://opencode.ai/docs/cli/').route, 'network:fetch');
    assert.equal(core.route('Read this page: file:///etc/hosts').route, 'network:fetch');
    assert.equal(core.route('Explain what an MCP server is.').route, 'local');
    assert.equal(core.route('What is Node.js?').route, 'local');
    assert.equal(core.route('What is OAuth?').route, 'local');
    assert.equal(core.route('Does our current EDITH architecture match that?').route, 'workspace:repo');
  });

  it('uses structured weather data and preserves follow-up location context', async () => {
    const core = new EdithAgentCore();
    const calls = [];
    core.network = {
      weather: async ({ location }) => {
        calls.push(location);
        return {
          provider: 'open-meteo',
          source: 'Open-Meteo',
          location: location.includes('Mesa') ? 'Mesa, Arizona, US' : location,
          timezone: 'America/Phoenix',
          retrievedAt: '2026-08-09T12:00:00.000Z',
          observedAt: '2026-08-09T05:00',
          current: { temperature: 101, feelsLike: 100, humidity: 20, conditions: 'Clear sky', windSpeed: 4 },
          daily: [
            { date: '2026-08-09', conditions: 'Clear sky', high: 108, low: 84, precipitationProbability: 5, precipitation: 0, windSpeedMax: 12 },
            { date: '2026-08-10', conditions: 'Partly cloudy', high: 106, low: 83, precipitationProbability: 15, precipitation: 0, windSpeedMax: 10 }
          ]
        };
      }
    };

    const current = await core.answerWeather('What is the weather in Mesa Arizona right now?', {});
    const followUp = await core.answerWeather('What about tomorrow?', {});

    assert.equal(current.route, 'network:weather');
    assert.match(current.text, /Right now in Mesa, Arizona, US/);
    assert.match(followUp.text, /2026-08-10 forecast for Mesa, Arizona, US/);
    assert.deepEqual(calls, ['Mesa Arizona', 'Mesa, Arizona, US']);
  });

  it('grounds weather capability and does not let weather failures become model-memory answers', async () => {
    const core = new EdithAgentCore();
    core.router = { modelGroups: [], current: { model: { id: 'test-model' }, providerName: 'test-provider' } };
    assert.match(core.capabilityManifest(), /weather/);

    core.network = { weather: async () => { throw new Error('provider offline'); } };
    core.toolRegistry.get('web_search').availability = 'UNAVAILABLE';
    const result = await core.answerWeather('What is the weather in Mesa right now?', {});

    assert.equal(result.route, 'network:weather');
    assert.match(result.text, /could not retrieve current weather data/i);
    assert.doesNotMatch(result.text, /do not have web access|cannot access/i);
  });

  it('stops pathological repeated model output while streaming', async () => {
    const core = new EdithAgentCore();
    const chunks = [
      'A robot heard a violin and paused to listen. ',
      'It began to play with its own body, each movement a note. ',
      'It began to play with its own body, each movement a note. ',
      'It began to play with its own body, each movement a note. '
    ];
    core.router = {
      modelGroups: [],
      current: { model: { id: 'test-model' }, providerName: 'test-provider' },
      stream: async () => (async function* stream() {
        for (const chunk of chunks) yield chunk;
      })()
    };
    core.workspaceInfo = { workspace: process.cwd() };
    core.agentHealth = [];
    core.contextStatusRows = [];
    core.authStatusRows = [];
    const streamed = [];
    const result = await core.answerLocal('Tell a short story', '', {
      streamStart: () => {},
      streamChunk: (chunk) => streamed.push(chunk),
      streamEnd: () => {}
    });

    assert.match(result.text, /robot heard a violin/);
    assert.equal((result.text.match(/It began to play/g) ?? []).length, 1);
    assert.equal((streamed.join('').match(/It began to play/g) ?? []).length, 1);
    assert.match(result.text, /[.!?…]$/);
  });

  it('preserves the first streamed delta exactly', async () => {
    const core = new EdithAgentCore();
    core.router = {
      modelGroups: [],
      current: { model: { id: 'test-model' }, providerName: 'test-provider' },
      stream: async () => (async function* stream() {
        yield 'Ready.';
        yield ' What are we working on?';
      })()
    };
    core.workspaceInfo = { workspace: process.cwd() };
    core.agentHealth = [];
    core.contextStatusRows = [];
    core.authStatusRows = [];
    const streamed = [];
    const result = await core.answerLocal('Say hello', '', {
      streamStart: () => {},
      streamChunk: (chunk) => streamed.push(chunk),
      streamEnd: () => {}
    });

    assert.equal(streamed.join(''), 'Ready. What are we working on?');
    assert.equal(result.text, 'Ready. What are we working on?');
  });

  it('routes calendar-email correlation to personal context tools', () => {
    const core = new EdithAgentCore();
    assert.equal(core.route('Is there any email related to my next calendar event?').route, 'context:calendar-email');
    assert.equal(core.route('Is there any email related to my next EDITH CROSS SOURCE TEST event?').route, 'context:calendar-email');
  });
});
