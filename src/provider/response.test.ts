import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { consumeStream, ResponseReporter, type ResponseParts } from "./response";

class Text { constructor(readonly value: unknown) {} }
class Thinking { constructor(readonly value: unknown, readonly id?: string, readonly metadata?: object) {} }
class Tool { constructor(readonly id: string, readonly name: string, readonly input: object) {} }
const parts = { LanguageModelTextPart: Text, LanguageModelThinkingPart: Thinking, LanguageModelToolCallPart: Tool } as unknown as ResponseParts;
const cancellation = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as vscode.CancellationToken;

test("closes thinking before text and tools, once per segment", () => {
  const output: unknown[] = [];
  const reporter = new ResponseReporter({ report: (part) => output.push(part) }, parts);
  reporter.report({ text: "answer", reasoning: "plan" });
  reporter.report({ reasoningBoundary: true });
  reporter.report({ reasoning: "more" });
  reporter.report({ toolCall: { id: "c", name: "read", arguments: "{}" } });
  reporter.closeThinking();
  assert.deepEqual(output, [new Thinking("plan"), new Thinking("", "", { vscode_reasoning_done: true }), new Text("answer"),
    new Thinking("more"), new Thinking("", "", { vscode_reasoning_done: true }), new Tool("c", "read", {})]);
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
    assert.deepEqual(output.at(-1), new Thinking("", "", { vscode_reasoning_done: true }));
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
