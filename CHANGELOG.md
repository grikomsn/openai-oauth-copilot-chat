# Changelog

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
