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

test("emits completed function calls", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"read_file","arguments":"{\\"path\\":\\"a\\"}"}}\n\n');
  assert.deepEqual(events, [{ toolCall: { id: "c1", name: "read_file", arguments: '{"path":"a"}' } }]);
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
