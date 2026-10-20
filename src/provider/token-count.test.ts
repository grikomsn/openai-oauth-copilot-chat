import assert from "node:assert/strict";
import test from "node:test";
import { estimateChatTokens } from "./token-count";

test("counts long tool results instead of treating their wrapper as empty", () => {
  const text = "x".repeat(40_000);
  assert.ok(estimateChatTokens({ content: [{ callId: "call-1", content: [{ value: text }] }] }) >= 10_000);
});

test("counts tool names, arguments, and thinking segments", () => {
  const call = { callId: "call-1", name: "lookup", input: { query: "x".repeat(100) } };
  assert.ok(estimateChatTokens({ content: [call] }) > 25);
  assert.ok(estimateChatTokens({ content: [{ value: ["x".repeat(100), "y".repeat(100)] }] }) >= 50);
});

test("counts direct and tool-result images without counting their encoded bytes", () => {
  const small = { mimeType: "image/png", data: new Uint8Array(10) };
  const large = { mimeType: "image/png", data: new Uint8Array(1_000_000) };
  assert.equal(estimateChatTokens({ content: [small] }), estimateChatTokens({ content: [large] }));
  assert.ok(estimateChatTokens({ content: [large] }) >= 1024);
  assert.ok(estimateChatTokens({ content: [{ callId: "call-1", content: [large, large] }] }) >= 2048);
});

test("counts nested text data and ignores unsupported binary data", () => {
  const text = { mimeType: "text/plain", data: new TextEncoder().encode("x".repeat(400)) };
  assert.ok(estimateChatTokens({ content: [{ content: [text] }] }) >= 100);
  assert.equal(estimateChatTokens({ content: [{ mimeType: "application/octet-stream", data: new Uint8Array(1000) }] }), 8);
});

test("handles strings, empty messages, and unfamiliar parts", () => {
  assert.equal(estimateChatTokens("123456789"), 3);
  assert.equal(estimateChatTokens(""), 0);
  assert.equal(estimateChatTokens({ content: [null, undefined, {}, { value: [null] }] }), 8);
});
