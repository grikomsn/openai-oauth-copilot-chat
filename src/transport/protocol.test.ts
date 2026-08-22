import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_MODELS_CLIENT_VERSION,
  codexModelsClientVersion,
  chatgptCodexModelsUrl,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_PRODUCT_ID,
  OAUTH_ORIGINATOR,
  extensionUserAgent,
} from "./protocol";

test("uses a consistent independent extension identity", () => {
  assert.equal(EXTENSION_DISPLAY_NAME, "Codex Bridge for Copilot Chat");
  assert.equal(OAUTH_ORIGINATOR, EXTENSION_PRODUCT_ID);
  assert.equal(extensionUserAgent("1.2.3", "1.125.0"), "openai-oauth-copilot-chat/1.2.3 VSCode/1.125.0");
  assert.doesNotMatch(extensionUserAgent("1.2.3", "1.125.0"), /codex_(?:cli|vscode)/);
});

test("uses the checked-in Codex release version for backend requests", () => {
  assert.match(CODEX_MODELS_CLIENT_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(chatgptCodexModelsUrl(CODEX_MODELS_CLIENT_VERSION), `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_MODELS_CLIENT_VERSION}`);
});

test("uses a valid configured Codex version and otherwise falls back to the checked-in version", () => {
  assert.equal(codexModelsClientVersion("0.150.0"), "0.150.0");
  assert.equal(codexModelsClientVersion(" 0.150.0-beta.1 "), "0.150.0-beta.1");
  assert.equal(codexModelsClientVersion("latest"), CODEX_MODELS_CLIENT_VERSION);
  assert.equal(codexModelsClientVersion(undefined), CODEX_MODELS_CLIENT_VERSION);
});
