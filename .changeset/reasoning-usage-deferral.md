---
"openai-oauth-copilot-chat": patch
---

Keep streamed reasoning in one thinking bubble when usage arrives mid-stream

Copilot Chat merges a provider's thinking deltas only while the previous
reported part is also thinking, so interleaved usage data parts split
reasoning into one "Thought" bubble per delta and made long reasoning
appear cut off. Usage data parts are now held back while a thinking
segment is open and flushed when the segment closes.
