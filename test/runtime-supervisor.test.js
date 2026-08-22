import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { RuntimeSupervisor } from '../src/runtime/supervisor.js';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'edith-supervisor-'));
}

function fakeTrueForgeServer() {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('OK!');
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function supervisorOptions(dir, port, overrides = {}) {
  return {
    port,
    stateFile: path.join(dir, 'state.json'),
    dbPath: path.join(dir, 'trueforge.sqlite'),
    logFile: path.join(dir, 'trueforge.log'),
    cliPath: path.join(dir, 'fake-cli.js'),
    startTimeoutMs: 3000,
    ...overrides
  };
}

test('runtime supervisor', async (t) => {
  await t.test('adopts an already-healthy runtime without spawning', async () => {
    const dir = await tempDir();
    const { server, port } = await fakeTrueForgeServer();
    await fs.writeFile(path.join(dir, 'fake-cli.js'), '// fake');
    let spawned = false;
    const supervisor = new RuntimeSupervisor(supervisorOptions(dir, port, {
      spawnImpl: () => { spawned = true; throw new Error('should not spawn'); }
    }));
    try {
      const result = await supervisor.ensureRunning();
      assert.equal(result.reused, true);
      assert.equal(result.managed, false);
      assert.match(result.baseUrl, /127\.0\.0\.1|\[::1\]/);
      assert.equal(spawned, false);
      // Second call reuses recorded state.
      const again = await supervisor.ensureRunning();
      assert.equal(again.reused, true);
      assert.equal(again.baseUrl, result.baseUrl);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('spawns a runtime and waits for health', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'fake-cli.js'), '// fake');
    let listening = null;
    const spawnImpl = (bin, args) => {
      const child = new EventEmitter();
      child.pid = 424242;
      child.unref = () => {};
      const portArg = Number(args[args.indexOf('--port') + 1]);
      // Simulate slow startup: begin listening after a short delay.
      setTimeout(() => {
        const server = createServer((req, res) => {
          if (req.url === '/healthz') res.writeHead(200).end('OK!');
          else res.writeHead(404).end();
        });
        server.listen(portArg, '127.0.0.1');
        server.on('error', () => {}); // port race: the retry below handles it
        listening = server;
      }, 300);
      return child;
    };
    try {
      // Picking a free port then closing it is racy under parallel test
      // files, so retry on a fresh port if another process grabbed it.
      let result = null;
      let port = null;
      for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        const probe = await fakeTrueForgeServer();
        port = probe.port;
        await new Promise((resolve) => probe.server.close(resolve));
        const supervisor = new RuntimeSupervisor(supervisorOptions(dir, port, { spawnImpl }));
        result = await supervisor.ensureRunning().catch(() => null);
        if (!result) { listening?.close(); listening = null; await supervisor.clearState(); }
      }
      assert.ok(result, 'supervisor failed to start on 3 fresh ports');
      assert.equal(result.reused, false);
      assert.equal(result.managed, true);
      assert.equal(result.pid, 424242);
      const state = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
      assert.equal(state.port, port);
      assert.equal(state.managed, true);
    } finally {
      listening?.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('fails with a clear error when the runtime never becomes healthy', async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, 'fake-cli.js'), '// fake');
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.pid = 5;
      child.unref = () => {};
      setTimeout(() => child.emit('exit', 1), 50);
      return child;
    };
    const supervisor = new RuntimeSupervisor(supervisorOptions(dir, 1, { spawnImpl, startTimeoutMs: 1500 }));
    try {
      await assert.rejects(supervisor.ensureRunning(), /failed to become healthy|trueforge\.log/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('status reports running=false after runtime dies', async () => {
    const dir = await tempDir();
    const { server, port } = await fakeTrueForgeServer();
    await fs.writeFile(path.join(dir, 'fake-cli.js'), '// fake');
    const supervisor = new RuntimeSupervisor(supervisorOptions(dir, port));
    try {
      await supervisor.ensureRunning();
      assert.equal((await supervisor.status()).running, true);
      await new Promise((resolve) => server.close(resolve));
      assert.equal((await supervisor.status()).running, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  await t.test('shutdown leaves adopted runtimes alone but clears state', async () => {
    const dir = await tempDir();
    const { server, port } = await fakeTrueForgeServer();
    await fs.writeFile(path.join(dir, 'fake-cli.js'), '// fake');
    const supervisor = new RuntimeSupervisor(supervisorOptions(dir, port));
    try {
      await supervisor.ensureRunning();
      const result = await supervisor.shutdown();
      assert.equal(result.stopped, false);
      assert.equal((await supervisor.readState()), null);
      // Server itself is untouched (still healthy).
      assert.notEqual(await supervisor.probe(port), null);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
