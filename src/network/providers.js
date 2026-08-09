import { assertPublicHttpUrl } from './policy.js';

const FETCH_TIMEOUT_MS = 12000;
const MAX_DOWNLOAD_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 24000;
const MAX_REDIRECTS = 4;

const OFFICIAL_DOCS = [
  {
    match: /opencode/i,
    docs: [
      { title: 'OpenCode CLI documentation', url: 'https://opencode.ai/docs/cli/' },
      { title: 'OpenCode MCP servers documentation', url: 'https://opencode.ai/docs/mcp-servers/' },
      { title: 'OpenCode configuration documentation', url: 'https://opencode.ai/docs/config/' }
    ],
    releases: [{ title: 'OpenCode latest GitHub release', url: 'https://api.github.com/repos/anomalyco/opencode/releases/latest' }]
  },
  {
    match: /lm\s*studio/i,
    docs: [{ title: 'LM Studio documentation', url: 'https://lmstudio.ai/docs' }]
  },
  {
    match: /ollama/i,
    docs: [
      { title: 'Ollama API documentation', url: 'https://docs.ollama.com/api' },
      { title: 'Ollama tool calling documentation', url: 'https://docs.ollama.com/capabilities/tool-calling' }
    ]
  },
  {
    match: /\bmcp\b|model context protocol/i,
    docs: [
      { title: 'Model Context Protocol documentation', url: 'https://modelcontextprotocol.io/docs' },
      { title: 'MCP TypeScript SDK', url: 'https://github.com/modelcontextprotocol/typescript-sdk' }
    ]
  }
];

export class NetworkRegistry {
  constructor({ searchProvider = null, fetchProvider = new DirectFetchProvider(), docsProvider = null, weatherProvider = new OpenMeteoWeatherProvider() } = {}) {
    searchProvider ??= createDefaultSearchProvider();
    this.searchProvider = searchProvider;
    this.fetchProvider = fetchProvider;
    this.docsProvider = docsProvider ?? new DocumentationProvider({ searchProvider, fetchProvider });
    this.weatherProvider = weatherProvider;
  }

  async search(input) {
    return this.searchProvider.search(input);
  }

  async fetch(input) {
    return this.fetchProvider.fetch(input);
  }

  async lookupDocs(input) {
    return this.docsProvider.lookup(input);
  }

  async weather(input) {
    return this.weatherProvider.getWeather(input);
  }

  status() {
    return {
      search: this.searchProvider.status?.() ?? [{ id: this.searchProvider.id, name: this.searchProvider.name, configured: this.searchProvider.configured !== false }],
      fetch: { id: this.fetchProvider.id, name: this.fetchProvider.name, configured: true },
      docs: { id: this.docsProvider.id, name: this.docsProvider.name, configured: true },
      weather: { id: this.weatherProvider.id, name: this.weatherProvider.name, configured: this.weatherProvider.configured !== false }
    };
  }
}

export function createDefaultSearchProvider() {
  return new SearchProviderRegistry({
    providers: [
      ...(process.env.BRAVE_SEARCH_API_KEY ? [new BraveSearchProvider({ apiKey: process.env.BRAVE_SEARCH_API_KEY })] : []),
      ...(process.env.EDITH_SEARXNG_URL ? [new SearxngSearchProvider({ baseUrl: process.env.EDITH_SEARXNG_URL })] : []),
      new DuckDuckGoHtmlSearchProvider(),
      new OfficialSourceSearchProvider()
    ],
    officialProvider: new OfficialSourceSearchProvider()
  });
}

export class SearchProviderRegistry {
  id = 'search-registry';
  name = 'Search Provider Registry';

  constructor({ providers, officialProvider = new OfficialSourceSearchProvider() }) {
    this.providers = providers;
    this.officialProvider = officialProvider;
  }

