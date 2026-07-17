# Contributing

Thanks for helping improve Codex Bridge for Copilot Chat.

## Before opening work

- Use [Discussions](https://github.com/grikomsn/openai-oauth-copilot-chat/discussions/categories/q-a) for setup and usage questions.
- Search existing issues before filing a bug or feature request.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.
- Keep changes focused. Open an issue first when a proposal changes authentication, provider behavior, or public configuration.

## Development

Use Node.js 22 or newer:

```bash
npm install
npm test
npm run package
```

Add or update tests when behavior changes. Do not include generated `out/` files, VSIX artifacts, OAuth credentials, callback URLs, or captured prompts in commits.

User-visible changes need a Changeset:

```bash
npm run changeset
```

Documentation, tests, and repository-maintenance-only changes do not need one.

## Pull requests

A pull request should:

- Explain the problem and the chosen solution
- Stay limited to one coherent change
- Pass tests and packaging
- Update documentation when commands, settings, security behavior, or user workflows change
- Avoid unrelated dependency or formatting churn

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). For contribution questions not suited to Discussions, contact [griko@nibras.co](mailto:griko@nibras.co).
