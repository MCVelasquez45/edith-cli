import { spawn } from 'node:child_process';
import { redactSecrets } from '../security/redact.js';

const SERVICE = 'edith.google';

export class KeychainTokenStore {
  constructor({ service = SERVICE } = {}) {
    this.service = service;
  }

  async get(account) {
    const result = await runSecurity(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (result.code !== 0) return null;
    return JSON.parse(result.stdout);
  }

  async set(account, value) {
    const payload = JSON.stringify(value);
    await runSecurity(['delete-generic-password', '-s', this.service, '-a', account]).catch(() => null);
    const result = await runSecurity(['add-generic-password', '-U', '-s', this.service, '-a', account, '-w', payload]);
    if (result.code !== 0) throw new Error(result.stderr || 'Unable to store token in macOS Keychain.');
  }

  async delete(account) {
    await runSecurity(['delete-generic-password', '-s', this.service, '-a', account]).catch(() => null);
  }

  label() {
    return 'macOS Keychain';
  }
}

export class MemoryTokenStore {
  constructor() {
    this.values = new Map();
  }

  async get(account) {
    return this.values.get(account) ?? null;
  }

  async set(account, value) {
    this.values.set(account, value);
  }

  async delete(account) {
    this.values.delete(account);
  }

  label() {
    return 'memory';
  }
}

function runSecurity(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += redactSecrets(chunk.toString());
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
