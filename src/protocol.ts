export const EXTENSION_DISPLAY_NAME = "Codex Bridge for Copilot Chat";
export const EXTENSION_PRODUCT_ID = "openai-oauth-copilot-chat";
export const OAUTH_ORIGINATOR = EXTENSION_PRODUCT_ID;

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CODEX_MODELS_CLIENT_VERSION = "99.99.99";
export const CHATGPT_CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_MODELS_CLIENT_VERSION}`;
export const CHATGPT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CHATGPT_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export function extensionUserAgent(version: string, vscodeVersion: string): string {
  return `${EXTENSION_PRODUCT_ID}/${version} VSCode/${vscodeVersion}`;
}
