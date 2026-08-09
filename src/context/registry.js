import { NotConfiguredConnector } from './connectors/base.js';
import { GitHubConnector } from './connectors/github.js';
import { GitLabConnector } from './connectors/gitlab.js';
import { ConnectorHealth } from './models.js';

export class ContextConnectorRegistry {
  constructor({ cwd = process.cwd(), connectors = null } = {}) {
    this.cwd = cwd;
    this.connectors = connectors ?? [
      new NotConfiguredConnector({
        id: 'calendar',
        name: 'Calendar',
        sourceType: 'calendar',
        capabilities: ['events.read']
      }),
      new NotConfiguredConnector({
        id: 'email',
        name: 'Email',
        sourceType: 'email',
        capabilities: ['messages.read', 'messages.search']
      }),
      new NotConfiguredConnector({
        id: 'tasks',
        name: 'Tasks',
        sourceType: 'task',
        capabilities: ['tasks.read']
      }),
      new GitHubConnector({ cwd }),
      new GitLabConnector({ cwd })
    ];
    this.statusRows = [];
  }

  get(id) {
    return this.connectors.find((connector) => connector.id === id);
  }

  async status({ refresh = false } = {}) {
    if (this.statusRows.length && !refresh) return this.statusRows;
    const rows = [];
    for (const connector of this.connectors) rows.push(await connector.health());
    this.statusRows = rows;
    return rows;
  }

  async connected(id) {
    const rows = await this.status();
    return rows.find((row) => row.id === id)?.health === ConnectorHealth.CONNECTED;
  }
}
