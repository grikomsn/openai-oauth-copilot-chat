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

This extension is a native VS Code `LanguageModelChatProvider`. It handles OpenAI OAuth locally, streams ChatGPT Codex responses into Copilot Chat, and keeps tokens in VS Code Secret Storage.

## Features

- ChatGPT OAuth with PKCE and automatic access-token refresh
- Current GPT and Codex model families in Copilot Chat's model picker
- Streaming responses, reasoning summaries, images, and tool calling
- Normal/Fast speed and model-specific reasoning effort in one reliable model-picker control
- Native Copilot context-window accounting from Codex inference token usage
- Status-bar indicator for five-hour/weekly ChatGPT Codex quota and locally tracked tokens
- Browser callback, manual callback, and optional Codex CLI session import
- Connection test and privacy-safe diagnostics commands

The current model picker exposes GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna,
GPT-5.5, and GPT-5.2. Model-specific reasoning efforts and Fast mode options
follow the current Codex catalog; all five models accept image input.

## Requirements

- VS Code 1.125 or newer
- GitHub Copilot Chat installed and enabled
- A ChatGPT account with Codex access (typically Plus or Pro)

## Quick start

1. Install [Codex Bridge for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=grikomsn.openai-oauth-copilot-chat). You need VS Code 1.125 or newer, GitHub Copilot Chat, and a ChatGPT account with Codex access.
2. Run **Codex Bridge: Manage Connection** from the Command Palette.
3. Choose **Sign in with ChatGPT** and complete the browser flow.
4. In Copilot Chat, open the model picker, choose **Manage Models**, enable **Codex Bridge**, and select a Codex model.

Models contributed by this extension include an **(OAuth)** suffix so they remain distinguishable from models contributed by other installed OpenAI extensions.

If another process uses local port `1455`, choose **Sign in manually**. If the Codex CLI is already signed in, **Import Codex CLI Session** can copy its OAuth session from `~/.codex/auth.json` into VS Code Secret Storage.

## Commands

| Command                                                   | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| Codex Bridge: Manage Connection                           | Sign in, test, inspect logs, or sign out                     |
| Codex Bridge: Sign In with ChatGPT                        | Start the local browser OAuth flow                           |
| Codex Bridge: Sign In Manually                            | Paste a callback URL when port 1455 is unavailable           |
| Codex Bridge: Import Codex CLI Session (Advanced)         | Copy an existing local Codex CLI login after a warning       |
| Codex Bridge: Test Connection                             | Send a small live request to the Codex backend               |
| Codex Bridge: Show Usage                                  | Refresh and inspect subscription quota plus inference tokens |
| Codex Bridge: Show Diagnostics                            | Show session presence and registered models without secrets  |

## Settings

- `openaiCodex.speedMode`: independent workspace default, `normal` or `fast` (Fast uses more account capacity and is shown only for supported models)
- `openaiCodex.reasoningEffort`: independent workspace default; supported values range from `low` through `ultra` by model

Copilot Chat exposes one compact per-model menu, so request overrides appear as combinations such as **Normal · Medium** and **Fast · High**.

- `openaiCodex.requestTimeoutSeconds`: total request timeout
- `openaiCodex.debugLogging`: request metadata only; prompts and tokens are never logged
- `openaiCodex.showUsageStatusBar`: show or hide the Codex quota/token indicator

The status bar reads the same ChatGPT Codex quota endpoint used by Codex CLI and shows the primary and secondary utilization windows. Click it for reset times, the last inference token count, and cumulative tokens tracked by this extension on the current device.

## Documentation

- [Setup, settings, and troubleshooting](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/setup.md)
- [OAuth and security](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/security.md)
- [Development and releases](https://github.com/grikomsn/openai-oauth-copilot-chat/blob/main/docs/development.md)

## Related projects

- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat) — Use xAI Grok models directly from the GitHub Copilot Chat model picker in Visual Studio Code.
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat) — Use hosted Poolside coding models directly from the GitHub Copilot Chat model picker in Visual Studio Code.

## Privacy and status

OAuth tokens are stored through VS Code Secret Storage and are sent only to OpenAI authentication and ChatGPT Codex endpoints. This is an independent community extension, not an official OpenAI or GitHub product. The ChatGPT Codex backend is not a public compatibility API and can change; see [docs/security.md](docs/security.md).

Requests identify this extension as `openai-oauth-copilot-chat`; they do not claim to originate from the official Codex CLI or VS Code extension. The shared OAuth client and ChatGPT backend are undocumented integration surfaces, so OpenAI may change or revoke compatibility without notice.

Unofficial project; not affiliated with OpenAI, GitHub, or Microsoft. The ChatGPT Codex backend is not a public compatibility API and can change. Licensed under [MIT](LICENSE).
