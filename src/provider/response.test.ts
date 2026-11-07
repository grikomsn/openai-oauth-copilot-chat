import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { consumeStream, ResponseReporter, type ResponseParts } from "./response";

class Text { constructor(readonly value: unknown) {} }
class Thinking { constructor(readonly value: unknown, readonly id?: string, readonly metadata?: object) {} }
class Tool { constructor(readonly id: string, readonly name: string, readonly input: object) {} }
class Data { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
const parts = { LanguageModelTextPart: Text, LanguageModelThinkingPart: Thinking, LanguageModelToolCallPart: Tool,
  LanguageModelDataPart: Data } as unknown as ResponseParts;
const cancellation = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as vscode.CancellationToken;

test("closes thinking before text and tools, once per segment", () => {
  const output: unknown[] = [];
  const reporter = new ResponseReporter({ report: (part) => output.push(part) }, parts);
  reporter.report({ text: "answer", reasoning: "plan" });
  reporter.report({ reasoningBoundary: true });
  reporter.report({ reasoning: "more" });
  reporter.report({ toolCall: { id: "c", name: "read", arguments: "{}" } });
  reporter.closeThinking();
  assert.deepEqual(output, [new Thinking("plan", "codex-thinking-0"),
    new Thinking("", "codex-thinking-0", { vscode_reasoning_done: true }), new Text("answer"),
    new Thinking("more", "codex-thinking-0"), new Thinking("", "codex-thinking-0", { vscode_reasoning_done: true }), new Tool("c", "read", {})]);
});

test("usage events during thinking wait for the segment close so deltas stay mergeable", () => {
  const output: unknown[] = [];
  const reporter = new ResponseReporter({ report: (part) => output.push(part) }, parts);
  reporter.report({ reasoning: "Son" });
  reporter.report({ usage: { prompt_tokens: 10, completion_tokens: 4 } });
  reporter.report({ reasoning: "ar still flags a" });
  reporter.report({ reasoning: " regex" });
  reporter.report({ text: "answer" });
  reporter.closeThinking();
  // Copilot Chat merges a thinking delta only when the previous part is a
  // non-empty thinking part; interleaved usage data parts would split the
  // reasoning into one bubble per delta.
  assert.deepEqual(output.map((part) => (part as object).constructor.name),
    ["Thinking", "Thinking", "Thinking", "Thinking", "Data", "Text"]);
  assert.deepEqual(output.slice(0, 3).map((part) => (part as Thinking).value), ["Son", "ar still flags a", " regex"]);
  assert.equal((output[3] as Thinking).id, "codex-thinking-1");
  assert.deepEqual((output[3] as Thinking).metadata, { vscode_reasoning_done: true });
  const data = output.filter((part): part is Data => part instanceof Data);
  assert.equal(JSON.parse(new TextDecoder().decode(data[0].data)).completion_tokens, 4);
});

test("flushes the unterminated final event before completion validation and releases the reader", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed"}'));
    controller.close();
  } });
  const output: unknown[] = [];
  await consumeStream(body, { report: (part) => output.push(part) }, cancellation, parts);
  assert.deepEqual(output, [new Text("hello")]);
  assert.equal(body.locked, false);
});

for (const terminal of ["", 'data: {"type":"response.incomplete"}\n\n', 'data: {"type":"response.failed"}\n\n']) {
  test(`closes open thinking and releases resources on ${terminal ? "terminal failure" : "truncated EOF"}`, async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"response.reasoning_text.delta","delta":"plan"}\n\n' + terminal));
      if (!terminal) controller.close();
    }, cancel() { cancelled = true; } });
    const output: unknown[] = [];
    await assert.rejects(consumeStream(body, { report: (part) => output.push(part) }, cancellation, parts), /ended before|incomplete|failed/);
    const last = output.at(-1) as Thinking;
    assert.deepEqual(last.metadata, { vscode_reasoning_done: true });
    assert.match(String(last.id), /^codex-thinking-\d+$/);
    assert.equal(body.locked, false);
    if (terminal) assert.equal(cancelled, true);
  });
}

test("cancellation interrupts a blocked body read", async () => {
  let cancel!: () => void;
  let cancelled = false;
  const token = { isCancellationRequested: false, onCancellationRequested(callback: () => void) {
    cancel = () => { token.isCancellationRequested = true; callback(); };
    return { dispose() {} };
  } } as vscode.CancellationToken;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const consuming = consumeStream(body, { report() {} }, token, parts);
  cancel();
  await consuming;
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
