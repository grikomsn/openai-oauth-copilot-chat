<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/openai-oauth-copilot-chat/main/assets/cover.jpg" alt="OpenAI Codex and GitHub Copilot" width="960">
</p>

<h1 align="center">Codex Bridge for Copilot Chat</h1>

<p align="center">Use OpenAI Codex models directly from the GitHub Copilot Chat model picker in Visual Studio Code with your ChatGPT Plus or Pro subscription.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.openai-oauth-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.openai-oauth-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.openai-oauth-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/i/grikomsn.openai-oauth-copilot-chat?style=flat-square&label=Installs" alt="Visual Studio Marketplace installs"></a>
  <a href="https://github.com/grikomsn/openai-oauth-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/openai-oauth-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/openai-oauth-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This native VS Code `LanguageModelChatProvider` handles OpenAI OAuth locally and streams ChatGPT Codex responses into Copilot Chat without a local proxy.

## Highlights

- ChatGPT OAuth with PKCE, automatic refresh, and VS Code Secret Storage
- Multiple named Codex Bridge entries for separate ChatGPT accounts
- Live Codex model discovery with six-hour persisted models.dev enrichment
- Streaming text, reasoning summaries, images, and agent-mode tool calls
- Per-model reasoning effort, summary, Speed Mode, Web Search, and Image Generation controls
- Codex-aware context accounting and prompt-cache reuse
- Status-bar quota and local inference-token tracking
- Browser, manual-callback, and optional Codex CLI session sign-in paths
- Connection testing and secret-safe diagnostics

## Quick start

1. Install [Codex Bridge for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.openai-oauth-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and a ChatGPT account with Codex access.
2. Run **Codex Bridge: Add ChatGPT Account**, choose a short profile ID such as `personal`, and complete sign-in. Use manual sign-in if local port `1455` is unavailable.
3. Open **Chat: Manage Language Models**, select **Add Models → Codex Bridge**, name the entry, and enter the same profile ID.
4. Repeat those steps with another profile ID to keep work and personal ChatGPT accounts available side by side.

The authenticated Codex catalog remains authoritative. Composer controls override workspace defaults; reasoning defaults to High when supported, while hosted Web Search and Image Generation remain off until enabled. Click the Codex status-bar item to inspect five-hour and weekly quota, reset timing, and tokens observed by this extension.

## Documentation

- [Setup, commands, settings, and troubleshooting](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/setup.md)
- [OAuth and security](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat)
- [Ollama Cloud for GitHub Copilot Chat](https://github.com/grikomsn/ollama-cloud-copilot-chat)
- [OpenCode for Copilot Chat](https://github.com/grikomsn/opencode-copilot-chat)
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat)

Unofficial project; not affiliated with OpenAI, GitHub, or Microsoft. The ChatGPT Codex backend is not a public compatibility API and can change. Licensed under [MIT](LICENSE).
