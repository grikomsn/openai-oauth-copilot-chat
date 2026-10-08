import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesStreamParser } from "./responses";

test("parses fragmented Codex text and reasoning SSE", () => {
  const parser = new ResponsesStreamParser();
  assert.deepEqual(parser.push('data: {"type":"response.output_text.'), []);
  assert.deepEqual(parser.push('delta","delta":"hello"}\n\ndata: {"type":"response.reasoning_summary_text.delta","delta":"think"}\n\n'), [
    { text: "hello" }, { reasoning: "think" },
  ]);
});

test("preserves boundaries between reasoning summary parts", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push([
    'data: {"type":"response.reasoning_summary_part.added","item_id":"r1","summary_index":0,"part":{"type":"summary_text","text":""}}',
    'data: {"type":"response.reasoning_summary_text.delta","item_id":"r1","summary_index":0,"delta":"Planning commit and review workflow"}',
    'data: {"type":"response.reasoning_summary_part.done","item_id":"r1","summary_index":0,"part":{"type":"summary_text","text":"Planning commit and review workflow"}}',
    'data: {"type":"response.reasoning_summary_part.added","item_id":"r1","summary_index":1,"part":{"type":"summary_text","text":""}}',
    'data: {"type":"response.reasoning_summary_text.delta","item_id":"r1","summary_index":1,"delta":"Preparing staged commits for fixes"}',
    'data: {"type":"response.reasoning_summary_part.done","item_id":"r1","summary_index":1,"part":{"type":"summary_text","text":"Preparing staged commits for fixes"}}',
  ].join("\n\n") + "\n\n");

  assert.deepEqual(events, [
    { reasoning: "Planning commit and review workflow" },
    { reasoningBoundary: true },
    { reasoning: "Preparing staged commits for fixes" },
    { reasoningBoundary: true },
  ]);
});

test("emits completed function calls", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"read_file","arguments":"{\\"path\\":\\"a\\"}"}}\n\n');
  assert.deepEqual(events, [{ toolCall: { id: "c1", name: "read_file", arguments: '{"path":"a"}' } }]);
});

test("preserves hosted web-search calls and citations as data events", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push([
    'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws1","status":"completed","action":{"type":"search","queries":["latest OpenAI news"]}}}',
    'data: {"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://example.com","title":"Example"}}',
  ].join("\n\n") + "\n\n");

  assert.deepEqual(events, [
    { webSearchCall: { id: "ws1", status: "completed", action: { type: "search", queries: ["latest OpenAI news"] } } },
    { webSearchAnnotation: { type: "url_citation", url: "https://example.com", title: "Example" } },
  ]);
});

test("parses the final image-generation output and suppresses completed duplicates", () => {
  const parser = new ResponsesStreamParser();
  const result = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const events = parser.push([
    `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", id: "img1", status: "completed", result } })}`,
    `data: ${JSON.stringify({ type: "response.completed", response: { output: [{ type: "image_generation_call", id: "img1", status: "completed", result }], usage: { total_tokens: 12 } } })}`,
  ].join("\n\n") + "\n\n");

  assert.deepEqual(events, [
    { imageGenerationCall: { id: "img1", status: "completed", result } },
    { usage: { total_tokens: 12 } },
  ]);
});

test("preserves failed image-generation calls for provider error handling", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","id":"img1","status":"failed"}}\n\n');
  assert.deepEqual(events, [{ imageGenerationCall: { id: "img1", status: "failed" } }]);
});

test("preserves encrypted reasoning for stateless follow-up requests", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"r1","encrypted_content":"ciphertext"}}\n\n');
  assert.deepEqual(events, [{ encryptedReasoning: { id: "r1", data: "ciphertext" } }]);
});

test("extracts Responses API inference usage from the completed event", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150}}}\n\n');
  assert.deepEqual(events, [{ usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } }]);
});

test("recovers completed response text when no text delta was delivered", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"recovered"}]}]}}\n\n');
  assert.deepEqual(events, [{ text: "recovered" }]);
});

test("does not repeat completed response text after streaming deltas", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push([
    'data: {"type":"response.output_text.delta","delta":"answer"}',
    'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"answer"}]}]}}',
  ].join("\n\n") + "\n\n");
  assert.deepEqual(events, [{ text: "answer" }]);
});

test("joins CRLF split at every transport character boundary", () => {
  const parser = new ResponsesStreamParser();
  const wire = 'data: {"type":"response.output_text.delta","delta":"hello"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n';
  const events = [...wire].flatMap((character) => parser.push(character));
  assert.deepEqual(events, [{ text: "hello" }]);
  parser.validateCompletion();
});

