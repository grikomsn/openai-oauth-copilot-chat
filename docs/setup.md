# Setup and troubleshooting

## Install from a VSIX

Run `code --install-extension openai-oauth-copilot-chat-0.1.0.vsix`, then reload VS Code.

Use **OpenAI Codex: Manage Connection** to authenticate. After sign-in, open Copilot Chat's model picker and enable a model under **Manage Models → OpenAI Codex**.

Supported models expose a combined **Speed & Effort** menu with choices such as **Normal · Medium** and **Fast · High**. Normal mode uses standard processing. Fast mode requests roughly 1.5× generation speed with increased account usage. The picker selection applies to that request and overrides the two independent workspace defaults.

After sign-in, the **Codex** status-bar item shows ChatGPT subscription utilization for the primary and secondary quota windows. Click it to refresh quota, inspect reset times, or view exact input/output tokens from the most recent inference. Those normalized token counts are also reported to Copilot Chat so its context-window percentage reflects real usage.

## Browser callback problems

OpenAI's Codex OAuth client redirects to `http://localhost:1455/auth/callback`. The normal flow temporarily listens on that port. If it is busy, use **OpenAI Codex: Sign In Manually**, finish authentication, and paste the callback URL shown in the browser address bar.

## Models do not appear

- Confirm VS Code is version 1.125 or newer.
- Confirm GitHub Copilot Chat is installed and enabled.
- Run **OpenAI Codex: Show Diagnostics** and check that the provider reports registered models.
- Open the model picker, choose **Manage Models**, and enable OpenAI Codex models.
- Your organization can disable bring-your-own-model providers through GitHub Copilot policy.

## Requests fail

Run **OpenAI Codex: Test Connection**, then inspect **Output → OpenAI Codex**. A `401` triggers one automatic token refresh. A `403` generally means the signed-in account cannot access the selected model. A `429` indicates account capacity or rate limits.
