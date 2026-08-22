import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ContextConnectorRegistry } from '../src/context/registry.js';
import { ContextQueryEngine } from '../src/context/query-engine.js';
import { BriefingEngine } from '../src/context/briefing.js';
import { ConnectorHealth, contextItem } from '../src/context/models.js';
import { buildToolset } from '../src/capability/toolset.js';

// Deterministic clock in the shape BriefingEngine expects (the old
// SystemTools class was retired with the regex-router runtime).
function fakeClock(now) {
  return {
    currentDate: () => ({ output: `Today is ${now.toISOString().slice(0, 10)} (trusted local time source: runtime clock).` }),
    currentTime: () => ({ output: `Local time is ${now.toISOString()} (trusted local time source: runtime clock).` }),
    localTimezone: () => ({ output: 'Timezone: UTC (runtime clock).', timezone: 'UTC' })
  };
}

describe('personal context safety', () => {
  it('never exposes personal-context mutation tools through the capability service', () => {
    const tools = buildToolset({ workspace: process.cwd() });
    const forbidden = /sendEmail|deleteEmail|createEvent|updateEvent|deleteEvent|createTask|updateTask|mergePR|mergeMR|createIssue/i;

    assert.deepEqual(tools.filter((tool) => forbidden.test(tool.name)).map((tool) => tool.name), []);
  });
});

describe('briefing engine', () => {
  it('builds a time-aware brief with provenance and unavailable-source status', async () => {
    const now = new Date('2026-08-09T20:00:00.000Z');
    const registry = new ContextConnectorRegistry({ connectors: [new FakeCalendar(), new FakeEmail(), new FakeTasks(), new FakeGitHub()] });
    const systemTools = fakeClock(now);
    const query = new FakeQueryEngine({ registry, systemTools, now });
    const briefing = new BriefingEngine({ queryEngine: query, systemTools });

    const text = await briefing.buildBrief({ now });

    assert.match(text, /trusted local time/i);
    assert.match(text, /NEXT UP/);
    assert.match(text, /REMAINING TODAY/);
    assert.match(text, /MESSAGES NEEDING ATTENTION/);
    assert.match(text, /REVIEWS \/ DEVELOPMENT/);
    assert.match(text, /google-calendar \/ work \/ Product/);
    assert.match(text, /gmail \/ work/);
  });

  it('reports meaningful updated brief deltas without repeating unsupported claims', async () => {
    const now = new Date('2026-08-09T20:00:00.000Z');
    const registry = new ContextConnectorRegistry({ connectors: [new FakeCalendar(), new FakeEmail(), new FakeTasks(), new FakeGitHub()] });
    const systemTools = fakeClock(now);
    const query = new FakeQueryEngine({ registry, systemTools, now });
    const briefing = new BriefingEngine({ queryEngine: query, systemTools });

    await briefing.buildBrief({ now });
    const updated = await briefing.buildBrief({ now, updated: true });

    assert.match(updated, /CHANGED SINCE LAST BRIEF/);
    assert.match(updated, /No meaningful item changes/i);
  });

  it('distinguishes unknown completion from confirmed completion in end-of-day review', async () => {
    const now = new Date('2026-08-09T23:00:00.000Z');
    const registry = new ContextConnectorRegistry({ connectors: [new FakeCalendar(), new FakeEmail(), new FakeTasks(), new FakeGitHub()] });
    const systemTools = fakeClock(now);
    const query = new FakeQueryEngine({ registry, systemTools, now });
    const briefing = new BriefingEngine({ queryEngine: query, systemTools });

    const text = await briefing.buildEndOfDay({ now });

    assert.match(text, /COMPLETED/);
    assert.match(text, /UNKNOWN/);
    assert.match(text, /not treated as missed or completed without evidence/i);
    assert.match(text, /read-only phase/i);
  });
});

class FakeCalendar {
  id = 'calendar';
  name = 'Calendar';
  sourceType = 'calendar';
  capabilities = ['events.read'];
  readOnly = true;
  async health() {
    return {
      id: this.id,
      name: this.name,
      sourceType: this.sourceType,
      accountIdentity: 'work',
      health: ConnectorHealth.CONNECTED,
      capabilities: this.capabilities,
      readOnly: true,
      lastSync: '2026-08-09T20:00:00.000Z',
      detail: 'fake connected'
    };
  }
}

class FakeEmail extends FakeCalendar {
  id = 'email';
  name = 'Email';
  sourceType = 'email';
  capabilities = ['messages.read'];
}

class FakeTasks extends FakeCalendar {
  id = 'tasks';
  name = 'Tasks';
  sourceType = 'task';
  capabilities = ['tasks.read'];
}

class FakeGitHub extends FakeCalendar {
  id = 'github';
  name = 'GitHub';
  sourceType = 'github';
  capabilities = ['issues.read', 'pullRequests.read'];
}

class FakeQueryEngine extends ContextQueryEngine {
  constructor({ registry, systemTools, now }) {
    super({ registry, systemTools });
    this.now = now;
  }

  async getEventsToday() {
    return [
      contextItem('Event', {
        id: 'event:1',
        source: 'google-calendar',
        sourceAccount: 'work',
        sourceContainer: 'Product',
        title: 'Planning Review',
        startAt: '2026-08-09T21:00:00.000Z',
        endAt: '2026-08-09T21:30:00.000Z',
        status: 'confirmed'
      })
    ];
  }

  async getUnreadMessages() {
    return [
      contextItem('Message', {
        id: 'message:1',
        source: 'gmail',
        sourceAccount: 'work',
        sourceContainer: 'Inbox',
        title: 'Planning Review notes',
        status: 'unread',
        updatedAt: '2026-08-09T19:50:00.000Z'
      })
    ];
  }

  async getOpenTasks() {
    return [
      contextItem('Task', {
        id: 'task:1',
        source: 'tasks',
        sourceAccount: 'work',
        sourceContainer: 'Today',
        title: 'Follow up on planning review',
        dueAt: '2026-08-09T18:00:00.000Z',
        status: 'open'
      })
    ];
  }

  async getAssignedIssues() {
    return [
      contextItem('Issue', {
        id: 'issue:1',
        source: 'github',
        sourceAccount: 'work',
        sourceContainer: 'org/repo',
        title: 'Review context connector',
        status: 'open',
        url: 'https://github.com/org/repo/issues/1'
      })
    ];
  }

  async getReviewRequests() {
    return [];
  }
}
