# Getting Started

## Requirements

- macOS for Keychain-backed Google token storage
- Node.js 20 or newer
- npm
- Optional: LM Studio
- Optional: Ollama
- Optional: OpenCode, Codex, Claude Code
- Optional: `gh` and `glab` for GitHub/GitLab context

## Install

```bash
git clone git@github.com:MCVelasquez45/edith-cli.git
cd edith-cli
npm ci
npm link
```

Verify:

```bash
edith --version
edith --help
npm test
edith doctor
```

## First Run

```bash
edith
```

This launches the native EDITH conversational TUI. Type natural language and press Enter.

Useful first prompts:

```text
What model are you using?
What directory am I working in?
What time is it?
Can you search the web?
What personal context can you access?
```

## Coding Mode

```bash
edith code
```

This hands the terminal to OpenCode. Use it when you want the full OpenCode coding-agent TUI.

## Local Models

Start LM Studio and/or Ollama before running:

```bash
edith providers
edith models
```

EDITH discovers models at runtime.

