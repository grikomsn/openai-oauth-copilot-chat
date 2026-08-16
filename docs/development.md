# Development and releases

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

## Local workflow

```sh
npm run compile
npm test
npm run watch
npm run package
```

The checked-in Codex client version is updated manually from the official Codex
releases API. When a new release is needed, run `npm run update-codex-version`,
review the source diff, and then run the normal checks. Compilation and watch mode
do not contact GitHub.

For local debugging, open this folder in VS Code and run **Run Codex Bridge Extension** from the Run and Debug view (or press F5) to launch an Extension Development Host. Authentication and live connection testing must be performed in that host.

Install a local build with:

```bash
code --install-extension openai-oauth-copilot-chat-<version>.vsix --force
```

## Release workflow

User-visible pull requests normally include a Changeset:

```bash
npm run changeset
```

Changesets maintains a version pull request on `main`. Merging that pull request publishes the VSIX to the Visual Studio Marketplace and attaches the same artifact to a GitHub release. The release workflow skips an existing version tag, preventing duplicate publication.

The packaged extension contains compiled runtime files, Marketplace metadata, the changelog, license, README, and icon. Source, tests, maps, repository automation, project documentation, and local build artifacts are excluded by `.vscodeignore`.
