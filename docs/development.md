# Development and releases

## Architecture

The extension has three small layers:

- `oauth.ts` performs PKCE authorization, refresh, local callback handling, and secure-session persistence.
- `provider.ts` translates VS Code language-model messages and tools into stateless OpenAI Responses input items.
- `sse.ts` incrementally parses Responses API events into VS Code text, thinking, usage, and tool-call parts.

The ChatGPT Codex endpoint requires a bearer token plus the ChatGPT account ID extracted from OAuth JWT claims. Requests use `store: false` and send full conversation history. The provider derives a privacy-safe `prompt_cache_key` and matching cache-affinity `session-id` from the model, tools, instructions, and first user message, so both remain stable across normal chat turns, agent tool loops, and retries without storing prompt text locally. Each stateless backend request receives a fresh `thread-id`, preventing independent VS Code conversations with the same cache prefix from sharing a backend thread identity. The ChatGPT backend currently rejects the public Responses API's explicit `prompt_cache_options` and `prompt_cache_breakpoint` fields, so requests rely on the backend's automatic cache policy with the stable routing key.

Shared protocol constants live in `protocol.ts`. OAuth and inference requests must use the extension originator and user agent defined there; do not identify requests as the official Codex CLI or OpenAI VS Code extension. The OAuth client and ChatGPT backend are undocumented integration surfaces and may change without notice.

## Local workflow

```sh
npm run compile
npm test
npm run watch
npm run package
```

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
