# Security

## Credential handling

- OAuth access and refresh tokens are stored with VS Code Secret Storage.
- Tokens and prompts are never written to the output channel.
- Diagnostics report only whether a session exists, the account email when present, and public model metadata.
- Codex CLI import reads only `~/.codex/auth.json` after the user explicitly runs the import command.

## Network destinations

- `https://auth.openai.com/oauth/authorize`
- `https://auth.openai.com/oauth/token`
- `https://chatgpt.com/backend-api/codex/responses`

## Reporting vulnerabilities

Do not include tokens, callback URLs, prompts, or account IDs in a public issue. Use GitHub's private security advisory flow for the repository.

This project is independent and is not endorsed by OpenAI, GitHub, or Microsoft. Users are responsible for complying with the terms that apply to their accounts.
