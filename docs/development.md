# Development and releases

## Architecture

The extension has three small layers:

- `oauth.ts` performs PKCE authorization, refresh, local callback handling, and secure-session persistence.
- `provider.ts` translates VS Code language-model messages and tools into stateless OpenAI Responses input items.
- `sse.ts` incrementally parses Responses API events into VS Code text, thinking, usage, and tool-call parts.

The ChatGPT Codex endpoint requires a bearer token plus the ChatGPT account ID extracted from OAuth JWT claims. Requests use `store: false` and send full conversation history.

## Local workflow

```sh
npm run compile
npm test
npm run watch
npm run package
```

For local debugging, open this folder in VS Code and press F5 to launch an Extension Development Host. Authentication and live connection testing must be performed in that host.

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
