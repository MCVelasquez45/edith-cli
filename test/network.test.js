import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isBlockedIp } from '../src/network/policy.js';
import { OfficialSourceSearchProvider, DirectFetchProvider } from '../src/network/providers.js';
import { EdithAgentCore } from '../src/native/agent-core.js';

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
});

describe('network failure handling', () => {
  it('returns a useful error when the search provider fails', async () => {
    const core = new EdithAgentCore();
    core.network = { search: async () => { throw new Error('ECONNRESET'); } };

    const result = await core.answerNetworkSearch('latest OpenCode release', {});

    assert.equal(result.route, 'network:search');
    assert.match(result.text, /connection failed|reset/i);
  });
});
