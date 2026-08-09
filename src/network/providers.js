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
  constructor({ searchProvider = new OfficialSourceSearchProvider(), fetchProvider = new DirectFetchProvider(), docsProvider = null } = {}) {
    this.searchProvider = searchProvider;
    this.fetchProvider = fetchProvider;
    this.docsProvider = docsProvider ?? new DocumentationProvider({ searchProvider, fetchProvider });
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

export class DocumentationProvider {
  id = 'official-docs';
  name = 'Official Documentation Lookup';

  constructor({ searchProvider, fetchProvider }) {
    this.searchProvider = searchProvider;
    this.fetchProvider = fetchProvider;
  }

  async lookup({ query, maxResults = 3 }) {
    const results = await this.searchProvider.search({ query, maxResults });
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
    publishedAt: item.publishedAt ?? null
  };
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
