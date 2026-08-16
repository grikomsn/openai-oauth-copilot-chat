import assert from "node:assert/strict";
import test from "node:test";
import { buildHostedTools } from "./hosted-tools";

test("keeps hosted tools disabled by default", () => {
  assert.deepEqual(buildHostedTools({ webSearch: false, imageGeneration: false }), []);
});

test("builds the Responses web-search descriptor when opted in", () => {
  assert.deepEqual(buildHostedTools({ webSearch: true, imageGeneration: false }), [{ type: "web_search" }]);
});

test("builds the Responses image-generation descriptor when opted in", () => {
  assert.deepEqual(buildHostedTools({ webSearch: false, imageGeneration: true }), [{ type: "image_generation" }]);
});

test("preserves the order of multiple hosted tools", () => {
  assert.deepEqual(buildHostedTools({ webSearch: true, imageGeneration: true }), [
    { type: "web_search" },
    { type: "image_generation" },
  ]);
});
