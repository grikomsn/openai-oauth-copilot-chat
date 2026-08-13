import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesStreamParser } from "./sse";

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
