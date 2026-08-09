import path from 'node:path';
import { runDoctor } from '../doctor.js';
import { colors } from '../ui/terminal.js';

export class AgentRuntime {
  constructor({ router, context, tools, ui, session, sessions }) {
    this.router = router;
    this.context = context;
    this.tools = tools;
    this.ui = ui;
    this.session = session;
    this.sessions = sessions;
    this.maxIterations = 6;
  }

  async handleInput(input) {
    if (input.startsWith('/')) return this.handleCommand(input);
    this.context.addUser(input);
    try {
      await this.runAgent(input);
    } catch (error) {
      this.ui.error(error.message);
      this.context.addAssistant(`Error: ${error.message}`);
    }
  }

  async handleCommand(command) {
    const [cmd, ...rest] = command.split(/\s+/);
    if (cmd === '/help') return this.printInteractiveHelp();
    if (cmd === '/providers') return this.printProviders();
    if (cmd === '/models') return this.printModels();
    if (cmd === '/model') return this.switchModel(rest.join(' '));
    if (cmd === '/status') return this.status();
    if (cmd === '/context') return this.printContext();
    if (cmd === '/files') return this.printFiles();
    if (cmd === '/diff') return this.printDiff();
    if (cmd === '/doctor') return runDoctor({ cwd: this.context.workspace, ui: this.ui });
    if (cmd === '/clear' || cmd === '/new') {
      this.session.conversation = [];
      this.ui.line(colors.dim('Conversation cleared.'));
      return;
    }
    if (cmd === '/resume') {
      this.ui.line(colors.dim(`Current session: ${this.session.id}`));
      return;
    }
    this.ui.warn(`Unknown command ${cmd}. Try /help.`);
  }

  async runAgent(input) {
    for (let i = 0; i < this.maxIterations; i++) {
      const action = await this.plan(input);
      if (!action) break;
      const done = await this.executeAction(action, input);
      if (done) return;
    }
    await this.respond(input);
  }

  async plan(input) {
    const lower = input.toLowerCase();
    const file = extractFile(input);
    if (/inspect|architecture|explain|understand|overview/.test(lower)) return { type: 'inspect' };
    if (/git status|git state/.test(lower)) return { type: 'git' };
    if (/diff/.test(lower)) return { type: 'diff' };
    if (/read|open|show/.test(lower) && file) return { type: 'read', file };
    const search = extractSearch(input);
    if (/locate|search|find/.test(lower) && search) return { type: 'search', query: search };
    if (/run /.test(lower)) return { type: 'shell', command: input.replace(/^.*?\brun\s+/i, '') };
    if (/edit|change|replace|update|fix/.test(lower)) return { type: 'edit', file };
    return { type: 'respond' };
  }

  async executeAction(action, input) {
    if (action.type === 'inspect') {
      const result = await this.tools.inspectRepository();
      this.context.addTool('inspect_repository', result);
      await this.respond(input, 'Use the repository inspection results to explain the architecture.');
      return true;
    }
    if (action.type === 'git') {
      const result = await this.tools.gitState();
      this.context.addTool('git_state', result);
      await this.respond(input, 'Summarize the git state.');
      return true;
    }
    if (action.type === 'diff') {
      this.printDiff();
      return true;
    }
    if (action.type === 'read') {
      const text = await this.tools.readFile(action.file);
      this.context.trackFile(action.file, text);
      this.context.addTool('read_file', { file: action.file, content: text.slice(0, 12000) });
      await this.respond(input, `Explain the requested file ${action.file}.`);
      return true;
    }
    if (action.type === 'search') {
      const result = await this.tools.searchText(action.query);
      this.context.addTool('search_text', { query: action.query, hits: result });
      await this.respond(input, `Summarize search results for ${action.query}.`);
      return true;
    }
    if (action.type === 'shell') {
      const result = await this.tools.runShell(action.command);
      this.context.addTool('shell', { command: action.command, ...result });
      await this.respond(input, 'Summarize the command result.');
      return true;
    }
    if (action.type === 'edit') {
      await this.proposeEdit(input, action.file);
      return true;
    }
    return false;
  }

