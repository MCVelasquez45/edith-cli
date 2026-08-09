import { NotConfiguredConnector } from './connectors/base.js';
import { GitHubConnector } from './connectors/github.js';
import { GitLabConnector } from './connectors/gitlab.js';
import { GoogleCalendarConnector } from './connectors/google-calendar.js';
import { GoogleGmailConnector } from './connectors/google-gmail.js';
import { GoogleDriveConnector, GoogleDocsConnector } from './connectors/google-drive-docs.js';
import { GoogleTasksConnector } from './connectors/google-tasks.js';
import { GoogleContactsConnector } from './connectors/google-contacts.js';
import { ConnectorHealth } from './models.js';

export class ContextConnectorRegistry {
  constructor({ cwd = process.cwd(), connectors = null } = {}) {
    this.cwd = cwd;
    this.connectors = connectors ?? [
      new GoogleCalendarConnector({ profile: 'personal' }),
      new GoogleGmailConnector({ profile: 'personal' }),
      new GoogleDriveConnector({ profile: 'personal' }),
      new GoogleDocsConnector({ profile: 'personal' }),
      new GoogleTasksConnector({ profile: 'personal' }),
      new GoogleContactsConnector({ profile: 'personal' }),
      new GitHubConnector({ cwd }),
      new GitLabConnector({ cwd })
    ];
    this.statusRows = [];
  }

  get(id) {
    return this.connectors.find((connector) => connector.id === id)
      ?? this.connectors.find((connector) => connector.sourceType === id);
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
