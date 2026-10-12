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
selected through the model's configuration instead of a second picker entry.

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

The checked-in fallback covers the current flagship and coding-tuned models,
including `gpt-6-astra` ($10 / $50), `gpt-6.1-sol` ($2 / $10, cached input
$0.10), `gpt-6-sol` ($2 / $10, cached input $0.20), `gpt-6-luna`
($0.10 / $0.50), `gpt-5.6-sol`/`gpt-5.6` ($4 / $20),
`gpt-5.6-terra` ($2 / $12), `gpt-5.6-luna` ($0.20 / $1.20), and the
`gpt-5.3-codex` family ($1.75 / $14). Rates are the official OpenAI standard
per-million rates from the [OpenAI pricing page](https://developers.openai.com/api/docs/pricing).

## Context window size

Each model entry exposes a Context Window control in the Copilot Chat model
picker (`src/models/options.ts`). The options are Auto (the default), fixed
64K, 128K, and 200K tiers that fit below the model's registered input limit,
and Maximum. Auto and Maximum keep the default behavior, where the full
effective context limit from the live directory is available and the Codex
backend compacts long sessions server-side.

A specific tier acts as a local upper limit: the selection is stored per model
by VS Code, never exceeds the model's registered input limit, and when the
converted request input exceeds the selected tier the oldest conversation turns
are trimmed before the request is built (`src/provider/history-trim.ts`). The
first turn, the current turn, and tool-call/reasoning adjacency are always
preserved, and models without a fitting tier keep their picker unchanged.

### Context indicator compatibility

Auto uses the model's registered input budget. The context indicator shows that
input budget plus the response reserve; a numeric context tier replaces only
the input budget. Auto is stored as `"auto"`, because VS Code interprets numeric
zero as a zero-token input window. If an existing chat still shows only the
output limit after upgrading, select Auto again in its Context Window control
to replace a saved zero selection.

Context Window uses the dedicated tokens group so it remains visible beside
reasoning controls. VS Code renders only one enum property per group.
Reasoning effort is always published under `reasoningEffort`, with the exact
values advertised by the live Codex directory. The VS Code Insiders Copilot SDK
BYOK bridge reads this specific property when discovering model effort options;
a combined `mode` property is not recognized. The selected effort is sent to
OpenAI as `reasoning.effort`, independently of speed.

Fast-capable models expose a separate Speed Mode setting. When Context Window
occupies the tokens group, Speed Mode remains available in per-model
configuration rather than replacing the reasoning control. Fast requests send
`service_tier: "priority"`. The SDK bridge forwards reasoning effort, but does
not currently expose all of the extension's other per-model controls.

After upgrading from the combined High / High Fast picker, reselect the desired
effort and speed: VS Code may discard saved `mode` values that are no longer in
the schema. Legacy combined values are still accepted if supplied by a caller.

References: [VS Code thinking-effort documentation](https://code.visualstudio.com/docs/agent-customization/language-models#configure-thinking-effort),
[Insiders BYOK bridge](https://github.com/microsoft/vscode/blob/ff00e788322523ee1e9e8ee2c9bb4b89af93a3c2/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts),
and [OpenAI reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning).
