import { GOOGLE_SCOPE_REGISTRY } from '../../auth/google-scopes.js';
import { contextItem, limitItems } from '../models.js';
import { GoogleApiConnector } from './google-base.js';

const API_ROOT = 'https://tasks.googleapis.com/tasks/v1';

export class GoogleTasksConnector extends GoogleApiConnector {
  constructor(options = {}) {
    super({
      id: `google-tasks:${options.profile ?? 'personal'}`,
      name: 'Google Tasks',
      sourceType: 'task',
      scopes: GOOGLE_SCOPE_REGISTRY.tasksPersonal.scopes,
      capabilities: ['tasks.read', 'tasks.create', 'tasks.update', 'tasks.complete', 'tasks.delete'],
      ...options
    });
  }

  async probe() {
    const lists = await this.taskLists({ limit: 1 });
    return `Google Tasks connected; task lists discovered: ${lists.totalCount}.`;
  }

  async taskLists({ limit = 20 } = {}) {
    const { json, token } = await this.googleFetch(`${API_ROOT}/users/@me/lists?maxResults=${Math.min(limit, 100)}`);
    return {
      items: (json.items ?? []).map((list) => ({ id: list.id, title: list.title, source: 'google-tasks', sourceAccount: this.profile, accountIdentity: token.account })),
      totalCount: json.items?.length ?? 0
    };
  }

  async openTasks({ limit = 20 } = {}) {
    const lists = (await this.taskLists()).items;
    const tasks = [];
    for (const list of lists.slice(0, 5)) {
      const { json, token } = await this.googleFetch(`${API_ROOT}/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&maxResults=${Math.min(limit, 100)}`);
      for (const task of json.items ?? []) tasks.push(normalizeTask({ task, list, profile: this.profile, account: token.account }));
    }
    return limitItems(tasks, limit);
  }

  async createTask({ title, due = null, notes = '', taskListId = null }) {
    const list = taskListId ? { id: taskListId, title: taskListId } : (await this.taskLists({ limit: 1 })).items[0];
    const body = { title, notes };
    if (due) body.due = due;
    const { json, token } = await this.googleFetch(`${API_ROOT}/lists/${encodeURIComponent(list.id)}/tasks`, { method: 'POST', body });
    return normalizeTask({ task: json, list, profile: this.profile, account: token.account });
  }

  async updateTask({ taskListId, taskId, patch }) {
    const { json, token } = await this.googleFetch(`${API_ROOT}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: patch });
    return normalizeTask({ task: json, list: { id: taskListId, title: taskListId }, profile: this.profile, account: token.account });
  }

  async deleteTask({ taskListId, taskId }) {
    await this.googleFetch(`${API_ROOT}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    return { id: taskId, source: 'google-tasks', sourceAccount: this.profile, deleted: true };
  }
}

function normalizeTask({ task, list, profile, account }) {
  return contextItem('Task', {
    id: `google-tasks:${profile}:${list.id}:${task.id}`,
    source: 'google-tasks',
    sourceAccount: profile,
    sourceContainer: list.title,
    externalId: task.id,
    title: task.title,
    summary: task.notes ?? '',
    url: task.webViewLink ?? null,
    createdAt: task.updated ?? null,
    updatedAt: task.updated ?? null,
    dueAt: task.due ?? null,
    status: task.status,
    metadata: { taskListId: list.id, account }
  });
}
