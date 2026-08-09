import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EDITH_CONFIG_DIR } from '../config.js';
import { AuthError, AuthState, normalizeGoogleAuthError } from './errors.js';
import { scopesFor, scopeLabels } from './google-scopes.js';
import { KeychainTokenStore } from './token-store.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DEFAULT_CLIENT_FILE = path.join(EDITH_CONFIG_DIR, 'google-oauth-client.json');

export class GoogleWorkspaceAuthProvider {
  constructor({ profile = 'personal', tokenStore = new KeychainTokenStore(), fetchImpl = fetch, clientConfig = null, openBrowser = openDefaultBrowser, metadataFile = null } = {}) {
    this.id = 'google';
    this.name = 'Google Workspace';
    this.profile = profile;
    this.tokenStore = tokenStore;
    this.fetch = fetchImpl;
    this.clientConfigOverride = clientConfig;
    this.openBrowser = openBrowser;
    this.metadataFile = metadataFile ?? path.join(EDITH_CONFIG_DIR, `auth-google-${profile}.json`);
    this.keychainAccount = `google:${profile}:tokens`;
  }

  async status() {
    const client = await this.loadClientConfig().catch(() => null);
    const metadata = await readJson(this.metadataFile).catch(() => null);
    if (!client) return notConfiguredStatus(this.profile);
    const tokens = await this.tokenStore.get(this.keychainAccount);
    if (!tokens || !metadata?.account) {
      return {
        provider: this.id,
        profile: this.profile,
        name: this.name,
        status: AuthState.DISCONNECTED,
        account: null,
        scopes: [],
        approvedScopes: [],
        token: 'Unavailable',
        refresh: 'Unavailable',
        storage: this.tokenStore.label(),
        detail: 'OAuth client is configured, but no Google account is connected.'
      };
    }
    const refreshed = await this.ensureFreshToken({ tokens, client, metadata }).catch((error) => ({ error }));
    if (refreshed?.error) {
      const normalized = normalizeGoogleAuthError(refreshed.error, this.adminContext(client));
      return {
        provider: this.id,
        profile: this.profile,
        name: this.name,
        status: normalized.status,
        account: metadata.account,
        scopes: metadata.scopes ?? [],
        approvedScopes: metadata.scopeLabels ?? [],
        token: 'Invalid',
        refresh: tokens.refresh_token ? 'Available' : 'Unavailable',
        storage: this.tokenStore.label(),
        detail: normalized.message,
        adminRequest: normalized.status === AuthState.ADMIN_APPROVAL_REQUIRED ? this.adminApprovalRequest(client, metadata.scopes ?? scopesFor()) : null
      };
    }
    return {
      provider: this.id,
      profile: this.profile,
      name: this.name,
      status: AuthState.CONNECTED,
      account: metadata.account,
      scopes: metadata.scopes ?? [],
      approvedScopes: metadata.scopeLabels ?? [],
      token: isExpired(refreshed.tokens) ? 'Expired' : 'Valid',
      refresh: refreshed.tokens.refresh_token ? 'Available' : 'Unavailable',
      storage: this.tokenStore.label(),
      detail: 'Connected.'
    };
  }

  async authenticate({ scopeKeys = ['identity'], timeoutMs = 180000, ui = null } = {}) {
    const client = await this.loadClientConfig();
    const scopes = scopesFor(scopeKeys);
    const state = base64Url(crypto.randomBytes(32));
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const callback = await startLoopbackServer({ state, timeoutMs });
    const redirectUri = callback.redirectUri;
    const authUrl = buildAuthUrl({
      clientId: client.clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge
    });

    ui?.line?.('Google Workspace authorization required.');
    ui?.line?.('Opening your browser...');
    const opened = await this.openBrowser(authUrl).catch(() => false);
    if (!opened) ui?.line?.(`Open this URL in your browser:\n${authUrl}`);

    let callbackResult;
    try {
      callbackResult = await callback.wait();
    } finally {
      callback.close();
    }
    if (callbackResult.error) {
      throw normalizeGoogleAuthError(new AuthError(callbackResult.errorDescription || callbackResult.error, {
        code: callbackResult.error,
        details: { error: callbackResult.error, error_description: callbackResult.errorDescription }
      }), { ...this.adminContext(client), redirectUri, scopes });
    }
    if (callbackResult.state !== state) {
      throw new AuthError('OAuth state mismatch. Authorization was rejected.', { code: 'state_mismatch' });
    }

    const tokens = await this.exchangeCode({ client, code: callbackResult.code, redirectUri, codeVerifier });
    const account = await this.fetchIdentity(tokens.access_token);
    const stored = normalizeTokens(tokens);
    await this.tokenStore.set(this.keychainAccount, stored);
    await writeJson(this.metadataFile, {
      provider: this.id,
      profile: this.profile,
      account: account.email,
      subject: account.sub,
      scopes: parseScopes(tokens.scope || scopes.join(' ')),
      scopeLabels: scopeLabels(parseScopes(tokens.scope || scopes.join(' '))),
      access: 'Read-only foundation',
      storage: this.tokenStore.label(),
      connectedAt: new Date().toISOString(),
      expiresAt: stored.expires_at,
      clientId: client.clientId,
      redirectUri,
      localOnly: true
    });
    return this.status();
  }