  async proposeEdit(input, explicitFile) {
    let file = explicitFile;
    if (!file) {
      const files = await this.tools.searchFiles('');
      file = files.find((f) => /\.(js|ts|tsx|jsx|json|md|py|css|html)$/.test(f));
    }
    if (!file) throw new Error('No editable file identified. Mention a file path.');
    const content = await this.tools.readFile(file);
    this.context.trackFile(file, content);
    const prompt = [
      `User request: ${input}`,
      `File: ${file}`,
      'Return JSON only with this shape:',
      '{"search":"exact existing text","replace":"replacement text","reason":"short reason"}',
      'The search value must be copied exactly from the file.',
      'If no safe edit is possible, return {"search":"","replace":"","reason":"explain why"}.',
      'File content:',
      content.slice(0, 16000)
    ].join('\n\n');
    this.ui.activity(`Asking model to propose edit for ${file}`);
    const raw = await this.router.complete([{ role: 'user', content: prompt }], { maxTokens: 900 });
    const proposal = parseJsonObject(raw);
    if (!proposal?.search || !proposal?.replace) {
      this.ui.warn(proposal?.reason ?? 'Model did not produce an applicable edit.');
      return;
    }
    const result = await this.tools.proposeReplace({ file, search: proposal.search, replace: proposal.replace, reason: proposal.reason });
    this.context.addTool('edit_file', { file, applied: result.applied, reason: proposal.reason });
    await this.respond(`Summarize this edit result for the user: ${JSON.stringify({ file, applied: result.applied, reason: proposal.reason })}`);
  }

  async respond(input, instruction = '') {
    const messages = this.context.messages([
      { role: 'user', content: [instruction, input].filter(Boolean).join('\n\n') }
    ]);
    this.ui.streamStart('EDITH');
    let output = '';
    for await (const chunk of await this.router.stream(messages)) {
      output += chunk;
      this.ui.streamChunk(chunk);
    }
    this.ui.streamEnd();
    this.context.addAssistant(output);
  }

  printInteractiveHelp() {
    this.ui.line(`/help /models /model /providers /status /context /files /diff /doctor /clear /new /resume /exit`);
  }

  async printProviders() {
    for (const item of await this.router.health()) this.ui.line(`${item.ok ? 'OK' : 'FAIL'} ${item.name} ${item.detail}`);
  }

  async printModels() {
    const groups = await this.router.listModels();
    for (const group of groups) {
      this.ui.section(group.providerName);
      for (const model of group.models) {
        const selected = this.router.current?.model?.id === model.id ? '●' : ' ';
        this.ui.line(`${selected} ${model.id}${model.state ? ` (${model.state})` : ''}`);
      }
    }
  }

  async switchModel(argument) {
    await this.router.refresh();
    if (argument) {
      for (const group of this.router.modelGroups) {
        const model = group.models.find((m) => m.id === argument || `${group.providerId}:${m.id}` === argument);
        if (model) {
          this.router.setCurrent(group.providerId, model.id);
          this.session.providerId = group.providerId;
          this.session.modelId = model.id;
          this.ui.line(`Selected ${model.id} · ${group.providerName}`);
          return;
        }
      }
      this.ui.warn(`Model not found: ${argument}`);
      return;
    }
    await this.printModels();
    this.ui.line('Switch with /model <model-id>');
  }

  status() {
    this.ui.line(`Workspace: ${this.context.workspace}`);
    this.ui.line(`Model: ${this.router.current?.model?.id ?? 'none'} · ${this.router.current?.providerName ?? 'none'}`);
    this.ui.line(`Session: ${this.session.id}`);
    this.ui.line(`Changed files: ${[...this.tools.changedFiles].join(', ') || 'none'}`);
  }

  async printContext() {
    const meta = await this.context.workspaceMetadata();
    this.ui.line(JSON.stringify(meta, null, 2));
  }

  printFiles() {
    const files = Object.entries(this.session.files);
    if (!files.length) return this.ui.line('No files loaded into context.');
    for (const [file, meta] of files) this.ui.line(`${file} ${meta.chars} chars ${meta.loadedAt}`);
  }

  printDiff() {
    if (!this.tools.lastDiffs.length) return this.ui.line('No EDITH-applied diffs this session.');
    for (const diff of this.tools.lastDiffs) this.ui.diff(diff.text);
  }
}

function extractFile(input) {
  const match = input.match(/(?:^|\s)([\w./-]+\.(?:js|jsx|ts|tsx|json|md|py|css|html|yml|yaml|toml|go|rs|java|rb|php|sh))(?:\s|$)/);
  return match?.[1] ? path.normalize(match[1]) : null;
}

function extractSearch(input) {
  const quoted = input.match(/["'`](.+?)["'`]/);
  if (quoted) return quoted[1];
  const afterFor = input.match(/\b(?:for|find|locate|search)\s+([A-Za-z0-9_.$:-]+)/i);
  return afterFor?.[1] ?? null;
}

function parseJsonObject(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}
