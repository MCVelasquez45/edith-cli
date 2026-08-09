import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GoogleWorkspaceAuthProvider, buildAuthUrl, generateCodeVerifier, parseCallbackUrl } from '../src/auth/google-oauth.js';
import { AuthState, normalizeGoogleAuthError } from '../src/auth/errors.js';
import { GOOGLE_SCOPE_BUNDLES, scopesFor } from '../src/auth/google-scopes.js';
import { MemoryTokenStore } from '../src/auth/token-store.js';

describe('google oauth foundation', () => {
  it('builds an installed-app PKCE authorization URL', () => {
    const url = new URL(buildAuthUrl({
      clientId: 'client-id.apps.googleusercontent.com',
      redirectUri: 'http://127.0.0.1:49152/oauth/google/callback',
      scopes: scopesFor(['identity']),
      state: 'state123',
      codeChallenge: 'challenge123'
    }));

    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:49152/oauth/google/callback');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.match(url.searchParams.get('scope'), /openid/);
    assert.match(url.searchParams.get('scope'), /email/);
    assert.match(url.searchParams.get('scope'), /profile/);
  });

  it('generates a valid high-entropy code verifier and parses callbacks', () => {
    const verifier = generateCodeVerifier();
    assert.ok(verifier.length >= 43);
    assert.ok(verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9._~-]+$/);

    const parsed = parseCallbackUrl('/oauth/google/callback?code=abc&state=xyz');
    assert.equal(parsed.code, 'abc');
    assert.equal(parsed.state, 'xyz');
  });

  it('reports not configured without client credentials', async () => {
    const provider = new GoogleWorkspaceAuthProvider({
      tokenStore: new MemoryTokenStore(),
      metadataFile: await tempFile(),
      clientConfig: {},
      fetchImpl: async () => new Response('{}')
    });

    const status = await provider.status();

    assert.equal(status.status, AuthState.NOT_CONFIGURED);
    assert.equal(status.token, 'Unavailable');
  });

  it('reports connected auth and refreshes expired access tokens', async () => {
    const metadataFile = await tempFile();
    const store = new MemoryTokenStore();
    const provider = new GoogleWorkspaceAuthProvider({
      tokenStore: store,
      metadataFile,
      clientConfig: { client_id: 'client-id', client_secret: 'client-secret' },
      fetchImpl: async (url, options) => {
        assert.equal(String(url), 'https://oauth2.googleapis.com/token');
        assert.match(String(options.body), /grant_type=refresh_token/);
        return jsonResponse({
          access_token: 'access-new',
          expires_in: 3600,
          scope: scopesFor(['identity']).join(' '),
          token_type: 'Bearer'
        });
      }
    });
    await store.set('google:personal:tokens', {
      access_token: 'access-old',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      scope: scopesFor(['identity']).join(' '),
      expires_at: new Date(Date.now() - 1000).toISOString()
    });
    await fs.writeFile(metadataFile, JSON.stringify({
      account: 'user@example.com',
      scopes: scopesFor(['identity']),
      scopeLabels: ['identity']
    }));

    const status = await provider.status();

    assert.equal(status.status, AuthState.CONNECTED);
    assert.equal(status.account, 'user@example.com');
    assert.equal(status.token, 'Valid');
    assert.equal(status.refresh, 'Available');
    const stored = await store.get('google:personal:tokens');
    assert.equal(stored.access_token, 'access-new');
    assert.equal(stored.refresh_token, 'refresh-token');
  });

  it('isolates token storage by Google profile', async () => {
    const personal = new GoogleWorkspaceAuthProvider({
      profile: 'personal',
      tokenStore: new MemoryTokenStore(),
      metadataFile: await tempFile(),
      clientConfig: { client_id: 'client-id' },
      fetchImpl: async () => jsonResponse({})
    });
    const work = new GoogleWorkspaceAuthProvider({
      profile: 'work',
      tokenStore: new MemoryTokenStore(),
      metadataFile: await tempFile(),
      clientConfig: { client_id: 'client-id' },
      fetchImpl: async () => jsonResponse({})
    });

    assert.equal(personal.keychainAccount, 'google:personal:tokens');
    assert.equal(work.keychainAccount, 'google:work:tokens');
    assert.notEqual(personal.metadataFile, work.metadataFile);
  });

  it('normalizes admin-blocked and revoked-token failures safely', () => {
    const admin = normalizeGoogleAuthError({ code: 'admin_policy_enforced', message: 'Blocked by admin' });
    assert.equal(admin.status, AuthState.ADMIN_APPROVAL_REQUIRED);

    const revoked = normalizeGoogleAuthError({ code: 'invalid_grant', message: 'Token has been revoked' });
    assert.equal(revoked.status, AuthState.DISCONNECTED);
    assert.doesNotMatch(revoked.message, /refresh_token=/);
  });

  it('defines a personal Workspace upgrade without broad everything scopes', () => {
    const scopes = scopesFor(GOOGLE_SCOPE_BUNDLES.personalWorkspace);

    assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.modify'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.compose'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.send'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.readonly'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.file'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/documents'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/tasks'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/contacts'));
    assert.equal(scopes.includes('https://mail.google.com/'), false);
    assert.equal(scopes.includes('https://www.googleapis.com/auth/drive'), false);
  });
});

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edith-auth-test-'));
  return path.join(dir, 'metadata.json');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