  async exchangeCode({ client, code, redirectUri, codeVerifier }) {
    const body = new URLSearchParams({
      client_id: client.clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    if (client.clientSecret) body.set('client_secret', client.clientSecret);
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const json = await safeJson(response);
    if (!response.ok) throw normalizeGoogleAuthError(new AuthError(json.error_description || json.error || 'Token exchange failed.', { code: json.error, details: json }), this.adminContext(client));
    return json;
  }

  async fetchIdentity(accessToken) {
    const response = await this.fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    const json = await safeJson(response);
    if (!response.ok) throw new AuthError(json.error_description || json.error || 'Unable to read Google account identity.', { code: json.error, details: json });
    return json;
  }

  async refresh({ tokens = null, client = null } = {}) {
    const resolvedClient = client ?? await this.loadClientConfig();
    const current = tokens ?? await this.tokenStore.get(this.keychainAccount);
    if (!current?.refresh_token) throw new AuthError('No Google refresh token is available.', { code: 'missing_refresh_token', status: AuthState.DISCONNECTED });
    const body = new URLSearchParams({
      client_id: resolvedClient.clientId,
      refresh_token: current.refresh_token,
      grant_type: 'refresh_token'
    });
    if (resolvedClient.clientSecret) body.set('client_secret', resolvedClient.clientSecret);
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const json = await safeJson(response);
    if (!response.ok) throw normalizeGoogleAuthError(new AuthError(json.error_description || json.error || 'Token refresh failed.', { code: json.error, details: json }), this.adminContext(resolvedClient));
    const next = normalizeTokens({ ...current, ...json, refresh_token: json.refresh_token ?? current.refresh_token });
    await this.tokenStore.set(this.keychainAccount, next);
    return next;
  }

  async accessToken({ requiredScopes = [], anyScope = [] } = {}) {
    const client = await this.loadClientConfig();
    const metadata = await readJson(this.metadataFile);
    for (const scope of requiredScopes) {
      if (!metadata.scopes?.includes(scope)) throw new AuthError(`Google profile ${this.profile} lacks required scope: ${scope}`, { code: 'missing_scope', status: AuthState.DISCONNECTED });
    }
    if (anyScope.length && !anyScope.some((scope) => metadata.scopes?.includes(scope))) {
      throw new AuthError(`Google profile ${this.profile} lacks one of the required scopes: ${anyScope.join(', ')}`, { code: 'missing_scope', status: AuthState.DISCONNECTED });
    }
    const tokens = await this.tokenStore.get(this.keychainAccount);
    if (!tokens) throw new AuthError(`Google profile ${this.profile} is not authenticated.`, { code: 'not_authenticated', status: AuthState.DISCONNECTED });
    const fresh = await this.ensureFreshToken({ tokens, client, metadata });
    return { accessToken: fresh.tokens.access_token, account: metadata.account, profile: this.profile, scopes: metadata.scopes ?? [] };
  }

  async ensureFreshToken({ tokens, client, metadata }) {
    if (!isExpired(tokens, 60)) return { tokens };
    const refreshed = await this.refresh({ tokens, client });
    await writeJson(this.metadataFile, { ...metadata, expiresAt: refreshed.expires_at, refreshedAt: new Date().toISOString() });
    return { tokens: refreshed, refreshed: true };
  }

  async logout() {
    await this.tokenStore.delete(this.keychainAccount);
    await fs.rm(this.metadataFile, { force: true });
    return { provider: this.id, status: AuthState.DISCONNECTED };
  }

  async loadClientConfig() {
    if (this.clientConfigOverride) return normalizeClientConfig(this.clientConfigOverride);
    if (process.env.EDITH_GOOGLE_CLIENT_ID) {
      return normalizeClientConfig({
        client_id: process.env.EDITH_GOOGLE_CLIENT_ID,
        client_secret: process.env.EDITH_GOOGLE_CLIENT_SECRET
      });
    }
    const profileFile = path.join(EDITH_CONFIG_DIR, `google-oauth-client-${this.profile}.json`);
    const file = process.env[`EDITH_GOOGLE_OAUTH_CLIENT_FILE_${this.profile.toUpperCase()}`]
      ?? process.env.EDITH_GOOGLE_OAUTH_CLIENT_FILE
      ?? (await exists(profileFile) ? profileFile : DEFAULT_CLIENT_FILE);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return normalizeClientConfig(raw);
  }

  adminContext(client) {
    return {
      applicationName: 'EDITH Local AI Orchestrator',
      clientId: client.clientId,
      applicationType: 'Desktop / installed CLI application',
      redirectUri: 'http://127.0.0.1:<random-port>/oauth/google/callback',
      requestedScopes: scopesFor(['identity']),
      accessLevel: 'Read-only identity foundation',
      localOnly: true
    };
  }

  adminApprovalRequest(client, scopes = scopesFor(['identity'])) {
    return [
      'Application name: EDITH Local AI Orchestrator',
      `OAuth Client ID: ${client.clientId}`,
      'Application type: Desktop / installed application',
      'Redirect URI: http://127.0.0.1:<random-port>/oauth/google/callback',
      `Requested scopes: ${scopes.join(' ')}`,
      'Access level: Read-only identity foundation; no Calendar/Gmail/Drive/Tasks/Contacts scopes requested in this phase.',
      'Data processing location: Local macOS machine only.',
      'Token storage: macOS Keychain for tokens; non-secret metadata in ~/.config/edith.',
      'Purpose: Let EDITH verify the signed-in Google Workspace identity before later requesting approved read-only Workspace scopes.',
      'Externally hosted: No. EDITH is a local CLI and does not require a public backend.'
    ].join('\n');
  }
}

export function buildAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function parseCallbackUrl(callbackUrl) {
  const url = new URL(callbackUrl, 'http://127.0.0.1');
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    errorDescription: url.searchParams.get('error_description')
  };
}

export function generateCodeVerifier() {
  return base64Url(crypto.randomBytes(64)).slice(0, 96);
}

function startLoopbackServer({ state, timeoutMs }) {
  let server;
  let timer;
  let resolveWait;
  const wait = new Promise((resolve) => {
    resolveWait = resolve;
  });
  server = http.createServer((req, res) => {
    const result = parseCallbackUrl(req.url);
    const ok = !result.error && result.state === state && result.code;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ok ? '<h1>EDITH Google authorization complete.</h1><p>You can close this tab.</p>' : '<h1>EDITH Google authorization failed.</h1><p>You can close this tab and return to the terminal.</p>');
    resolveWait(result);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      timer = setTimeout(() => resolveWait({ error: 'timeout', errorDescription: 'Google authorization timed out.' }), timeoutMs);
      resolve({
        redirectUri: `http://127.0.0.1:${port}/oauth/google/callback`,
        wait: async () => {
          const result = await wait;
          clearTimeout(timer);
          return result;
        },
        close: () => server.close()
      });
    });
  });
}

