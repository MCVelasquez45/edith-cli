// EDITH's loopback-only capability service: a streamable-HTTP MCP server that
// exposes the coding toolset to the TrueForge runtime. This is the single
// capability bus between EDITH and the runtime — TrueForge's MCP client is
// remote-transport only (stdio cannot attach), so EDITH tools are served over
// local HTTP, bound strictly to a loopback interface.

import { createServer } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { buildToolset, Safety } from './toolset.js';

export class CapabilityService {
  constructor({ workspace, tools = null, host = '127.0.0.1', port = 0, onError = null }) {
    this.workspace = workspace;
    this.tools = tools ?? buildToolset({ workspace });
    this.host = host;
    this.port = port;
    this.onError = onError;
    this.httpServer = null;
    this.handler = null;
  }

  buildMcpServer() {
    const server = new McpServer({ name: 'edith-capabilities', version: '0.1.0' });
    for (const tool of this.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: z.object(tool.schema ?? {}),
          annotations: {
            readOnlyHint: tool.safety === Safety.READ,
            destructiveHint: tool.safety === Safety.DESTRUCTIVE
          }
        },
        async (args) => {
          try {
            return await tool.handler(args ?? {});
          } catch (error) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error: ${error.message}` }]
            };
          }
        }
      );
    }
    return server;
  }

  async start() {
    if (this.httpServer) return this.url;
    this.handler = createMcpHandler(() => this.buildMcpServer(), {
      onerror: (error) => this.onError?.(error)
    });

    this.httpServer = createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith('/mcp')) {
          res.writeHead(404).end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(`http://${this.host}:${this.boundPort}${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : body
        });
        const response = await this.handler.fetch(request);
        const headers = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        res.writeHead(response.status, headers);
        if (response.body) {
          for await (const chunk of response.body) res.write(chunk);
        }
        res.end();
      } catch (error) {
        this.onError?.(error);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: error.message }, id: null }));
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
    if (!this.httpServer) return null;
    return `http://${this.host}:${this.boundPort}/mcp`;
  }

  async stop() {
    if (this.handler) await this.handler.close().catch(() => {});
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }
  }
}
