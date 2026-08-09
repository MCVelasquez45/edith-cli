import { ConnectorHealth, limitItems } from './models.js';

export class ContextQueryEngine {
  constructor({ registry, systemTools }) {
    this.registry = registry;
    this.systemTools = systemTools;
  }

  async status() {
    return this.registry.status();
  }

  async getEventsToday() {
    return [];
  }

  async getEventsAfter(now = new Date()) {
    const events = await this.getEventsToday();
    return events.filter((event) => event.startAt && new Date(event.startAt) > now);
  }

  async getNextEvent(now = new Date()) {
    const upcoming = await this.getEventsAfter(now);
    return upcoming.sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0] ?? null;
  }

  async getUnreadMessages() {
    return [];
  }

  async searchMessages() {
    return [];
  }

  async getOpenTasks() {
    return [];
  }

  async getOverdueTasks(now = new Date()) {
    const tasks = await this.getOpenTasks();
    return tasks.filter((task) => task.dueAt && new Date(task.dueAt) < now);
  }

  async getAssignedIssues({ limit = 10 } = {}) {
    const rows = await this.registry.status();
    const results = [];
    for (const id of ['github', 'gitlab']) {
      const row = rows.find((item) => item.id === id);
      const connector = this.registry.get(id);
      if (row?.health === ConnectorHealth.CONNECTED && connector?.assignedIssues) {
        results.push(...await connector.assignedIssues({ limit }));
      }
    }
    return limitItems(results, limit);
  }

  async getReviewRequests({ limit = 10 } = {}) {
    const rows = await this.registry.status();
    const results = [];
    for (const id of ['github', 'gitlab']) {
      const row = rows.find((item) => item.id === id);
      const connector = this.registry.get(id);
      if (row?.health === ConnectorHealth.CONNECTED && connector?.reviewRequests) {
        results.push(...await connector.reviewRequests({ limit }));
      }
    }
    return limitItems(results, limit);
  }

  async snapshot({ now = new Date(), limit = 10 } = {}) {
    const [status, remainingEvents, nextEvent, unreadMessages, openTasks, overdueTasks, assignedIssues, reviewRequests] = await Promise.all([
      this.status(),
      this.getEventsAfter(now),
      this.getNextEvent(now),
      this.getUnreadMessages({ limit }),
      this.getOpenTasks({ limit }),
      this.getOverdueTasks(now),
      this.getAssignedIssues({ limit }),
      this.getReviewRequests({ limit })
    ]);
    return {
      now: now.toISOString(),
      timezone: this.systemTools.localTimezone(),
      status,
      remainingEvents,
      nextEvent,
      unreadMessages,
      openTasks,
      overdueTasks,
      assignedIssues,
      reviewRequests
    };
  }
}
