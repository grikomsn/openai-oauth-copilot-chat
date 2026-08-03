import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelRequestOptions,
  buildModelConfigurationSchema,
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
  supportsReasoningSummaryParameter: true,
  defaultReasoningSummary: "auto",
};

test("resolves picker options and applies them to a Fast request", () => {
  const options = resolveModelRequestOptions(
    spec,
    { reasoningEffort: "adaptive", reasoningSummary: "detailed" },
    { reasoningSummary: "concise" },
    "fast",
  );

  assert.deepEqual(options, {
    speedMode: "fast",
    reasoningEffort: "adaptive",
    reasoningSummary: "detailed",
  });
  assert.deepEqual(applyModelRequestOptions({ model: "gpt-5.6-sol" }, options), {
    model: "gpt-5.6-sol",
    reasoning: { effort: "adaptive", summary: "detailed" },
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
    { speedMode: "normal", reasoningEffort: "medium", reasoningSummary: "auto" },
  );
  assert.equal(
    resolveModelRequestOptions(spec, { mode: "fast:adaptive" }, {}, "normal").reasoningEffort,
    "adaptive",
  );
});

test("builds picker controls from the live model metadata", () => {
  const schema = buildModelConfigurationSchema(spec, {
    speedMode: "normal",
    reasoningEffort: "adaptive",
    reasoningSummary: "concise",
  });

  assert.deepEqual(schema.properties.reasoningEffort.enum, ["medium", "adaptive"]);
  assert.deepEqual(schema.properties.reasoningEffort.enumDescriptions, [
    "Balanced reasoning",
    "Let the model choose",
  ]);
  assert.equal(schema.properties.reasoningEffort.default, "adaptive");
  assert.equal(schema.properties.reasoningSummary.default, "concise");

  const unsupported = buildModelConfigurationSchema({
    ...spec,
    supportsReasoningSummaryParameter: false,
  });
  assert.equal("reasoningSummary" in unsupported.properties, false);
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
