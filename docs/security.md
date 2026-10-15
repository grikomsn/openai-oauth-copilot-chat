# Security

## Credential handling

- OAuth access and refresh tokens are stored with VS Code Secret Storage.
- Direct-plan ID tokens, validated identity, and issued client registrations also use Secret Storage. A random machine-local host identifier is stored in extension state; it is not a hardware fingerprint.
- Direct sign-in verifies the ID-token signature, issuer, audience, expiry, nonce, and subject before replacing credentials. Returning sign-in must match the profile's issued client and subject.
- Signing out clears tokens and attempts remote renewable-session revocation while retaining the registration mapping for later sign-in.
- Tokens and prompts are never written to the output channel.
- Diagnostics report only whether a session exists and public model metadata; account identity is redacted.
- Codex CLI import reads only `~/.codex/auth.json` after the user explicitly runs the advanced import command and confirms the credential-copy warning.

## Network destinations

- `https://auth.openai.com/oauth/authorize`
- `https://auth.openai.com/oauth/token`
- `https://auth.openai.com/api/accounts/authorize`
- `https://auth.openai.com/api/accounts/oauth/token`
- `https://auth.openai.com/.well-known/jwks.json`
- `https://auth.openai.com/.well-known/openid-configuration` and its same-origin revocation endpoint
- `https://api.openai.com/v1/models`
- `https://api.openai.com/v1/responses`
- `https://chatgpt.com/backend-api/codex/responses`
- `https://chatgpt.com/backend-api/wham/usage`
- `https://models.dev/api.json` for public model metadata enrichment only

Requests use the independent originator `openai-oauth-copilot-chat` and a matching user agent. They do not identify as the official Codex CLI or OpenAI VS Code extension.

## Reporting vulnerabilities

Do not include tokens, callback URLs, prompts, or account IDs in a public issue. Use GitHub's private security advisory flow for the repository.

This project is independent and is not endorsed by OpenAI, GitHub, or Microsoft. Users are responsible for complying with the terms that apply to their accounts.

The legacy shared OAuth client and ChatGPT Codex backend are undocumented integration surfaces. Direct-plan connections follow the preview [Sign in with ChatGPT documentation](https://developers.openai.com/siwc/token-sharing-open-source). Compatibility, eligibility, and supported capabilities may change.
