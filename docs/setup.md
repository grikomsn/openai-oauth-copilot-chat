# Setup and troubleshooting

## Install from a VSIX

Run `code --install-extension openai-oauth-copilot-chat-1.0.0.vsix`, then reload VS Code.

## ChatGPT plan connections

Run **Codex Bridge: Add ChatGPT Account**, choose a profile ID, then select **Continue with ChatGPT**. Approve plan usage in the browser and return to VS Code. The browser flow registers a named Codex Bridge connection with a stable host identifier. **Codex Bridge: Continue with ChatGPT (App Limits)** connects the currently selected management profile directly; use a new profile ID to keep an existing connection separate.

Open [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage) to set the app's weekly percentage cap. This cap uses your shared plan allowance and does not reserve additional quota. The extension reports locally observed inference tokens; it does not estimate remaining app quota or call the private Codex quota/reset-credit endpoints with these credentials.

Direct-plan connections discover account-specific models through the public OpenAI API and stream stateless Responses requests with complete supplied history and encrypted reasoning continuity. Function tools use a Copilot namespace. Web Search is optional and subject to account/model policy; Image Generation is unavailable on this route. Fast model slugs, when listed by the account catalog, remain separate model entries; no legacy Fast service-tier override is inferred.

Sign out through **Manage Connection**. Credentials are cleared locally and remote refresh-session revocation is attempted; a warning identifies unconfirmed revocation. The app registration is retained so signing in again with the same profile reuses its issued client ID and limits. Use another profile for a different account or workspace. Rotating refreshes are serialized across extension hosts sharing the local extension storage directory.

Existing stored sessions, manual sign-in, CLI imports, and the **Codex browser (legacy)** browser option retain their previous backend route. No existing profile migrates automatically. Manual sign-in remains a legacy workflow.

`openaiCodex.requestCompression` defaults to `auto`, compressing large ChatGPT request bodies with zstd when the extension-host runtime provides it. Set `none` for plain JSON when diagnosing proxy compatibility. Unsupported runtimes fall back to plain JSON.

Use **Chat: Manage Language Models → Add Models → Codex Bridge** to add an entry: it prompts for a group name and profile ID and creates the entry immediately. The entry lists no models until the profile is signed in, and Codex Bridge then offers to start ChatGPT sign-in right away. Conversely, running any sign-in command (**Add ChatGPT Account**, **Sign In with ChatGPT**, manual sign-in, or CLI session import) provisions the matching entry automatically when none exists yet. VS Code keeps each named entry separate, so multiple ChatGPT accounts can coexist in one window. Leaving the profile field empty selects the `default` profile.

Sessions use the current profile store; older single-account session formats are not loaded. Model IDs include every profile, including `default`, so reselect the chat model after upgrading. **Codex Bridge: Select Profile for Usage and Management** chooses which account the status bar and management commands display; model requests always use the account attached to the selected Language Models entry.

Each model exposes the reasoning efforts advertised by the live Codex catalog. Ordered
effort controls default to Low when the model supports it; otherwise the catalog default
is retained. Models that advertise the `fast` additional speed tier expose Fast choices
in their model configuration. When Context Window is available, each effort is paired
with a Fast choice such as High and High Fast; otherwise a separate **Speed Mode** control
provides Normal and Fast choices. Selecting Fast requests faster processing with increased
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

`openaiCodex.codexVersion` optionally overrides the Codex client version sent while
loading the live model catalog. Leave it empty (the default) to use the version bundled
with the extension. Set it only to test a known Codex release version, for example
`"openaiCodex.codexVersion": "0.149.0"`; changing it clears the catalog cache.

The live Codex directory remains authoritative for availability, limits, capabilities,
and reasoning levels. The extension uses a six-hour, stale-while-revalidate models.dev
snapshot in VS Code `globalState` only to fill metadata omitted by the live directory.

After sign-in, the **Codex** status-bar item shows ChatGPT subscription utilization for the primary and secondary quota windows. Click it to refresh quota, inspect reset times, or view exact input/output tokens from the most recent inference. Those normalized token counts are also reported to Copilot Chat so its context-window percentage reflects real usage.

## Browser callback problems

**Continue with ChatGPT** listens on an available `127.0.0.1` loopback port, so it does not require port 1455. The legacy Codex OAuth flow redirects to `http://localhost:1455/auth/callback`. If that legacy port is busy, use **Codex Bridge: Sign In Manually**, finish authentication, and paste the complete callback URL shown in the browser address bar. Manual callbacks must include both the authorization code and matching OAuth state.

**Codex Bridge: Import Codex CLI Session (Advanced)** copies the CLI's OAuth access and refresh credentials into VS Code Secret Storage. Prefer a fresh ChatGPT sign-in. Import only when you trust the extension and intentionally want both clients to use credentials derived from the same CLI session.

## Models do not appear

- Confirm VS Code is version 1.125 or newer.
- Confirm GitHub Copilot Chat is installed and enabled.
- Confirm the profile ID in the Language Models entry matches a profile created by **Codex Bridge: Add ChatGPT Account**; model discovery uses that profile's authenticated Codex catalog endpoint.
- Run **Codex Bridge: Show Diagnostics** and check that the provider reports registered models.
- Open the model picker, choose **Manage Models**, and enable Codex Bridge models.
- Your organization can disable bring-your-own-model providers through GitHub Copilot policy.

## Requests fail

Run **Codex Bridge: Test Connection**, then inspect **Output → Codex Bridge**. A `401` triggers one automatic token refresh. Structured direct-plan errors distinguish permission, eligibility, unsupported features, and usage limits. A plan usage cap error links you to ChatGPT Usage; it does not imply the whole plan is empty or identify a reset time. Temporary HTTP unavailability receives bounded retries; requests are not replayed after partial output. Terminal refresh errors require reconnecting the same profile.

Account management lists valid sessions directly from VS Code Secret Storage. **Manage Connection → Reconcile accounts and observed entries** compares them with discovery history. That history contains profile aliases, model counts, and timestamps only; it may include entries removed in VS Code and does not enumerate current native entries. Account changes refresh every provider entry.

Streaming retains cancellation and the request deadline until the body finishes. Interrupted streams and `response.incomplete` fail visibly rather than reporting success. Reasoning segments close before text or tool calls, and parallel function arguments stay attached to their item, call, or output index.
