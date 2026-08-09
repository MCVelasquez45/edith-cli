import { OpenCodeAdapter } from './opencode.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

export class AgentRegistry {
  constructor(agents = [new OpenCodeAdapter(), new ClaudeAdapter(), new CodexAdapter()]) {
    this.agents = agents;
  }

  get(id) {
    return this.agents.find((agent) => agent.id === id);
  }

  async list() {
    const rows = [];
    for (const agent of this.agents) rows.push(await agent.health());
    return rows;
  }
}
