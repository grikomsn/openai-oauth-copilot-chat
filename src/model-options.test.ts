import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelRequestOptions,
  buildModelConfigurationSchema,
  modelOptionSpec,
  resolveModelRequestOptions,
  type ModelOptionSpec,
} from "./model-options";

const spec: ModelOptionSpec = {
  efforts: ["medium", "adaptive"],
  descriptions: {
    medium: "Balanced reasoning",
    adaptive: "Let the model choose",
  },
  defaultEffort: "medium",
  supportsFast: true,
  fastDescription: "Faster generation",
  supportsReasoningSummaryParameter: true,
  defaultReasoningSummary: "auto",
};

test("resolves picker options and applies them to a Fast request", () => {
  const options = resolveModelRequestOptions(
    spec,
    { reasoningEffort: "adaptive", reasoningSummary: "detailed", webSearch: true, imageGeneration: true },
    { reasoningSummary: "concise" },
    "fast",
  );

  assert.deepEqual(options, {
    speedMode: "fast",
    reasoningEffort: "adaptive",
    reasoningSummary: "detailed",
    webSearch: true,
    imageGeneration: true,
  });
  assert.deepEqual(applyModelRequestOptions({ model: "gpt-5.6-sol" }, options), {
    model: "gpt-5.6-sol",
    reasoning: { effort: "adaptive", summary: "detailed" },
    service_tier: "priority",
  });
});

test("lets a normal model switch to Fast through its configuration", () => {
  const options = resolveModelRequestOptions(
    spec,
    { speedMode: "fast", reasoningEffort: "adaptive" },
    {},
    "normal",
  );

  assert.equal(options.speedMode, "fast");
  assert.deepEqual(applyModelRequestOptions({ model: "gpt-5.6-sol" }, options), {
    model: "gpt-5.6-sol",
    reasoning: { effort: "adaptive", summary: "auto" },
    service_tier: "priority",
  });
});

test("falls back to live model defaults and reads legacy picker values", () => {
  assert.deepEqual(
    resolveModelRequestOptions(
      spec,
      { reasoningEffort: "unsupported" },
      { reasoningEffort: "adaptive", reasoningSummary: "model" },
      "normal",
    ),
    { speedMode: "normal", reasoningEffort: "medium", reasoningSummary: "auto", webSearch: false, imageGeneration: false },
  );
  assert.equal(
    resolveModelRequestOptions(spec, { mode: "fast:adaptive" }, {}, "normal").reasoningEffort,
    "adaptive",
  );
});

test("retains legacy workspace effort and speed fallbacks", () => {
  assert.deepEqual(
    resolveModelRequestOptions(
      spec,
      undefined,
      { reasoningEffort: "adaptive", speedMode: "fast", reasoningSummary: "model" },
      "normal",
    ),
    { speedMode: "fast", reasoningEffort: "adaptive", reasoningSummary: "auto", webSearch: false, imageGeneration: false },
  );
  assert.equal(
    resolveModelRequestOptions({ ...spec, supportsFast: false }, undefined, { speedMode: "fast" }, "normal").speedMode,
    "normal",
  );
  assert.equal(
    resolveModelRequestOptions(spec, undefined, { speedMode: "normal" }, "fast").speedMode,
    "fast",
  );
});

test("builds picker controls from the live model metadata", () => {
  const schema = buildModelConfigurationSchema(spec, {
    speedMode: "normal",
    reasoningEffort: "adaptive",
    reasoningSummary: "concise",
    webSearch: false,
    imageGeneration: false,
  });

  assert.deepEqual(schema.properties.reasoningEffort.enum, ["medium", "adaptive"]);
  assert.deepEqual(schema.properties.reasoningEffort.enumDescriptions, [
    "Balanced reasoning",
    "Let the model choose",
  ]);
  assert.equal(schema.properties.reasoningEffort.default, "adaptive");
  assert.equal(schema.properties.webSearch.type, "boolean");
  assert.equal(schema.properties.webSearch.title, "Web Search");
  assert.equal(schema.properties.webSearch.default, false);
  assert.equal(schema.properties.webSearch.group, "navigation");
  assert.equal(schema.properties.imageGeneration.type, "boolean");
  assert.equal(schema.properties.imageGeneration.title, "Image Generation");
  assert.equal(schema.properties.imageGeneration.default, false);
  assert.equal(schema.properties.imageGeneration.group, "navigation");
  assert.deepEqual(schema.properties.speedMode.enum, ["normal", "fast"]);
  assert.deepEqual(schema.properties.speedMode.enumDescriptions, [
    "Standard speed and usage",
    "Faster generation",
  ]);
  assert.equal(schema.properties.speedMode.group, "tokens");
  assert.equal(schema.properties.speedMode.default, "normal");
  assert.equal(schema.properties.reasoningSummary.default, "concise");

  const legacyFastDefaultSchema = buildModelConfigurationSchema(spec, {
    speedMode: "fast",
    reasoningEffort: "adaptive",
    reasoningSummary: "concise",
    webSearch: false,
    imageGeneration: false,
  });
  assert.deepEqual(legacyFastDefaultSchema.properties.speedMode.enum, ["normal", "fast"]);
  assert.equal(legacyFastDefaultSchema.properties.speedMode.default, "fast");
  assert.equal(legacyFastDefaultSchema.properties.webSearch.default, false);
  assert.equal(legacyFastDefaultSchema.properties.imageGeneration.default, false);

  const unsupported = buildModelConfigurationSchema({
    ...spec,
    supportsReasoningSummaryParameter: false,
  });
  assert.equal("reasoningSummary" in unsupported.properties, false);
});

test("carries the live Fast-tier description into the picker schema", () => {
  const optionSpec = modelOptionSpec({
    reasoningLevels: [{ effort: "medium", description: "Balanced reasoning" }],
    defaultReasoningEffort: "medium",
    supportsFast: true,
    fastDescription: "Priority responses",
    supportsReasoningSummaryParameter: false,
    defaultReasoningSummary: "none",
  });

  assert.equal(optionSpec.fastDescription, "Priority responses");
  assert.deepEqual(buildModelConfigurationSchema(optionSpec).properties.speedMode.enumDescriptions, [
    "Standard speed and usage",
    "Priority responses",
  ]);
});

test("omits reasoning summaries when disabled or unsupported", () => {
  const disabled = resolveModelRequestOptions(spec, { reasoningSummary: "none" }, {}, "normal");
  assert.deepEqual(applyModelRequestOptions({}, disabled), {
    reasoning: { effort: "medium" },
  });

  const detailed = resolveModelRequestOptions(spec, { reasoningSummary: "detailed" }, {}, "normal");
  assert.deepEqual(applyModelRequestOptions({}, detailed, false), {
    reasoning: { effort: "medium" },
  });
});
