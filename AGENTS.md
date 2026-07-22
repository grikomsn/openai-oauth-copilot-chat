# Repository guidance

## Scope and setup

- These instructions apply to the entire repository.
- This is a TypeScript VS Code extension. Use Node.js 22+ and npm; `package-lock.json` is authoritative.
- Install from a clean checkout with `npm ci`.

## Code map

- `src/extension.ts`: activation, commands, UI, diagnostics, and usage status.
- `src/oauth.ts`: PKCE sign-in, refresh, callback handling, and secret persistence.
- `src/provider.ts`: VS Code chat-provider integration and Responses API translation.
- `src/sse.ts`: incremental SSE parsing into text, reasoning, tool-call, and usage events.
- `src/model-options.ts`: per-model speed/reasoning capabilities and request options.
- `src/usage.ts`: quota parsing, local usage tracking, and display formatting.
- `src/protocol.ts`: shared endpoints and request identity constants.
- Tests are colocated as `src/*.test.ts`; `out/` and `*.vsix` are generated artifacts.

## Commands

- `npm run compile` — clean and type-check into `out/`.
- `npm test` or `npm run check` — compile and run all Node test files.
- `npm run package` — validate and build the installable VSIX.
- `npm run watch` — compile continuously; press F5 with the repository launch configuration for an Extension Development Host.

## Working agreements

- Keep changes focused and follow the existing strict TypeScript style: explicit public types, small helpers, double quotes, and two-space indentation.
- Add or update colocated `node:test` coverage for behavior changes. Prefer pure-function tests; OAuth and network paths must use injected fakes rather than live services.
- Preserve the stateless request contract: `store: false`, full conversation history, encrypted reasoning continuity, cancellation, and one forced token refresh after a 401.
- Keep OAuth credentials in VS Code `SecretStorage`. Never log or commit tokens, callback URLs, private prompts, captured responses, or account data.
- Requests must use the originator and user agent from `src/protocol.ts`; never impersonate the official Codex CLI or OpenAI VS Code extension.
- Treat the OAuth client and ChatGPT backend as undocumented integration surfaces. Parse defensively and keep protocol-specific behavior covered by tests.
- When commands, settings, models, security behavior, or user workflows change, keep `package.json`, tests, and relevant documentation synchronized.
- Do not commit generated `out/`, source maps, VSIX files, logs, or unrelated formatting/dependency churn.

## Before handing off

- Run the narrowest relevant test while iterating, then `npm run check`.
- Also run `npm run package` for manifest, packaging, or release-facing changes. Live authentication checks belong in the Extension Development Host.
- Add a Changeset with `npm run changeset` for user-visible published-extension changes. Documentation, tests, and repository-maintenance-only changes do not require one.
