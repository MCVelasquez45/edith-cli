import { GoogleWorkspaceAuthProvider } from './google-oauth.js';

export class AuthRegistry {
  constructor({ profiles = ['personal', 'work'], providers = null } = {}) {
    this.profiles = profiles;
    this.providers = providers ?? profiles.map((profile) => new GoogleWorkspaceAuthProvider({ profile }));
  }

  get(id, profile = 'personal') {
    return this.providers.find((provider) => provider.id === id && provider.profile === profile)
      ?? this.providers.find((provider) => provider.id === id);
  }

  async status() {
    const rows = [];
    for (const provider of this.providers) rows.push(await provider.status());
    return rows;
  }
}
