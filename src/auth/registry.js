import { GoogleWorkspaceAuthProvider } from './google-oauth.js';

export class AuthRegistry {
  constructor({ providers = [new GoogleWorkspaceAuthProvider()] } = {}) {
    this.providers = providers;
  }

  get(id) {
    return this.providers.find((provider) => provider.id === id);
  }

  async status() {
    const rows = [];
    for (const provider of this.providers) rows.push(await provider.status());
    return rows;
  }
}
