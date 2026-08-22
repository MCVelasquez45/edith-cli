// Loopback key-injection proxy for cloud model providers.
//
// TrueForge persists provider api_keys in plaintext SQLite. EDITH's security
// rule forbids that, so cloud providers are registered against this proxy:
// it listens on 127.0.0.1 only, forwards requests to exactly one approved
// upstream, and injects the Authorization header at request time from the
// environment/Keychain. The secret never enters TrueForge state.

import { createServer } from 'node:http';

export class ModelKeyProxy {
  constructor({ upstreamBaseUrl, getApiKey, host = '127.0.0.1', port = 0 }) {
    this.upstream = new URL(upstreamBaseUrl);
    this.getApiKey = getApiKey;
    this.host = host;
    this.port = port;
    this.httpServer = null;
  }

  async start() {
    if (this.httpServer) return this.url;
    this.httpServer = createServer(async (req, res) => {
      try {
        const key = await this.getApiKey();
        if (!key) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'EDITH: no cloud API key configured' } }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstreamPath = this.upstream.pathname.replace(/\/$/, '') + req.url;
        const response = await fetch(`${this.upstream.origin}${upstreamPath}`, {
          method: req.method,
          headers: {
            'content-type': req.headers['content-type'] ?? 'application/json',
            accept: req.headers.accept ?? 'application/json',
            authorization: `Bearer ${key}`
          },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        const headers = {};
        response.headers.forEach((value, name) => {
          if (!['content-length', 'transfer-encoding', 'connection', 'content-encoding'].includes(name)) headers[name] = value;
        });
        res.writeHead(response.status, headers);
        if (response.body) {
          for await (const chunk of response.body) res.write(chunk);
        }
        res.end();
      } catch (error) {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `EDITH cloud proxy error: ${error.message}` } }));
      }
    });
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.port, this.host, resolve);
    });
    this.boundPort = this.httpServer.address().port;
    return this.url;
  }

  get url() {
    return this.httpServer ? `http://${this.host}:${this.boundPort}` : null;
  }

  async stop() {
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }
  }
}
