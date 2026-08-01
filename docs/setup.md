# Setup and troubleshooting

## Install from a VSIX

Run `code --install-extension openai-oauth-copilot-chat-0.1.0.vsix`, then reload VS Code.

Use **Codex Bridge: Manage Connection** to authenticate. After sign-in, open Copilot Chat's model picker and enable a model under **Manage Models → Codex Bridge**.

Supported models expose a combined **Speed & Effort** menu with choices such as **Normal · Medium** and **Fast · High**. Normal mode uses standard processing. Fast mode requests roughly 1.5× generation speed with increased account usage. The picker selection applies to that request and overrides the two independent workspace defaults.

Codex Bridge currently exposes GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna,
GPT-5.5, and GPT-5.2. Older Codex model families may be retired or hidden by
the upstream catalog and are not registered by the extension.

After sign-in, the **Codex** status-bar item shows ChatGPT subscription utilization for the primary and secondary quota windows. Click it to refresh quota, inspect reset times, or view exact input/output tokens from the most recent inference. Those normalized token counts are also reported to Copilot Chat so its context-window percentage reflects real usage.

## Browser callback problems

OpenAI's Codex OAuth client redirects to `http://localhost:1455/auth/callback`. The normal flow temporarily listens on that port. If it is busy, use **Codex Bridge: Sign In Manually**, finish authentication, and paste the complete callback URL shown in the browser address bar. Manual callbacks must include both the authorization code and matching OAuth state.

**Codex Bridge: Import Codex CLI Session (Advanced)** copies the CLI's OAuth access and refresh credentials into VS Code Secret Storage. Prefer a fresh ChatGPT sign-in. Import only when you trust the extension and intentionally want both clients to use credentials derived from the same CLI session.

## Models do not appear

- Confirm VS Code is version 1.125 or newer.
- Confirm GitHub Copilot Chat is installed and enabled.
- Run **Codex Bridge: Show Diagnostics** and check that the provider reports registered models.
- Open the model picker, choose **Manage Models**, and enable Codex Bridge models.
- Your organization can disable bring-your-own-model providers through GitHub Copilot policy.

## Requests fail

Run **Codex Bridge: Test Connection**, then inspect **Output → Codex Bridge**. A `401` triggers one automatic token refresh. A `403` generally means the signed-in account cannot access the selected model. A `429` indicates account capacity or rate limits.
