# MCP

EDITH includes Model Context Protocol client and server foundations.

## Goals

- connect to approved MCP servers
- list tools/resources/prompts
- invoke approved tools
- expose a small safe EDITH MCP server
- keep MCP behind EDITH's Tool Registry and policy boundary

## Commands

```bash
edith mcp status
edith mcp list
edith mcp inspect <server>
edith mcp tools <server>
edith mcp resources <server>
edith mcp prompts <server>
edith mcp test <server>
edith mcp discover
```

## Safety

EDITH does not automatically import all MCP servers found on the machine. Server and tool allowlists are required. Tool calls are audited and normalized.

## Current Self Server

The EDITH MCP server exposes a small safe surface such as status and model listing. It is intended as a future bridge for other agents to call EDITH without driving the TUI.

