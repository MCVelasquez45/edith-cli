import { spawn } from 'node:child_process';

export function runProcess(command, args, { cwd = process.cwd(), timeoutMs = 120000, input, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 130 : code ?? 1, stdout, stderr });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function commandVersion(command, args = ['--version']) {
  try {
    const result = await runProcess(command, args, { timeoutMs: 10000 });
    return { available: result.code === 0, version: result.stdout.trim() || result.stderr.trim() };
  } catch (error) {
    return { available: false, version: '', error: error.message };
  }
}
