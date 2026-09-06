# Models and pricing

## Live model directory

The extension discovers the catalog available to the signed-in Codex profile
from the live ChatGPT backend model directory,
`https://chatgpt.com/backend-api/codex/models?client_version=<version>`. The
requested client version is pinned in `src/transport/protocol.ts` and updated
with `npm run update-codex-version`; it can be overridden temporarily with the
`openaiCodex.codexVersion` setting.

Live directory responses are authoritative. They provide each model's display
name, description, context window, image-input and tool-calling capabilities,
and the reasoning levels (including defaults) offered by the Codex backend.
Hidden directory entries and models without a usable reasoning level are
omitted from the picker. Fast remains a capability on the normal entry and is
selected through the model's native Speed Mode configuration instead of a
second picker entry.

## models.dev enrichment

Fields that the live directory omits are enriched from the canonical `openai`
provider in models.dev. The extension fetches
`https://models.dev/api.json`, normalizes the response defensively, and stores
a snapshot in VS Code `globalState` under
`openaiCodex.modelsDevMetadata.v1` (`src/models/metadata.ts`). The snapshot is
refreshed after six hours; the stored snapshot is returned immediately while a
refresh runs in the background and remains available when models.dev is
unreachable. Enriched fields include the context window, maximum input and
output lengths, image input, tool calling, reasoning support and reasoning
options, release and update dates, and per-model cost.

## Pricing

The model picker displays each model's input, cached-input, and output pricing.
`src/models/pricing.ts` prefers a cost discovered from the live directory or
models.dev enrichment and falls back to checked-in official OpenAI rates when
no discovered cost is available. Costs are rendered as
`In: $<input> · Out: $<output> /1M tokens` picker detail with a cached-input
price when known, plus a low/medium/high/very-high price category.
