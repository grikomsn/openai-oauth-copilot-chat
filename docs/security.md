# Security

## Credential storage

- OAuth access and refresh tokens are stored with VS Code Secret Storage.
- Tokens and prompts are never written to the output channel.
- Diagnostics report only whether a session exists and public model metadata; account identity is redacted.
- Codex CLI import reads only `~/.codex/auth.json` after the user explicitly runs the advanced import command and confirms the credential-copy warning.

## Network destinations

- `https://auth.openai.com/oauth/authorize`
- `https://auth.openai.com/oauth/token`
- `https://chatgpt.com/backend-api/codex/responses`
- `https://chatgpt.com/backend-api/wham/usage`
- `https://models.dev/api.json` for public model metadata enrichment only

Requests use the independent originator `openai-oauth-copilot-chat` and a matching user agent. They do not identify as the official Codex CLI or OpenAI VS Code extension.

## Inline completions

When `openaiOAuth.inlineSuggestions` is enabled, each suggestion sends a bounded window of the current document (a fixed number of lines before the cursor and a bounded suffix after it) to ChatGPT's Codex responses endpoint. Upstream error bodies are never surfaced or logged because they can echo prompt context, and suggestion text flows only into the editor's ghost text. The feature is disabled by default.

## Logging

The output channel records only status and metadata. It does not record OAuth tokens, prompts, response text, or account data.

## Reporting vulnerabilities

Do not include tokens, callback URLs, prompts, or account IDs in a public issue. Use GitHub's private security advisory flow for the repository.

This project is independent and is not endorsed by OpenAI, GitHub, or Microsoft. Users are responsible for complying with the terms that apply to their accounts.

The shared OAuth client and ChatGPT Codex backend are undocumented integration surfaces. Compatibility may change or be revoked without notice.
