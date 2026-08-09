# Local Models

EDITH treats local inference providers as runtime dependencies.

## Providers

### LM Studio

LM Studio is used through its local OpenAI-compatible API. EDITH discovers models from the live provider instead of hard-coding inventory.

### Ollama

Ollama is used through the local Ollama API. Installed models are discovered dynamically.

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

## Verification

Provider reachability is not the same as model usability. Use:

```bash
edith doctor
edith
```

Then ask for a visible response through the native TUI.

