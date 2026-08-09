import fs from 'node:fs/promises';
import path from 'node:path';

export class ContextEngine {
  constructor({ workspace, session }) {
    this.workspace = path.resolve(workspace);
    this.session = session;
  }

  addUser(content) {
    this.session.conversation.push({ role: 'user', content, at: new Date().toISOString() });
  }

  addAssistant(content) {
    this.session.conversation.push({ role: 'assistant', content: trim(content, 12000), at: new Date().toISOString() });
  }

  addTool(name, result) {
    this.session.conversation.push({ role: 'tool', name, content: trim(JSON.stringify(result), 8000), at: new Date().toISOString() });
  }

  trackFile(filePath, content) {
    this.session.files[filePath] = {
      chars: content.length,
      loadedAt: new Date().toISOString(),
      excerpt: trim(content, 4000)
    };
  }

  messages(extra = []) {
    const base = [
      {
        role: 'system',
        content: [
          'You are EDITH, a local coding agent. Respond concisely.',
          'Use only provided repository context and tool results as evidence.',
          'Do not reveal hidden reasoning. If edits are needed, explain the proposed change clearly.',
          `Workspace: ${this.workspace}`
        ].join('\n')
      }
    ];
    const recent = this.session.conversation.slice(-16).map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.role === 'tool' ? `Tool result ${m.name}: ${m.content}` : m.content
    }));
    return [...base, ...recent, ...extra];
  }

  async workspaceMetadata() {
    const files = await fs.readdir(this.workspace).catch(() => []);
    return { workspace: this.workspace, topLevel: files.slice(0, 100), trackedFiles: Object.keys(this.session.files) };
  }
}

function trim(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}
