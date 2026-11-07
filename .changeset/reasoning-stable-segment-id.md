---
"openai-oauth-copilot-chat": patch
---

Stabilize reasoning segment identity so thinking stays in one bubble

The chat renderer assigns fallback ids and timing to id-less thinking
parts as they render; the next delta then reads as a different reasoning
run and the model stops merging, splitting one reasoning stream into a
bubble per delta ("thinking cut off"). Reporters now send a stable
request-scoped segment id on every thinking part, keeping all deltas of
a segment mergeable for the whole stream.
