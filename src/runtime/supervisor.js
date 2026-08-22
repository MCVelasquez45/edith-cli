// EDITH-owned lifecycle for the local TrueForge runtime.
// The user never starts TrueForge: `edith` detects a healthy runtime and
// reuses it, or spawns one (standalone mode, SQLite under ~/.edith/runtime),
// waits for health, and records state for later reuse/shutdown.
//
// Verified TrueForge behavior this module accounts for: the server may bind
// IPv6 `::1` only, so health checks and the published base URL probe both
// `[::1]` and `127.0.0.1` and use whichever answers.

import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TrueForgeClient } from './client.js';
import { runtimeStateFile, runtimeDbPath, runtimeLogFile, ensureEdithDirs } from './paths.js';

const PACKAGE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const DEFAULT_RUNTIME_PORT = 8619;
const LOOPBACK_HOSTS = ['[::1]', '127.0.0.1'];

export class RuntimeSupervisor {
  constructor({
    port = Number(process.env.EDITH_RUNTIME_PORT ?? DEFAULT_RUNTIME_PORT),
    stateFile = runtimeStateFile(),
    dbPath = runtimeDbPath(),
    logFile = runtimeLogFile(),
    cliPath = null,
    fetchImpl = fetch,
    spawnImpl = spawn,
    startTimeoutMs = 45000,
    nodeBin = process.execPath
  } = {}) {
    this.port = port;
    this.stateFile = stateFile;
    this.dbPath = dbPath;
    this.logFile = logFile;
    this.explicitCliPath = cliPath;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.startTimeoutMs = startTimeoutMs;
    this.nodeBin = nodeBin;
  }

  async resolveCliPath() {
    const candidates = [
      this.explicitCliPath,
      process.env.EDITH_TRUEFORGE_CLI,
      path.join(PACKAGE_ROOT, 'node_modules', '@truefoundry', 'trueforge', 'dist', 'cli.js')
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch { /* try next */ }
    }
    throw new Error(
      'TrueForge runtime not found. Reinstall EDITH (`npm install`) or set EDITH_TRUEFORGE_CLI to the TrueForge cli.js path.'
    );
  }

  async readState() {
    try {
      return JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async writeState(state) {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  async clearState() {
    await fs.rm(this.stateFile, { force: true });
  }

  // Probe both loopback hosts on a port; return a healthy base URL or null.
  async probe(port) {
    for (const host of LOOPBACK_HOSTS) {
      const baseUrl = `http://${host}:${port}`;
      const client = new TrueForgeClient({ baseUrl, fetchImpl: this.fetchImpl });
      if (await client.health({ timeoutMs: 1500 })) return baseUrl;
    }
    return null;
  }

  // Ensure a healthy runtime, reusing an existing one when possible.
  // Returns { baseUrl, port, pid, managed, reused }.
  async ensureRunning({ onStatus } = {}) {
    const state = await this.readState();

    // 1. A runtime we previously started (or adopted) is still healthy — reuse.
    if (state?.baseUrl) {
      const client = new TrueForgeClient({ baseUrl: state.baseUrl, fetchImpl: this.fetchImpl });
      if (await client.health({ timeoutMs: 1500 })) {
        return { ...state, reused: true };
      }
      await this.clearState();
    }

    // 2. Something healthy is already answering on the configured port — adopt it.
    const adoptedBase = await this.probe(this.port);
    if (adoptedBase) {
      const adopted = { baseUrl: adoptedBase, port: this.port, pid: null, managed: false, startedAt: new Date().toISOString() };
      await this.writeState(adopted);
      return { ...adopted, reused: true };
    }

    // 3. Start our own.
    onStatus?.('starting runtime');
    const cliPath = await this.resolveCliPath();
    await ensureEdithDirs();
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await fs.mkdir(path.dirname(this.logFile), { recursive: true });

    const logFd = openSync(this.logFile, 'a');
    let child;
    try {
      child = this.spawnImpl(this.nodeBin, [cliPath, '--port', String(this.port)], {
        env: {
          ...process.env,
          STANDALONE: 'true',
          SQLITE_PATH: this.dbPath,
          PORT: String(this.port)
        },
        detached: true,
        stdio: ['ignore', logFd, logFd]
      });
      child.unref();
    } finally {
      closeSync(logFd);
    }

    const startedPid = child.pid ?? null;
    const deadline = Date.now() + this.startTimeoutMs;
    let baseUrl = null;
    let exited = false;
    child.once?.('exit', () => { exited = true; });
    while (Date.now() < deadline) {
      baseUrl = await this.probe(this.port);
      if (baseUrl) break;
      if (exited) break;
      await sleep(400);
    }
    if (!baseUrl) {
      throw new Error(
        `TrueForge runtime failed to become healthy on port ${this.port} within ${Math.round(this.startTimeoutMs / 1000)}s. ` +
        `See ${this.logFile} for details.`
      );
    }

    const newState = {
      baseUrl,
      port: this.port,
      pid: startedPid,
      managed: true,
      cliPath,
      dbPath: this.dbPath,
      startedAt: new Date().toISOString()
    };
    await this.writeState(newState);
    return { ...newState, reused: false };
  }

  async status() {
    const state = await this.readState();
    if (!state?.baseUrl) return { running: false, state: null };
    const client = new TrueForgeClient({ baseUrl: state.baseUrl, fetchImpl: this.fetchImpl });
    const healthy = await client.health({ timeoutMs: 1500 });
    return { running: healthy, state };
  }

  // Stop a runtime we manage. Adopted (unmanaged) runtimes are left alone.
  async shutdown({ force = false } = {}) {
    const state = await this.readState();
    if (!state) return { stopped: false, reason: 'not running' };
    if (!state.managed || !state.pid) {
      await this.clearState();
      return { stopped: false, reason: 'runtime not managed by EDITH' };
    }
    const killed = await terminate(state.pid, { force });
    await this.clearState();
    return { stopped: killed, pid: state.pid };
  }

  async restart({ onStatus } = {}) {
    await this.shutdown();
    return this.ensureRunning({ onStatus });
  }
}

async function terminate(pid, { force = false, waitMs = 5000 } = {}) {
  if (!isAlive(pid)) return false;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(150);
  }
  if (force || isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  await sleep(100);
  return !isAlive(pid);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
