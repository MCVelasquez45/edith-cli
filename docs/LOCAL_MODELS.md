# Local Models

EDITH treats inference providers as runtime dependencies.

## Providers

### LM Studio

LM Studio is used through its local OpenAI-compatible API. EDITH discovers models from the live provider instead of hard-coding inventory.

### Ollama

Ollama is used through the local Ollama API. Installed models are discovered dynamically.

### NVIDIA NIM

NVIDIA NIM is used through NVIDIA's OpenAI-compatible API when `NVIDIA_API_KEY` is available in the environment. EDITH discovers `/v1/models` when possible and otherwise shows a small built-in fallback catalog of known NVIDIA-hosted chat models.

## Model Roles

EDITH tracks capabilities such as:

- chat
- streaming
- coding
- tool-calling hints
- vision
- embeddings

Embedding models are not routed as normal chat models.

## Commands

```bash
edith providers
edith models
edith chat --model <provider:model-id>
edith --model <provider:model-id>
```

Example:

```bash
edith chat --model nvidia:z-ai/glm-5.2
```

## Verification

Provider reachability is not the same as model usability. Use:

```bash
edith doctor
edith
```

Then ask for a visible response through the native TUI.
