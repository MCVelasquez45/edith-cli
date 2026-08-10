# Hybrid Processing

EDITH is the control plane. Providers, specialist agents, and tools are workers.

```text
user -> request analysis -> data classification -> egress policy
     -> execution plan -> tools / local models / cloud models / specialists
     -> local final synthesis -> user
```

## Routing

Requests are classified deterministically before a model call. The classifier identifies conversation, reasoning, coding, repository analysis, research, current information, personal context, creative work, synthesis, tool use, and specialist delegation.

`local-first` is the default processing mode. `balanced` and `performance` are available as configuration values for future policy tuning. Explicit model or agent selection is honored when safe.

Tools retrieve or change information. Processors reason over approved inputs. Weather, web search, Gmail, Calendar, Drive, Git, and MCP remain tool surfaces; LM Studio, Ollama, NVIDIA NIM, Codex, Claude, and OpenCode remain processing workers.

## Privacy boundary

EDITH labels inputs as `PUBLIC`, `LOCAL`, `PERSONAL`, `SENSITIVE`, or `SECRET`.

- Public data may be sent to an external processor after sanitization.
- Local, personal, and sensitive data stay local by default.
- Secret data is never eligible for external model processing.
- Mixed public and personal requests are split. Public research may be analyzed by NVIDIA, while private context and final synthesis stay local.
- Specialist agents use the same boundary and receive sanitized, bounded prompts.

Audit events record processor, data classification, egress decision, sanitization, payload size, and timing metadata without raw payload contents.

## NVIDIA NIM

NVIDIA is an optional cloud processing tier. It is eligible for larger public research and synthesis, but it is never selected as EDITH's automatic default. Configure `NVIDIA_API_KEY` in the environment and use `nvidia:z-ai/glm-5.2` for explicit selection. EDITH falls back to local processing if NVIDIA is unavailable.

## Operational visibility

The native cockpit reports tool and processor activity such as public research, NVIDIA analysis, calendar retrieval, specialist delegation, and local synthesis. `/trace` exposes operational routing metadata only; it does not expose prompts, credentials, or chain-of-thought.
