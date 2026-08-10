# Configuration

EDITH uses local configuration and live provider discovery. Secrets must stay outside Git.

## Providers

LM Studio and Ollama are discovered through their local APIs. NVIDIA NIM is available as an optional remote OpenAI-compatible provider when `NVIDIA_API_KEY` is set.

Typical endpoints:

```text
LM Studio: http://127.0.0.1:1234
Ollama:    http://127.0.0.1:11434
NVIDIA:    https://integrate.api.nvidia.com/v1
```

## Environment Variables

Supported optional variables include:

```bash
EDITH_CODE_MODEL=lmstudio-local/qwen/qwen3-vl-4b
EDITH_AUDIT_DIR=~/.edith/audit
BRAVE_SEARCH_API_KEY=placeholder
EDITH_SEARXNG_URL=http://127.0.0.1:8080
EDITH_GOOGLE_CLIENT_ID=placeholder
EDITH_GOOGLE_CLIENT_SECRET=placeholder
NVIDIA_API_KEY=placeholder
EDITH_NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

## Hybrid processing

`processing.mode` defaults to `local-first`. Supported values are `local-first`, `balanced`, and `performance`; all values retain secret-egress protection. Public-only research may use NVIDIA when a configured model is eligible. Personal, sensitive, and mixed-data synthesis remains local.

Do not commit real values.

## Google OAuth Client

The preferred local OAuth client file path is:

```text
~/.config/edith/google-oauth-client.json
```

Recommended permissions:

```bash
chmod 700 ~/.config/edith
chmod 600 ~/.config/edith/google-oauth-client.json
```

This file must not be committed.

## Audit Directory

Audit events default to:

```text
~/.edith/audit
```

Audit records are JSONL and redacted for common secret patterns.
