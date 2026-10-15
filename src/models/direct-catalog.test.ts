import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectModelsPayload } from "./direct-catalog";
import { buildModelConfigurationSchema, modelOptionSpec, resolveModelRequestOptions } from "./options";

const remote = { slug: "gpt-test", display_name: "Test GPT", visibility: "list", supported_in_api: true,
  context_window: 128000, input_modalities: ["text", "image"], supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] };

test("discovers account models in server order and skips hidden, unsupported, or malformed entries", () => {
  const result = parseDirectModelsPayload({ models: [null, { ...remote, slug: "hidden", visibility: "hide" },
    { ...remote, slug: "unsupported", supported_in_api: false }, { ...remote, context_window: "bad" }, remote, { ...remote, slug: "new-model" }] });
  assert.deepEqual(result.map((model) => model.id), ["gpt-test", "new-model"]);
  assert.equal(result[0].image, true);
  assert.equal(result[0].input + result[0].output, 128000);
  assert.deepEqual(result[0].reasoningLevels.map((level) => level.effort), ["low", "high"]);
  assert.throws(() => parseDirectModelsPayload({ models: [] }), /No API-supported/);
});

test("omits unadvertised effort and unsupported image-generation/fast controls", () => {
  const model = parseDirectModelsPayload({ models: [{ ...remote, supported_reasoning_levels: undefined }] })[0];
  const spec = modelOptionSpec(model);
  const schema = buildModelConfigurationSchema(spec);
  assert.equal(schema.properties.reasoningEffort, undefined);
  assert.equal(schema.properties.imageGeneration, undefined);
  assert.equal(schema.properties.speedMode, undefined);
  assert.equal(resolveModelRequestOptions(spec, { imageGeneration: true, speedMode: "fast" }, {}, "normal").imageGeneration, false);
});
