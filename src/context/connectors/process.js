import { spawn } from 'node:child_process';
import { redactSecrets } from '../../security/redact.js';

const MAX_OUTPUT_BYTES = 128000;

export function commandExists(command) {
  if (!/^[A-Za-z0-9._-]+$/.test(command)) return Promise.resolve(false);
  return runProcess('sh', ['-lc', `command -v ${command}`], { timeoutMs: 3000 })
    .then((result) => result.code === 0)
    .catch(() => false);
}

export function runJson(command, args, options = {}) {
  return runProcess(command, args, options).then((result) => {
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
    if (!result.stdout.trim()) return null;
    return JSON.parse(result.stdout);
  });
}

export function runText(command, args, options = {}) {
  return runProcess(command, args, options).then((result) => {
    if (result.code !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
    return result.stdout.trim();
  });
}

function runProcess(command, args, { cwd = process.cwd(), timeoutMs = 15000, shell = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, redactSecrets(chunk.toString()));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 130 : code ?? 1, stdout, stderr });
    });
  });
}

function appendBounded(current, next) {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return (current + next).slice(0, MAX_OUTPUT_BYTES);
}
