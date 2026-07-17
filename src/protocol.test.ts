import assert from "node:assert/strict";
import test from "node:test";
import {
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
