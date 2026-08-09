export const Risk = {
  READ_ONLY: 'READ_ONLY',
  WORKSPACE_WRITE: 'WORKSPACE_WRITE',
  DEPENDENCY_CHANGE: 'DEPENDENCY_CHANGE',
  NETWORK: 'NETWORK',
  SYSTEM_CHANGE: 'SYSTEM_CHANGE',
  DESTRUCTIVE: 'DESTRUCTIVE'
};

export class PermissionPolicy {
  constructor({ approvalMode = 'safe' }) {
    this.approvalMode = approvalMode;
    this.sessionAllows = new Set();
  }

  classifyCommand(command) {
    const c = command.trim();
    if (/^(pwd|ls|find|rg|grep|cat|sed|head|tail|wc|git status|git diff|git branch --show-current|npm test|npm run [\w:-]+|node --test)(\s|$)/.test(c)) return Risk.READ_ONLY;
    if (/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/.test(c)) return Risk.DEPENDENCY_CHANGE;
    if (/\b(curl|wget|ssh|scp|git push|git pull|git fetch|gh pr|gh api)\b/.test(c)) return Risk.NETWORK;
    if (/\b(sudo|brew|launchctl|chmod|chown|open)\b/.test(c)) return Risk.SYSTEM_CHANGE;
    if (/\b(rm|rmdir|mv|git reset|git checkout|git clean|dd|mkfs)\b/.test(c)) return Risk.DESTRUCTIVE;
    return Risk.WORKSPACE_WRITE;
  }

  async authorize({ ui, action, risk, command }) {
    if (risk === Risk.READ_ONLY) return true;
    if (risk === Risk.DESTRUCTIVE) {
      ui.error(`Denied destructive action: ${command ?? action}`);
      return false;
    }
    if (this.approvalMode === 'safe' || this.approvalMode === 'ask') {
      const key = `${risk}:${command ?? action}`;
      if (this.sessionAllows.has(key)) return true;
      const choice = await ui.approve({
        title: 'Approval required',
        body: `EDITH wants to ${action}${command ? `:\n\n${command}` : ''}\n\nRisk: ${risk}`,
        choices: ['Yes once', 'Yes for session', 'No']
      });
      if (choice === 'Yes for session') this.sessionAllows.add(key);
      return choice === 'Yes once' || choice === 'Yes for session';
    }
    return false;
  }
}
