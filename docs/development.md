# Development

## Prerequisites

- Node.js 22 or newer
- npm
- VS Code 1.131 or newer

## Validate

```bash
npm ci
npm test
npm run package
npx vsce ls
```

The tests compile strict TypeScript and use Node's built-in test runner. Network
paths use injected fetch fakes; the normal test suite never calls OpenAI or
ChatGPT with real credentials. `npm run package` validates the project and
creates an installable VSIX.

## Architecture

The extension is organized around responsibility-based modules:

- `auth/auth.ts` performs PKCE authorization, refresh, local callback handling, and secure-session persistence.
- `provider.ts` is the VS Code language-model provider facade; conversion and response projection live in `provider/`.
- `transport/` owns authenticated HTTP requests, protocol identity, and incremental Responses API parsing.
- `tools/` distinguishes caller-executed VS Code tools from server-executed OpenAI hosted tools.

The following implementations have focused colocated `node:test` coverage in `src/`:

| Area | Implementation | Tests |
| --- | --- | --- |
| Model catalog | [`catalog.ts`](../src/models/catalog.ts) | [`catalog.test.ts`](../src/models/catalog.test.ts) |
| Model options | [`options.ts`](../src/models/options.ts) | [`options.test.ts`](../src/models/options.test.ts) |
| OAuth | [`auth.ts`](../src/auth/auth.ts) | [`auth.test.ts`](../src/auth/auth.test.ts) |
| Prompt cache | [`prompt-cache.ts`](../src/features/prompt-cache.ts) | [`prompt-cache.test.ts`](../src/features/prompt-cache.test.ts) |
| Protocol identity | [`protocol.ts`](../src/transport/protocol.ts) | [`protocol.test.ts`](../src/transport/protocol.test.ts) |
| Responses streaming | [`responses.ts`](../src/transport/responses.ts) | [`responses.test.ts`](../src/transport/responses.test.ts) |
| Usage domain | [`domain.ts`](../src/usage/domain.ts) | [`domain.test.ts`](../src/usage/domain.test.ts) |
| Usage presentation | [`presentation.ts`](../src/usage/presentation.ts) | [`presentation.test.ts`](../src/usage/presentation.test.ts) |

The VS Code integration entry points remain [`extension.ts`](../src/extension.ts)
and [`provider.ts`](../src/provider.ts); their behavior is exercised through the
Extension Development Host because both depend on the VS Code runtime.

The ChatGPT Codex endpoint requires a bearer token plus the ChatGPT account ID extracted from OAuth JWT claims. Requests use `store: false` and send full conversation history. The provider derives a privacy-safe `prompt_cache_key` and matching cache-affinity `session-id` from the model, tools, instructions, and first user message, so both remain stable across normal chat turns, agent tool loops, and retries without storing prompt text locally. Each stateless backend request receives a fresh `thread-id`, preventing independent VS Code conversations with the same cache prefix from sharing a backend thread identity. The ChatGPT backend currently rejects the public Responses API's explicit `prompt_cache_options` and `prompt_cache_breakpoint` fields, so requests rely on the backend's automatic cache policy with the stable routing key.

Shared protocol constants live in [`src/transport/protocol.ts`](../src/transport/protocol.ts). OAuth and inference requests must use the extension originator and user agent defined there; do not identify requests as the official Codex CLI or OpenAI VS Code extension. The OAuth client and ChatGPT backend are undocumented integration surfaces and may change without notice.

## Extension Development Host

1. Open this repository in VS Code.
2. Press F5 and choose **Run Extension**.
3. In the new window, sign in with **Codex Bridge: Sign in** (browser PKCE).
4. Open Copilot Chat and confirm the Codex model group appears.
5. Send a short prompt to confirm text streaming and usage reporting.
6. Use agent mode to verify a model emits and completes a tool call.
7. Inspect diagnostics and logs for accidental sensitive output.

## Release

Add a Changeset for user-visible work:

```bash
npm run changeset
```

Merging to `main` updates or creates a version pull request. After the version
pull request merges, release automation validates the project, publishes the
VSIX to the Marketplace, and creates a GitHub release.

The packaged extension contains compiled runtime files, Marketplace metadata,
the changelog, license, README, and icon. Source, tests, maps, repository
automation, project documentation, and local build artifacts are excluded by
`.vscodeignore`. The checked-in Codex client version is updated manually from
the official Codex releases API via `npm run update-codex-version`.
