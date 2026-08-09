import { ConnectorHealth, contextItem, limitItems } from '../models.js';
import { commandExists, runJson, runText } from './process.js';

export class GitHubConnector {
  constructor({ cwd = process.cwd(), limit = 10 } = {}) {
    this.id = 'github';
    this.name = 'GitHub';
    this.sourceType = 'github';
    this.capabilities = ['repositories.read', 'issues.read', 'pullRequests.read', 'notifications.read'];
    this.readOnly = true;
    this.cwd = cwd;
    this.limit = limit;
    this._health = null;
  }

  async health() {
    if (!(await commandExists('gh'))) return this.notConfigured('gh CLI is not installed.');
    try {
      const ghOptions = { cwd: this.cwd, timeoutMs: 10000, env: cleanGhEnv() };
      const auth = await runText('gh', ['auth', 'status'], ghOptions);
      const user = await runJson('gh', ['api', 'user', '--jq', '{login:.login,id:.id}'], ghOptions);
      this._health = {
        id: this.id,
        name: this.name,
        sourceType: this.sourceType,
        accountIdentity: user?.login ?? null,
        health: ConnectorHealth.CONNECTED,
        capabilities: this.capabilities,
        readOnly: true,
        lastSync: new Date().toISOString(),
        detail: auth.includes('Logged in') ? 'Authenticated through gh CLI.' : 'gh CLI responded.'
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
    const query = 'is:issue is:open assignee:@me';
    const data = await this.searchIssues(query, limit);
    return limitItems(data.items ?? [], limit).map((item) => this.issueItem(item));
  }

  async reviewRequests({ limit = this.limit } = {}) {
    const query = 'is:pr is:open review-requested:@me';
    const data = await this.searchIssues(query, limit);
    return limitItems(data.items ?? [], limit).map((item) => this.pullRequestItem(item));
  }

  async notifications({ limit = this.limit } = {}) {
    const data = await runJson('gh', ['api', '-X', 'GET', 'notifications', '-f', `per_page=${limit}`], {
      cwd: this.cwd,
      timeoutMs: 15000,
      env: cleanGhEnv()
    }).catch(() => []);
    return limitItems(Array.isArray(data) ? data : [], limit).map((item) => contextItem('Notification', {
      id: `github:notification:${item.id}`,
      source: this.id,
      sourceAccount: this._health?.accountIdentity,
      sourceContainer: item.repository?.full_name,
      externalId: item.id,
      title: item.subject?.title,
      summary: item.subject?.type,
      url: item.subject?.url ?? item.repository?.html_url,
      updatedAt: item.updated_at,
      status: item.unread ? 'unread' : 'read',
      metadata: { reason: item.reason }
    }));
  }

  async searchIssues(query, limit) {
    return runJson('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=${query}`, '-f', `per_page=${limit}`], {
      cwd: this.cwd,
      timeoutMs: 20000,
      env: cleanGhEnv()
    });
  }

  issueItem(item) {
    return contextItem('Issue', {
      id: `github:issue:${item.id}`,
      source: this.id,
      sourceAccount: this._health?.accountIdentity,
      sourceContainer: item.repository_url?.split('/repos/')[1] ?? null,
      externalId: String(item.number),
      title: item.title,
      summary: item.body ? item.body.slice(0, 500) : '',
      url: item.html_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      status: item.state,
      people: item.assignees?.map((person) => person.login) ?? [],
      labels: item.labels?.map((label) => label.name) ?? []
    });
  }

  pullRequestItem(item) {
    return contextItem('PullRequest', {
      id: `github:pr:${item.id}`,
      source: this.id,
      sourceAccount: this._health?.accountIdentity,
      sourceContainer: item.repository_url?.split('/repos/')[1] ?? null,
      externalId: String(item.number),
      title: item.title,
      summary: item.body ? item.body.slice(0, 500) : '',
      url: item.html_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      status: item.state,
      people: item.assignees?.map((person) => person.login) ?? [],
      labels: item.labels?.map((label) => label.name) ?? []
    });
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

function cleanGhEnv() {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
}
