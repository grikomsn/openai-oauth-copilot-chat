import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeTools } from "./native-tools";

test("keeps hosted web search disabled by default", () => {
  assert.deepEqual(buildNativeTools({ webSearch: false }), []);
});

test("builds the Responses web-search descriptor when opted in", () => {
  assert.deepEqual(buildNativeTools({ webSearch: true }), [{ type: "web_search" }]);
});
