---
"openai-oauth-copilot-chat": minor
---

Add a stream idle timeout and harden request encoding

- New `openaiCodex.streamIdleTimeoutSeconds` setting (default 120) aborts a streaming response that stops sending data, in addition to the total request timeout.
- Request bodies, tool arguments, and tool outputs no longer carry lone UTF-16 surrogates, which some upstreams reject as invalid JSON.
- The model picker shows the cached-input price next to input and output prices when it is known.

Shared provider plumbing now comes from the copilot-chat-kit submodule, so fixes land in every Copilot Chat provider extension at once.