test("keeps parallel argument fragments and changing aliases attached to their own calls", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push([
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"path":' },
    { type: "response.function_call_arguments.delta", output_index: 1, delta: '{"path":' },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-a", call_id: "call-a", name: "read" } },
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "item-b", call_id: "call-b", name: "read" } },
    { type: "response.function_call_arguments.delta", item_id: "item-b", delta: '"b"}' },
    { type: "response.function_call_arguments.delta", call_id: "call-a", delta: '"a"}' },
    { type: "response.output_item.done", output_index: 1, item: { type: "function_call", id: "item-b", call_id: "call-b", name: "read" } },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "item-a", call_id: "call-a", name: "read" } },
    { type: "response.function_call_arguments.done", item_id: "item-a", arguments: '{"path":"a"}' },
    { type: "response.output_item.done", item: { type: "function_call", call_id: "call-a", name: "read" } },
    { type: "response.completed", response: { output: [
      { type: "function_call", id: "item-a", call_id: "call-a", name: "read" },
      { type: "function_call", id: "item-b", call_id: "call-b", name: "read" },
    ] } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  assert.deepEqual(events, [
    { toolCall: { id: "call-b", name: "read", arguments: '{"path":"b"}' } },
    { toolCall: { id: "call-a", name: "read", arguments: '{"path":"a"}' } },
  ]);
});

test("recovers completed tools and encrypted reasoning once and rejects incomplete EOF", () => {
  const parser = new ResponsesStreamParser();
  assert.throws(() => parser.validateCompletion(), /ended before/);
  const output = [
    { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
    { type: "reasoning", id: "r1", encrypted_content: "opaque" },
  ];
  const events = parser.push(`data: ${JSON.stringify({ type: "response.completed", response: { output } })}\n\n`);
  assert.equal(events.length, 2);
  parser.validateCompletion();
  assert.deepEqual(parser.push(`data: ${JSON.stringify({ type: "response.completed", response: { output } })}\n\n`), []);
  assert.deepEqual(new ResponsesStreamParser().push('data: {"type":"response.incomplete"}\n\n'), [{ error: "Codex response is incomplete" }]);
});

test("allocates distinct missing call IDs within and across requests", () => {
  const wire = 'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"read","arguments":"{}"}}\n\n';
  const ids = [new ResponsesStreamParser().push(wire + wire), new ResponsesStreamParser().push(wire)]
    .flat().map((event) => event.toolCall!.id);
  assert.equal(new Set(ids).size, 3);
});


test("merges separately observed index and item aliases in fragment order", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push([
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"value":' },
    { type: "response.function_call_arguments.delta", item_id: "item", delta: '"complete"}' },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "item", call_id: "call", name: "probe" } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  assert.deepEqual(events, [{ toolCall: { id: "call", name: "probe", arguments: '{"value":"complete"}' } }]);
});

test("does not emit invalid partial arguments when item completion precedes the final arguments", () => {
  const parser = new ResponsesStreamParser();
  const wire = (event: object): string => `data: ${JSON.stringify(event)}\n\n`;
  assert.deepEqual(parser.push(wire({ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"value":' })
    + wire({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "call", name: "probe" } })), []);
  assert.deepEqual(parser.push(wire({ type: "response.function_call_arguments.done", output_index: 0, arguments: '{"value":1}' })), [
    { toolCall: { id: "call", name: "probe", arguments: '{"value":1}' } },
  ]);
  parser.push(wire({ type: "response.completed" }));
  parser.validateCompletion();
});

test("rejects unfinished tool calls even when a completed terminal event arrives", () => {
  const parser = new ResponsesStreamParser();
  parser.push('data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{"}\n\n');
  parser.push('data: {"type":"response.completed"}\n\n');
  assert.throws(() => parser.validateCompletion(), /unfinished function call/);
});

test("waits for missing arguments rather than fabricating an empty object", () => {
  const parser = new ResponsesStreamParser();
  assert.deepEqual(parser.push('data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call","name":"probe"}}\n\n'), []);
  assert.deepEqual(parser.push('data: {"type":"response.completed","response":{"output":[{"type":"function_call","call_id":"call","name":"probe","arguments":"{}"}]}}\n\n'), [
    { toolCall: { id: "call", name: "probe", arguments: "{}" } },
  ]);
  parser.validateCompletion();
});
