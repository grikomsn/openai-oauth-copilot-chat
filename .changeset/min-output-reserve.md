---
"openai-oauth-copilot-chat": patch
---

Reserves a minimum 8,192-token output budget when advertising model limits, so models whose auto-compact session budget fills the effective context window no longer show a zero-token output budget in the model picker.
