/** Stable protocol identity and endpoint constants for this extension. */

export const EXTENSION_DISPLAY_NAME = "Codex Bridge for Copilot Chat";
export const EXTENSION_PRODUCT_ID = "openai-oauth-copilot-chat";
export const OAUTH_ORIGINATOR = EXTENSION_PRODUCT_ID;

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";

/**
 * Codex client version sent to the live model directory.
 * Update this checked-in value manually with `npm run update-codex-version`.
 *
 * @example
 * ```ts
 * chatgptCodexModelsUrl(CODEX_MODELS_CLIENT_VERSION);
 * ```
 *
 * @see {@link chatgptCodexModelsUrl}
 */
export const CODEX_MODELS_CLIENT_VERSION = "0.146.0";
export const CHATGPT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CHATGPT_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CHATGPT_CODEX_RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
export const CHATGPT_CODEX_RESET_CREDIT_CONSUME_URL = `${CHATGPT_CODEX_RESET_CREDITS_URL}/consume`;

/**
 * Builds the live Codex model-directory URL for a client version.
 *
 * @example
 * ```ts
 * chatgptCodexModelsUrl("0.146.0");
 * // "https://chatgpt.com/backend-api/codex/models?client_version=0.146.0"
 * ```
 *
 * @see {@link CODEX_MODELS_CLIENT_VERSION}
 */
export function chatgptCodexModelsUrl(clientVersion: string): string {
  return `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`;
}

/**
 * Creates the extension identity used in authenticated requests.
 *
 * @example
 * ```ts
 * extensionUserAgent("0.4.1", "1.95.0");
 * // "openai-oauth-copilot-chat/0.4.1 VSCode/1.95.0"
 * ```
 *
 * @see {@link OAUTH_ORIGINATOR}
 */
export function extensionUserAgent(version: string, vscodeVersion: string): string {
  return `${EXTENSION_PRODUCT_ID}/${version} VSCode/${vscodeVersion}`;
}
