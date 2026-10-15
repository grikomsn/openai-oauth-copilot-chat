import assert from "node:assert/strict";
import test from "node:test";
import { adaptDirectRequest, DIRECT_TOOL_NAMESPACE } from "./direct-request";

test("wraps Copilot tools and replays tool history with stable namespace and call IDs", () => {
  const call = { type: "function_call", call_id: "call1", name: "read_file", arguments: "{}" };
  const output = { type: "function_call_output", call_id: "call1", output: "synthetic" };
  const reasoning = { type: "reasoning", encrypted_content: "synthetic", summary: [] };
  const tool = { type: "function", name: "read_file", parameters: { type: "object" }, strict: false };
  const request = adaptDirectRequest({ model: "test", input: [reasoning, call, output], tools: [tool, { type: "web_search" }, { type: "image_generation" }],
    store: true, stream: false, previous_response_id: "not-allowed", max_output_tokens: 100, service_tier: "priority", prompt_cache_retention: "24h" });
  assert.deepEqual(request.input, [reasoning, { ...call, namespace: DIRECT_TOOL_NAMESPACE }, output]);
  assert.deepEqual(request.tools, [{ type: "namespace", name: DIRECT_TOOL_NAMESPACE, description: "Tools executed by GitHub Copilot in Visual Studio Code.", tools: [tool] }, { type: "web_search" }]);
  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  for (const field of ["previous_response_id", "max_output_tokens", "service_tier", "prompt_cache_retention"]) assert.equal(request[field], undefined);
});