  async search({ query, maxResults = 5, mode = 'GENERAL', domains = [], recency = null }) {
    const requestedMode = !mode || mode === 'AUTO' ? classifySearchMode(query) : mode;
    const providers = this.providersForMode(requestedMode);
    const errors = [];
    for (const provider of providers) {
      try {
        const results = await provider.search({ query, maxResults: maxResults * 2, mode: requestedMode, domains, recency });
        const normalized = rankResults(dedupeResults(results), requestedMode, query).slice(0, maxResults);
        if (normalized.length) return normalized;
      } catch (error) {
        errors.push(`${provider.id}: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(`All search providers failed: ${errors.join('; ')}`);
    return [];
  }

  providersForMode(mode) {
    if (mode === 'OFFICIAL' || mode === 'DOCUMENTATION') return [this.officialProvider, ...this.providers.filter((provider) => provider.id !== this.officialProvider.id)];
    if (mode === 'COMMUNITY') return this.providers.filter((provider) => provider.id !== this.officialProvider.id);
    return this.providers;
  }

  status() {
    return this.providers.map((provider) => ({ id: provider.id, name: provider.name, configured: provider.configured !== false }));
  }
}

export class OfficialSourceSearchProvider {
  id = 'official-source';
  name = 'Official Source Search';

  async search({ query, maxResults = 5, domains = [] }) {
    if (!query) throw new Error('web_search requires query');
    const results = [];
    for (const source of OFFICIAL_DOCS) {
      if (!source.match.test(query)) continue;
      const wantsRelease = /\b(latest|release|version|recent|what changed|changelog)\b/i.test(query);
      const wantsDocs = /\b(doc|documentation|mcp|api|sdk|configure|config|tool)\b/i.test(query);
      if (wantsRelease && source.releases) results.push(...source.releases.map((item) => normalizeResult(item, this.id)));
      if (wantsDocs || !wantsRelease) results.push(...source.docs.map((item) => normalizeResult(item, this.id)));
    }
    const filtered = domains.length ? results.filter((result) => domains.some((domain) => new URL(result.url).hostname.endsWith(domain))) : results;
    return filtered.slice(0, maxResults);
  }
}

export class BraveSearchProvider {
  id = 'brave';
  name = 'Brave Search API';
  configured = true;

  constructor({ apiKey, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async search({ query, maxResults = 5, mode = 'GENERAL', recency = null }) {
    if (!this.apiKey) throw new Error('Brave Search API key is not configured.');
    const endpoint = mode === 'CURRENT' || mode === 'NEWS'
      ? 'https://api.search.brave.com/res/v1/news/search'
      : 'https://api.search.brave.com/res/v1/web/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(maxResults, 20)));
    if (recency) url.searchParams.set('freshness', recency);
    const response = await this.fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': this.apiKey } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.message || `Brave search failed: HTTP ${response.status}`);
    const rows = json.web?.results ?? json.results ?? [];
    return rows.map((item) => normalizeResult({
      title: item.title,
      url: item.url,
      snippet: item.description,
      publishedAt: item.age ?? item.page_age ?? null,
      resultType: mode.toLowerCase()
    }, this.id));
  }
}

export class SearxngSearchProvider {
  id = 'searxng';
  name = 'SearXNG Search';
  configured = true;

  constructor({ baseUrl, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async search({ query, maxResults = 5, mode = 'GENERAL' }) {
    if (!this.baseUrl) throw new Error('SearXNG URL is not configured.');
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', searchQueryForMode(query, mode));
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    const response = await this.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'EDITH/0.1' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.message || `SearXNG search failed: HTTP ${response.status}`);
    return (json.results ?? []).slice(0, maxResults).map((item) => normalizeResult({
      title: item.title,
      url: item.url,
      snippet: item.content,
      publishedAt: item.publishedDate ?? null,
      resultType: mode.toLowerCase()
    }, this.id));
  }
}

export class DuckDuckGoHtmlSearchProvider {
  id = 'duckduckgo-html';
  name = 'DuckDuckGo HTML Search';
  configured = true;

  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async search({ query, maxResults = 5, mode = 'GENERAL' }) {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', searchQueryForMode(query, mode));
    const response = await this.fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 EDITH/0.1' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
    return parseDuckDuckGoHtml(html).slice(0, maxResults).map((item) => normalizeResult({ ...item, resultType: mode.toLowerCase() }, this.id));
  }
}

export class DocumentationProvider {
  id = 'official-docs';
  name = 'Official Documentation Lookup';

  constructor({ searchProvider, fetchProvider }) {
    this.searchProvider = searchProvider;
    this.fetchProvider = fetchProvider;
  }

  async lookup({ query, maxResults = 3 }) {
    const results = await this.searchProvider.search({ query, maxResults, mode: 'DOCUMENTATION' });
    const docs = [];
    for (const result of results) {
      if (!/docs|documentation|github\.com/.test(result.url)) continue;
      const fetched = await this.fetchProvider.fetch({ url: result.url });
      docs.push({ ...result, fetched });
      if (docs.length >= maxResults) break;
    }
    return docs;
  }
}

export class OpenMeteoWeatherProvider {
  id = 'open-meteo';
  name = 'Open-Meteo Weather API';
  configured = true;

  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async getWeather({ location, days = 3 } = {}) {
    const query = normalizeLocationQuery(location);
    if (!query) throw new Error('weather requires a location');
    const place = await this.geocode(query);
    const forecast = await this.forecast(place, days);
    return normalizeWeather({ place, forecast, provider: this.id });
  }

  async geocode(query) {
    for (const attempt of geocodeAttempts(query)) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', attempt);
      url.searchParams.set('count', '5');
      url.searchParams.set('language', 'en');
      url.searchParams.set('format', 'json');
      const response = await this.fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'EDITH/0.1 weather' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.reason || `Open-Meteo geocoding failed: HTTP ${response.status}`);
      const results = json.results ?? [];
      if (results.length) return bestGeocodeResult(results, query);
    }
    throw new Error(`No weather location matched "${query}"`);
  }

  async forecast(place, days) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(place.latitude));
    url.searchParams.set('longitude', String(place.longitude));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
    url.searchParams.set('forecast_days', String(Math.min(Math.max(Number(days) || 3, 1), 7)));
    url.searchParams.set('current', [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'rain',
      'showers',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m'
    ].join(','));
    url.searchParams.set('daily', [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_speed_10m_max'
    ].join(','));
    const response = await this.fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'EDITH/0.1 weather' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.reason || `Open-Meteo forecast failed: HTTP ${response.status}`);
    return json;
  }
}

export class DirectFetchProvider {
  id = 'direct-fetch';
  name = 'Direct Public HTTP Fetch';

  async fetch({ url }) {
    let current = await assertPublicHttpUrl(url);
    const seen = [];
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      seen.push(current.href);
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'EDITH/0.1 network-awareness' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (isRedirect(res.status)) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`Redirect missing Location header from ${current.href}`);
        current = await assertPublicHttpUrl(new URL(location, current).href);
        continue;
      }
      if (!res.ok) throw new Error(`Fetch failed for ${current.href}: HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      if (!isAllowedContentType(contentType)) throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
      const raw = await readLimited(res);
      const text = extractText(raw, contentType).slice(0, MAX_TEXT_CHARS);
      return {
        url: current.href,
        finalUrl: current.href,
        title: extractTitle(raw) ?? current.hostname,
        contentType,
        text,
        truncated: raw.length >= MAX_DOWNLOAD_BYTES || text.length >= MAX_TEXT_CHARS,
        retrievedAt: new Date().toISOString(),
        redirects: seen
      };
    }
    throw new Error(`Too many redirects while fetching ${url}`);
  }
}

function normalizeResult(item, source) {
  return {
    title: item.title,
    url: item.url,
    snippet: item.snippet ?? '',
    source,
    provider: source,
    publishedAt: item.publishedAt ?? null,
    retrievedAt: new Date().toISOString(),
    resultType: item.resultType ?? 'general'
  };
}

function normalizeLocationQuery(location) {
  return String(location ?? '')
    .replace(/[?.!]+$/g, '')
    .replace(/\bweather\b|\bforecast\b|\btemperature\b|\bconditions\b|\bright now\b|\btoday\b|\btomorrow\b|\bwill it rain\b|\bwhat'?s\b|\bwhat is\b|\bin\b/gi, ' ')
    .replace(/\baz\b/gi, 'Arizona')
    .replace(/\bca\b/gi, 'California')
    .replace(/\bny\b/gi, 'New York')
    .replace(/\s+/g, ' ')
    .trim();
}

function geocodeAttempts(query) {
  const attempts = [query];
  const withoutState = query
    .replace(/,\s*(Arizona|California|New York|Texas|Florida|Nevada|Utah|Colorado|Washington|Oregon)$/i, '')
    .replace(/\b(Arizona|California|New York|Texas|Florida|Nevada|Utah|Colorado|Washington|Oregon)\b$/i, '')
    .trim();
  if (withoutState && withoutState !== query) attempts.push(withoutState);
  const commaCity = query.split(',')[0]?.trim();
  if (commaCity && !attempts.includes(commaCity)) attempts.push(commaCity);
  return attempts;
}

function bestGeocodeResult(results, query) {
  const normalizedQuery = query.toLowerCase();
  const stateHints = [
    ['arizona', 'Arizona'],
    ['california', 'California'],
    ['new york', 'New York']
  ];
  const hintedState = stateHints.find(([hint]) => normalizedQuery.includes(hint))?.[1];
  if (hintedState) {
    const stateMatch = results.find((item) => item.admin1?.toLowerCase() === hintedState.toLowerCase());
    if (stateMatch) return stateMatch;
  }
  const usMatch = results.find((item) => item.country_code === 'US');
  return usMatch ?? results[0];
}

function normalizeWeather({ place, forecast, provider }) {
  const current = forecast.current ?? {};
  const daily = forecast.daily ?? {};
  return {
    provider,
    source: 'Open-Meteo',
    location: [place.name, place.admin1, place.country_code].filter(Boolean).join(', '),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: forecast.timezone ?? place.timezone ?? null,
    retrievedAt: new Date().toISOString(),
    observedAt: current.time ?? null,
    current: {
      temperature: numberOrNull(current.temperature_2m),
      feelsLike: numberOrNull(current.apparent_temperature),
      humidity: numberOrNull(current.relative_humidity_2m),
      conditions: weatherCodeLabel(current.weather_code),
      windSpeed: numberOrNull(current.wind_speed_10m),
      windDirection: numberOrNull(current.wind_direction_10m),
      precipitation: numberOrNull(current.precipitation),
      rain: numberOrNull(current.rain),
      showers: numberOrNull(current.showers)
    },
    daily: (daily.time ?? []).map((date, index) => ({
      date,
      conditions: weatherCodeLabel(daily.weather_code?.[index]),
      high: numberOrNull(daily.temperature_2m_max?.[index]),
      low: numberOrNull(daily.temperature_2m_min?.[index]),
      precipitationProbability: numberOrNull(daily.precipitation_probability_max?.[index]),
      precipitation: numberOrNull(daily.precipitation_sum?.[index]),
      windSpeedMax: numberOrNull(daily.wind_speed_10m_max?.[index])
    }))
  };
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function weatherCodeLabel(code) {
  const labels = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  };
  return labels[Number(code)] ?? 'Unknown conditions';
}

export function classifySearchMode(query) {
  if (/\b(doc|documentation|api|sdk|reference)\b/i.test(query)) return 'DOCUMENTATION';
  if (/\b(official|current docs|endpoint|configuration)\b/i.test(query)) return 'OFFICIAL';
  if (/\b(reddit|forum|discussion|developers saying|people saying|community|compare|versus|vs\.?)\b/i.test(query)) return 'COMMUNITY';
  if (/\b(latest|today|this week|recent|news|happening|posted this week|current)\b/i.test(query)) return 'CURRENT';
  return 'GENERAL';
}

function searchQueryForMode(query, mode) {
  if (mode === 'COMMUNITY' && !/\b(reddit|github discussions|forum)\b/i.test(query)) return `${query} reddit github discussions forum`;
  if (mode === 'CURRENT' && !/\b(latest|recent|today|this week|2026)\b/i.test(query)) return `${query} latest recent`;
  return query;
}

export function dedupeResults(results) {
  const seen = new Set();
  const out = [];
  for (const result of results) {
    if (!result?.url) continue;
    const key = canonicalUrl(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

function rankResults(results, mode, query) {
  return [...results].sort((a, b) => scoreResult(b, mode, query) - scoreResult(a, mode, query));
}

function scoreResult(result, mode, query) {
  let score = 0;
  const host = hostname(result.url);
  if (/news\.google\.com/.test(host)) score -= 20;
  if (/^google news\b/i.test(result.title ?? '')) score -= 10;
  if (result.provider === 'official-source') score += 20;
  if (mode === 'DOCUMENTATION' || mode === 'OFFICIAL') {
    if (/docs|documentation|developer|github\.com|opencode\.ai|lmstudio\.ai|ollama\.com|modelcontextprotocol\.io/.test(host)) score += 12;
  }
  if (mode === 'COMMUNITY') {
    if (/reddit\.com|news\.ycombinator\.com|github\.com|lobste\.rs|stackoverflow\.com|discord|forum/.test(host)) score += 12;
  }
  if (mode === 'CURRENT' && result.publishedAt) score += 8;
  const queryTerms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
  const haystack = `${result.title ?? ''} ${result.snippet ?? ''} ${host}`.toLowerCase();
  score += queryTerms.filter((term) => haystack.includes(term)).length;
  return score;
}

function hostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

function canonicalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function parseDuckDuckGoHtml(html) {
  const results = [];
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) ?? [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    results.push({
      title: cleanHtml(link[2]),
      url: decodeDuckDuckGoUrl(link[1]),
      snippet: cleanHtml(snippet?.[1] ?? '')
    });
  }
  return results;
}

function decodeDuckDuckGoUrl(value) {
  const decoded = decodeHtml(value);
  try {
    const url = new URL(decoded, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch {
    return decoded;
  }
}

function cleanHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isAllowedContentType(contentType) {
  return /text\/html|text\/plain|text\/markdown|application\/json|application\/xml|text\/xml/i.test(contentType);
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      out += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (total - MAX_DOWNLOAD_BYTES))), { stream: true });
      await reader.cancel();
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function extractText(raw, contentType) {
  if (/application\/json/i.test(contentType)) return raw;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(raw) {
  const match = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}