function normalizeClientConfig(raw) {
  const config = raw.installed ?? raw.desktop ?? raw.web ?? raw;
  const clientId = config.client_id ?? config.clientId;
  const clientSecret = config.client_secret ?? config.clientSecret ?? '';
  if (!clientId) throw new AuthError('Google OAuth client is not configured.', { code: 'not_configured', status: AuthState.NOT_CONFIGURED });
  return { clientId, clientSecret };
}

function normalizeTokens(tokens) {
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
    : tokens.expires_at ?? new Date().toISOString();
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_at: expiresAt
  };
}

function isExpired(tokens, skewSeconds = 0) {
  if (!tokens?.expires_at) return true;
  return new Date(tokens.expires_at).getTime() <= Date.now() + skewSeconds * 1000;
}

function parseScopes(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text);
}

async function openDefaultBrowser(url) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function notConfiguredStatus(profile = 'personal') {
  return {
    provider: 'google',
    profile,
    name: 'Google Workspace',
    status: AuthState.NOT_CONFIGURED,
    account: null,
    scopes: [],
    approvedScopes: [],
    token: 'Unavailable',
    refresh: 'Unavailable',
    storage: 'macOS Keychain',
    detail: [
      'No Google Desktop OAuth client configuration was found.',
      `Create a Desktop OAuth client in Google Cloud Console and store the downloaded JSON at ${DEFAULT_CLIENT_FILE},`,
      'or set EDITH_GOOGLE_CLIENT_ID and EDITH_GOOGLE_CLIENT_SECRET outside the repository.'
    ].join(' ')
  };
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
