import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isBlockedIp } from '../src/network/policy.js';
import {
  OfficialSourceSearchProvider,
  DirectFetchProvider,
  DuckDuckGoHtmlSearchProvider,
  OpenMeteoWeatherProvider,
  SearchProviderRegistry,
  classifySearchMode,
  parseDuckDuckGoHtml
} from '../src/network/providers.js';

describe('network policy', () => {
  it('blocks localhost, private IPs, metadata, and non-http URLs', async () => {
    await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/'), /Blocked/);
    await assert.rejects(() => assertPublicHttpUrl('http://localhost/'), /Blocked/);
    await assert.rejects(() => assertPublicHttpUrl('file:///etc/hosts'), /Blocked URL protocol/);
    await assert.rejects(() => assertPublicHttpUrl('http://169.254.169.254/'), /Blocked/);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('8.8.8.8'), false);
  });

  it('blocks DNS records that resolve to private addresses', async () => {
    await assert.rejects(
      () => assertPublicHttpUrl('https://example.com/', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
      /Blocked unsafe resolved address/
    );
  });
});

describe('network providers', () => {
  it('returns official OpenCode release and docs results without credentials', async () => {
    const provider = new OfficialSourceSearchProvider();

    const release = await provider.search({ query: 'latest OpenCode release' });
    const docs = await provider.search({ query: 'current OpenCode MCP documentation' });

    assert.ok(release.some((item) => item.url.includes('api.github.com/repos/anomalyco/opencode/releases/latest')));
    assert.ok(docs.some((item) => item.url.includes('opencode.ai/docs/mcp-servers')));
  });

  it('rejects unsafe fetch destinations before network access', async () => {
    const fetcher = new DirectFetchProvider();

    await assert.rejects(() => fetcher.fetch({ url: 'http://localhost/' }), /Blocked/);
    await assert.rejects(() => fetcher.fetch({ url: 'file:///etc/hosts' }), /Blocked URL protocol/);
  });

  it('rejects redirects to unsafe destinations', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 302,
      headers: { get: (name) => name.toLowerCase() === 'location' ? 'http://127.0.0.1/' : null }
    });
    try {
      await assert.rejects(() => new DirectFetchProvider().fetch({ url: 'https://example.com/' }), /Blocked unsafe IP address/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses DuckDuckGo HTML results into normalized search results', async () => {
    const html = `
      <div class="result">
        <div>
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpost%3Futm_source%3Dx">Local-first AI tools</a>
          <a class="result__snippet">A useful result about local AI coding.</a>
        </div>
      </div>
    `;
    const parsed = parseDuckDuckGoHtml(html);
    assert.equal(parsed[0].title, 'Local-first AI tools');
    assert.equal(parsed[0].url, 'https://example.com/post?utm_source=x');
    assert.match(parsed[0].snippet, /local AI coding/);
  });

  it('supports a no-key general web search provider', async () => {
    const provider = new DuckDuckGoHtmlSearchProvider({
      fetchImpl: async () => new Response(`
        <div class="result"><div>
          <a class="result__a" href="https://example.com/a">General result</a>
          <div class="result__snippet">General web snippet</div>
        </div></div>
      `, { status: 200, headers: { 'content-type': 'text/html' } })
    });
    const results = await provider.search({ query: 'Search the web for local-first AI coding assistants', maxResults: 2 });
    assert.equal(results[0].provider, 'duckduckgo-html');
    assert.equal(results[0].resultType, 'general');
  });

  it('falls back across configured search providers', async () => {
    const primary = { id: 'primary', name: 'Primary', search: async () => { throw new Error('offline'); } };
    const secondary = {
      id: 'secondary',
      name: 'Secondary',
      search: async () => [{ title: 'Fallback result', url: 'https://example.com/fallback', snippet: '', provider: 'secondary' }]
    };
    const registry = new SearchProviderRegistry({ providers: [primary, secondary] });
    const results = await registry.search({ query: 'latest local AI tooling', maxResults: 1 });
    assert.equal(results[0].title, 'Fallback result');
  });

  it('does not answer community searches from official documentation fallback', async () => {
    const official = new OfficialSourceSearchProvider();
    const registry = new SearchProviderRegistry({ providers: [official], officialProvider: official });
    const results = await registry.search({ query: 'What are developers saying about OpenCode?', mode: 'COMMUNITY', maxResults: 3 });
    assert.deepEqual(results, []);
  });

  it('ranks fetchable current sources ahead of Google News aggregators', async () => {
    const registry = new SearchProviderRegistry({
      providers: [{
        id: 'mock',
        name: 'Mock',
        search: async () => [
          { title: 'Google News - Artificial intelligence - Latest', url: 'https://news.google.com/topics/abc', snippet: 'latest', provider: 'mock' },
          { title: 'The Future of Local AI: Trends and Innovations', url: 'https://dockyard.com/blog/local-ai', snippet: 'local AI trends', provider: 'mock' }
        ]
      }]
    });
    const results = await registry.search({ query: 'latest developments in local AI', mode: 'CURRENT', maxResults: 2 });
    assert.equal(results[0].url, 'https://dockyard.com/blog/local-ai');
  });

  it('classifies search intent into specific modes', () => {
    assert.equal(classifySearchMode('What are developers saying about OpenCode?'), 'COMMUNITY');
    assert.equal(classifySearchMode('What is happening in AI today?'), 'CURRENT');
    assert.equal(classifySearchMode('Check the current LM Studio API docs'), 'DOCUMENTATION');
    assert.equal(classifySearchMode('Search the web for local AI tools'), 'GENERAL');
  });

  it('normalizes Open-Meteo weather responses', async () => {
    const provider = new OpenMeteoWeatherProvider({
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('geocoding-api.open-meteo.com')) {
          return Response.json({
            results: [{ name: 'Mesa', admin1: 'Arizona', country_code: 'US', latitude: 33.4152, longitude: -111.8315, timezone: 'America/Phoenix' }]
          });
        }
        return Response.json({
          timezone: 'America/Phoenix',
          current: {
            time: '2026-08-09T10:00',
            temperature_2m: 101.4,
            apparent_temperature: 100.2,
            relative_humidity_2m: 18,
            weather_code: 0,
            wind_speed_10m: 5.5
          },
          daily: {
            time: ['2026-08-09', '2026-08-10'],
            weather_code: [0, 2],
            temperature_2m_max: [108.1, 106.2],
            temperature_2m_min: [84.2, 82.8],
            precipitation_probability_max: [3, 20],
            precipitation_sum: [0, 0],
            wind_speed_10m_max: [11, 13]
          }
        });
      }
    });

    const weather = await provider.getWeather({ location: 'Mesa AZ', days: 2 });
    assert.equal(weather.location, 'Mesa, Arizona, US');
    assert.equal(weather.current.conditions, 'Clear sky');
    assert.equal(weather.current.temperature, 101.4);
    assert.equal(weather.daily[1].conditions, 'Partly cloudy');
  });
});

// Regex-router failure/routing cases retired with EdithAgentCore; live-data
// behavior now flows through the TrueForge agent loop and its tools.
