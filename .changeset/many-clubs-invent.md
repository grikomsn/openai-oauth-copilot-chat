---
"openai-oauth-copilot-chat": major
---

Fix parallel Responses tool identity, reasoning boundaries, fragmented SSE, and incomplete-stream errors. Retain cancellation and deadlines through body consumption. Discover valid OAuth sessions directly from SecretStorage and reconcile them with minimal observation history.

All model IDs include the profile, including default. Reselect models after upgrading; older single-account session and usage formats are not loaded.
