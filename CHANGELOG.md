# Changelog

## 0.10.5

### Patch Changes

- fa3c551: Recover final Responses API text when deltas are missing and retry transient inference connection failures before a response is received.

## 0.10.4

### Patch Changes

- 6a99adc: Refresh the live Codex model catalog with the latest client version.

## 0.10.3

### Patch Changes

- e43ccf5: Clarify that profile selection controls usage and management, and offer the VS Code chat model picker to switch the account used for inference.

## 0.10.2

### Patch Changes

- 4b02c13: Add an optional Codex model-catalog client version setting.

## 0.10.1

### Patch Changes

- 403427d: Restore the selected profile for usage and management after restart, clarify that native model entries retain their own account routing, and keep legacy default entries valid.

## 0.10.0

### Minor Changes

- b3b0c21: Add native named Codex Bridge provider entries with isolated ChatGPT OAuth profiles, model catalogs, refreshes, and usage state.

## 0.9.0

### Minor Changes

- 48b7243: Add an explicit model refresh command, initialize the usage indicator consistently, and redact account identity from diagnostics.

### Patch Changes

- 48b7243: Enrich the authoritative live Codex model directory with a persisted, stale-while-revalidate models.dev metadata snapshot.
- 48b7243: Default ordered reasoning controls to High when supported while retaining the live model's supported levels.

## 0.8.0

### Minor Changes

- d735745: Add configurable caching for the live Codex model catalog, with last-known-good model metadata retained when refreshes fail.

## 0.7.0

### Minor Changes

- 7969ef9: Add opt-in native image generation through the Codex Responses provider, including streamed image output in Copilot Chat.

## 0.6.0

### Minor Changes

- 656cb92: Add an opt-in Web Search toggle beside the model reasoning controls and forward hosted Responses API search annotations to Copilot.

## 0.5.2

### Patch Changes

- 874d062: Harden Codex reset-credit requests with originator and account routing, and prevent non-available credits from being redeemable.

## 0.5.1

### Patch Changes

- 4a67635: Show available Codex banked reset credits with expiry details and require explicit confirmation before redeeming a selected reset.

## 0.5.0

### Minor Changes

- edea3d0: Discover models from the signed-in account's live Codex catalog using the latest stable Codex release version, prettify catalog display labels without changing product names, use its requestable reasoning efforts and defaults without a local allowlist, exclude the internal-only `ultra` delegation level, expose native per-model Speed Mode controls without duplicate Fast entries, honor live capability metadata and effective context limits, retain legacy workspace speed and reasoning settings as compatibility fallbacks, and reuse eligible prompt prefixes while reporting cache read/write token usage.

## 0.4.1

### Patch Changes

- Refresh the Codex model picker metadata to match the current upstream catalog, including the visible GPT-5.6 family, corrected 272K context windows, and updated GPT-5.2 reasoning options.

## 0.4.0

### Minor Changes

- d936863: Identify requests as Codex Bridge, require OAuth callback state validation, clarify CLI credential import, and update the extension's visible product name.

## 0.3.1

### Patch Changes

- Keep separate Codex reasoning summaries in distinct Copilot Chat thinking blocks.

## 0.3.0

- Normalize Codex Responses token usage for Copilot Chat context-window accounting
- Add a persisted status-bar indicator for ChatGPT Codex quota windows and inference tokens
- Add a detailed usage picker with reset times, last-request tokens, and device-local totals

## 0.2.0

- Per-model Normal/Fast speed mode and supported reasoning-effort combinations in one Copilot Chat picker

## 0.1.0

- Initial OpenAI Codex language model provider for GitHub Copilot Chat
- ChatGPT OAuth with browser, manual, refresh, and Codex CLI import flows
- Streaming text, reasoning summaries, images, tools, usage metadata, diagnostics, and connection testing
