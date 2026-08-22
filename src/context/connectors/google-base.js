import { GoogleWorkspaceAuthProvider } from '../../auth/google-oauth.js';
import { AuthState } from '../../auth/errors.js';
import { ConnectorHealth } from '../models.js';

export class GoogleApiConnector {
  constructor({ id, name, sourceType, profile = 'personal', scopes = [], capabilities = [], authProvider = new GoogleWorkspaceAuthProvider({ profile }), fetchImpl = fetch } = {}) {
    this.id = id;
    this.name = name;
    this.sourceType = sourceType;
    this.profile = profile;
    this.scopes = scopes;
    this.capabilities = capabilities;
    this.authProvider = authProvider;
    this.fetch = fetchImpl;
    this.readOnly = !capabilities.some((capability) => /\.write|\.send|\.manage|\.delete|\.create|\.update/.test(capability));
  }

  async authStatus() {
    return this.authProvider.status();
  }

  async health() {
    const auth = await this.authStatus();
    if (auth.status !== AuthState.CONNECTED) return this.unavailable(auth, auth.status === AuthState.NOT_CONFIGURED ? ConnectorHealth.NOT_CONFIGURED : ConnectorHealth.UNAVAILABLE);
    const missing = this.scopes.filter((scope) => !auth.scopes?.includes(scope));
    if (missing.length) return this.unavailable(auth, ConnectorHealth.NOT_CONFIGURED, `Google profile ${this.profile} lacks required scope(s): ${missing.join(', ')}`);
    try {
      const detail = await this.probe();
      return {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: auth.account,
        profile: this.profile,
        health: ConnectorHealth.CONNECTED,
        capabilities: this.capabilities,
        readOnly: this.readOnly,
        lastSync: new Date().toISOString(),
        detail
      };
    } catch (error) {
      return this.unavailable(auth, ConnectorHealth.ERROR, error.message);
    }
  }

  unavailable(auth, health, detail = null) {
    return {
      id: this.id,
      name: this.name,
      sourceType: this.sourceType,
      accountIdentity: auth.account ?? null,
      profile: this.profile,
      health,
      capabilities: this.capabilities,
      readOnly: this.readOnly,
      lastSync: null,
      detail: detail ?? `Google profile ${this.profile}: ${auth.status}. ${auth.detail}`
    };
  }

  async token() {
    return this.authProvider.accessToken({ requiredScopes: this.scopes });
  }

  async googleFetch(url, { method = 'GET', body = null, headers = {}, token = null } = {}) {
    token = token ?? await this.token();
    const response = await this.fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : null
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(json.error?.message || json.error_description || `${this.name} API request failed.`);
    return { json, token };
  }

  async probe() {
    return 'Connected.';
  }
}
