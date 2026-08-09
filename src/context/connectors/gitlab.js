import { ConnectorHealth, contextItem, limitItems } from '../models.js';
import { commandExists, runJson, runText } from './process.js';

export class GitLabConnector {
  constructor({ cwd = process.cwd(), limit = 10 } = {}) {
    this.id = 'gitlab';
    this.name = 'GitLab';
    this.sourceType = 'gitlab';
    this.capabilities = ['projects.read', 'issues.read', 'mergeRequests.read'];
    this.readOnly = true;
    this.cwd = cwd;
    this.limit = limit;
    this._health = null;
  }

  async health() {
    if (!(await commandExists('glab'))) return this.notConfigured('glab CLI is not installed.');
    try {
      await runText('glab', ['auth', 'status'], { cwd: this.cwd, timeoutMs: 10000 });
      const user = await runJson('glab', ['api', 'user'], { cwd: this.cwd, timeoutMs: 10000 });
      this._health = {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: user?.username ?? null,
        health: ConnectorHealth.CONNECTED,
        capabilities: this.capabilities,
        readOnly: true,
        lastSync: new Date().toISOString(),
        detail: 'Authenticated through glab CLI.'
      };
      return this._health;
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: null,
        health: ConnectorHealth.ERROR,
        capabilities: this.capabilities,
        readOnly: true,
        lastSync: null,
        detail: error.message
      };
    }
  }

  async assignedIssues({ limit = this.limit } = {}) {
    const data = await runJson('glab', ['api', '--method', 'GET', 'issues', '--field', 'scope=assigned_to_me', '--field', 'state=opened', '--field', `per_page=${limit}`], {
      cwd: this.cwd,
      timeoutMs: 20000
    }).catch(() => []);
    return limitItems(Array.isArray(data) ? data : [], limit).map((item) => contextItem('Issue', {
      id: `gitlab:issue:${item.id}`,
      source: this.id,
      sourceAccount: this._health?.accountIdentity,
      sourceContainer: item.references?.full?.split('#')[0] ?? item.project_id,
      externalId: String(item.iid),
      title: item.title,
      summary: item.description ? item.description.slice(0, 500) : '',
      url: item.web_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      dueAt: item.due_date,
      status: item.state,
      people: item.assignees?.map((person) => person.username) ?? [],
      labels: item.labels ?? []
    }));
  }

  async reviewRequests({ limit = this.limit } = {}) {
    const data = await runJson('glab', ['api', '--method', 'GET', 'merge_requests', '--field', 'scope=assigned_to_me', '--field', 'state=opened', '--field', `per_page=${limit}`], {
      cwd: this.cwd,
      timeoutMs: 20000
    }).catch(() => []);
    return limitItems(Array.isArray(data) ? data : [], limit).map((item) => contextItem('MergeRequest', {
      id: `gitlab:mr:${item.id}`,
      source: this.id,
      sourceAccount: this._health?.accountIdentity,
      sourceContainer: item.references?.full?.split('!')[0] ?? item.project_id,
      externalId: String(item.iid),
      title: item.title,
      summary: item.description ? item.description.slice(0, 500) : '',
      url: item.web_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      status: item.state,
      people: item.assignees?.map((person) => person.username) ?? [],
      labels: item.labels ?? []
    }));
  }

  notConfigured(detail) {
    return {
      id: this.id,
      name: this.name,
      sourceType: this.sourceType,
      accountIdentity: null,
      health: ConnectorHealth.NOT_CONFIGURED,
      capabilities: this.capabilities,
      readOnly: true,
      lastSync: null,
      detail
    };
  }
}
