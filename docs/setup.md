# Setup and troubleshooting

## Install from a VSIX

Run `code --install-extension openai-oauth-copilot-chat-0.1.0.vsix`, then reload VS Code.

Use **Codex Bridge: Add ChatGPT Account** to authenticate and assign the account a profile ID. After sign-in, run **Chat: Manage Language Models**, choose **Add Models → Codex Bridge**, and enter the same profile ID. VS Code keeps each named entry separate, so multiple ChatGPT accounts can coexist in one window. Leaving the profile field empty preserves the legacy `default` account.

The `default` profile preserves an existing single-account session, but after upgrading you must add a Codex Bridge entry in **Chat: Manage Language Models** and use `default` as its profile ID. **Codex Bridge: Select Active Profile** chooses which account the status bar and management commands display; model requests always use the account attached to the selected Language Models entry.

Each model exposes the reasoning efforts advertised by the live Codex catalog. Ordered
effort controls default to High when the model supports it; otherwise the catalog default
is retained. Models
that advertise the `fast` additional speed tier expose a native **Speed Mode** control
with Normal and Fast choices. Selecting Fast requests faster processing with increased
account usage without adding a separate Fast model entry. The selected **profile for usage and management** is restored after restart; it never changes the account attached to a model entry.

The `openaiCodex.reasoningSummary` setting controls the Responses API
`reasoning.summary` value. `auto`, `concise`, and `detailed` request the corresponding
summary detail; `none` omits the request field, and `model` follows the live catalog
default. Models that do not accept this parameter omit it automatically.

The legacy `openaiCodex.speedMode` and `openaiCodex.reasoningEffort` settings remain
supported as workspace fallbacks for existing configurations. Prefer the live model
picker for new selections.

Codex Bridge requests the available models after sign-in instead of bundling a static
list. It registers picker-visible models in upstream priority order and maps their
prettified display names, descriptions, context windows, capabilities, reasoning
efforts, and Fast availability from the catalog response. Upstream hidden models are
not registered.

`openaiCodex.catalogCacheMinutes` controls how long the last successful catalog is
reused before the next discovery request. If a refresh fails, the last usable catalog
remains available.

The live Codex directory remains authoritative for availability, limits, capabilities,
and reasoning levels. The extension uses a six-hour, stale-while-revalidate models.dev
snapshot in VS Code `globalState` only to fill metadata omitted by the live directory.

After sign-in, the **Codex** status-bar item shows ChatGPT subscription utilization for the primary and secondary quota windows. Click it to refresh quota, inspect reset times, or view exact input/output tokens from the most recent inference. Those normalized token counts are also reported to Copilot Chat so its context-window percentage reflects real usage.

## Browser callback problems

OpenAI's Codex OAuth client redirects to `http://localhost:1455/auth/callback`. The normal flow temporarily listens on that port. If it is busy, use **Codex Bridge: Sign In Manually**, finish authentication, and paste the complete callback URL shown in the browser address bar. Manual callbacks must include both the authorization code and matching OAuth state.

**Codex Bridge: Import Codex CLI Session (Advanced)** copies the CLI's OAuth access and refresh credentials into VS Code Secret Storage. Prefer a fresh ChatGPT sign-in. Import only when you trust the extension and intentionally want both clients to use credentials derived from the same CLI session.

## Models do not appear

- Confirm VS Code is version 1.125 or newer.
- Confirm GitHub Copilot Chat is installed and enabled.
- Confirm the profile ID in the Language Models entry matches a profile created by **Codex Bridge: Add ChatGPT Account**; model discovery uses that profile's authenticated Codex catalog endpoint.
- Run **Codex Bridge: Show Diagnostics** and check that the provider reports registered models.
- Open the model picker, choose **Manage Models**, and enable Codex Bridge models.
- Your organization can disable bring-your-own-model providers through GitHub Copilot policy.

## Requests fail

Run **Codex Bridge: Test Connection**, then inspect **Output → Codex Bridge**. A `401` triggers one automatic token refresh. A `403` generally means the signed-in account cannot access the selected model. A `429` indicates account capacity or rate limits.
