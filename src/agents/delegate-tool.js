// Specialist delegation as a capability tool: the EDITH agent can hand a
// deep coding task to Claude Code, Codex, or OpenCode and collect the result.
// Direct power-user access (`edith ask <agent>`) is preserved separately.
//
// Classified WRITE: specialists can modify the workspace, so delegation
// follows EDITH policy (and is approval-gated in strict mode).

import { AgentRegistry } from './registry.js';

export function makeDelegateSpecialistTool({ workspace, z, registry = new AgentRegistry(), timeoutMs = 600000 }) {
  return {
    name: 'delegate_specialist',
    title: 'Delegate to a specialist coding agent',
    description: [
      'Hand a self-contained deep coding task to a specialist agent and return its final report.',
      'Agents: claude (Claude Code), codex (Codex), opencode (OpenCode).',
      'Use only for large multi-file engineering tasks that exceed your own tools; describe the task fully — the specialist has no conversation context.'
    ].join(' '),
    safety: 'write',
    schema: {
      agent: z.enum(['claude', 'codex', 'opencode']),
      task: z.string().min(10).max(8000)
    },
    async handler({ agent: agentId, task }) {
      const agent = registry.get(agentId);
      if (!agent) throw new Error(`Unknown specialist: ${agentId}`);
      const health = await agent.health();
      if (!health.available) {
        throw new Error(`Specialist ${agent.name} is not available on this machine (${health.detail}). Do the task with your own tools instead.`);
      }
      const result = await agent.sendTask(task, { cwd: workspace, timeoutMs });
      const text = (result.text ?? '').trim() || '(specialist returned no visible output)';
      return { content: [{ type: 'text', text: `${agent.name} report:\n\n${text}` }] };
    }
  };
}
