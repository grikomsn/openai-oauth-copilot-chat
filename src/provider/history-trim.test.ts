import assert from "node:assert/strict";
import test from "node:test";
import { estimateInputItemTokens, trimHistoryToFitContext, type TrimItem } from "./history-trim";

function userMessage(text: string): TrimItem {
  return { type: "message", role: "user", content: [{ type: "input_text", text }] };
}

function assistantMessage(text: string): TrimItem {
  return { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
}

function functionCall(callId: string, args: string): TrimItem {
  return { type: "function_call", call_id: callId, name: "run", arguments: args };
}

function functionOutput(callId: string, output: string): TrimItem {
  return { type: "function_call_output", call_id: callId, output };
}

test("keeps the input untouched when it fits the budget", () => {
  const items = [userMessage("hello"), assistantMessage("hi"), userMessage("more")];
  const result = trimHistoryToFitContext(items, 10_000);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, items);
});

test("drops the oldest turns until the estimated payload fits", () => {
  const items = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimHistoryToFitContext(items, 250);

  assert.equal(result.removedItems, 2);
  assert.deepEqual(result.items, [items[0], items[3]]);
  assert.ok(result.estimatedTokens <= 250);
});

test("keeps function calls and their outputs in one dropped unit", () => {
  const items = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    functionCall("call-1", "{}"),
    functionOutput("call-1", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimHistoryToFitContext(items, 250);

  assert.equal(result.removedItems, 4);
  assert.deepEqual(result.items, [items[0], items[5]]);
});

test("does not split a tool call from its pending output", () => {
  const items = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    functionCall("call-1", "{}"),
    userMessage("please continue"),
    functionOutput("call-1", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimHistoryToFitContext(items, 310);

  // The interleaved user text cannot become a drop boundary while the call is
  // unanswered, so the unit keeps the call, text, and output together.
  assert.equal(result.removedItems, 4);
  assert.deepEqual(result.items, [items[0], items[5], items[6]]);
});

test("keeps the anchor and current turn when nothing else fits", () => {
  const items = [
    userMessage("anchor"),
    userMessage("x".repeat(4000)),
    assistantMessage("filler"),
    userMessage("current"),
  ];
  const result = trimHistoryToFitContext(items, 10);

  assert.equal(result.removedItems, 2);
  assert.deepEqual(result.items, [items[0], items[3]]);
});

test("never trims single-turn or empty history", () => {
  assert.equal(trimHistoryToFitContext([], 100).removedItems, 0);
  const single = [userMessage("only turn ".repeat(100))];
  assert.equal(trimHistoryToFitContext(single, 1).removedItems, 0);
});

test("ignores budgets that are zero or negative", () => {
  const items = [userMessage("a"), userMessage("b"), userMessage("c")];
  const result = trimHistoryToFitContext(items, 0);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, items);
});

test("estimates images, reasoning, and tool items with fixed weights", () => {
  assert.equal(estimateInputItemTokens({ type: "reasoning", encrypted_content: "x".repeat(8000) }), 128);
  assert.equal(
    estimateInputItemTokens({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "x".repeat(40) }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }],
    }),
    10 + 1024,
  );
  assert.equal(estimateInputItemTokens(functionCall("call-1", "{}")), Math.ceil("run{}".length / 4));
  assert.equal(estimateInputItemTokens(functionOutput("call-1", "ok")), 1);
  assert.equal(
    estimateInputItemTokens({ type: "unknown", payload: "12345678" }),
    Math.ceil(JSON.stringify({ type: "unknown", payload: "12345678" }).length / 4),
  );
});
