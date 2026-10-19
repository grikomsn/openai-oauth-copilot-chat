---
"openai-oauth-copilot-chat": patch
---

Map aborted requests to a friendly "Request cancelled or timed out" message in
shared error formatting instead of surfacing the raw AbortError text.
