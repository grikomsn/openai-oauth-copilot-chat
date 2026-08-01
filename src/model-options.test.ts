import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelRequestOptions,
  buildModelConfigurationSchema,
  resolveModelRequestOptions,
} from "./model-options";

test("per-request speed and effort override workspace defaults", () => {
  const options = resolveModelRequestOptions(
    "gpt-5.6-sol",
    { speedMode: "fast", reasoningEffort: "ultra" },
    { speedMode: "normal", reasoningEffort: "low" },
  );
  assert.deepEqual(options, { speedMode: "fast", reasoningEffort: "ultra" });
  assert.deepEqual(applyModelRequestOptions({ model: "gpt-5.6-sol" }, options), {
    model: "gpt-5.6-sol",
    reasoning: { effort: "ultra", summary: "auto" },
    service_tier: "priority",
  });
});

test("combined model-picker mode overrides both workspace defaults", () => {
  assert.deepEqual(
    resolveModelRequestOptions(
      "gpt-5.6-sol",
      { mode: "fast:max" },
      { speedMode: "normal", reasoningEffort: "low" },
    ),
    { speedMode: "fast", reasoningEffort: "max" },
  );
});

test("normal mode omits service_tier", () => {
  const body = applyModelRequestOptions(
    { model: "gpt-5.6-terra" },
    { speedMode: "normal", reasoningEffort: "medium" },
  );
  assert.equal("service_tier" in body, false);
});

test("unsupported fast mode and effort safely fall back per model", () => {
  assert.deepEqual(
    resolveModelRequestOptions(
      "gpt-5.2",
      { speedMode: "fast", reasoningEffort: "ultra" },
      {},
    ),
    { speedMode: "normal", reasoningEffort: "medium" },
  );
});

test("configuration schema exposes every speed and effort combination in one host-visible control", () => {
  const fastSchema = buildModelConfigurationSchema("gpt-5.6-sol");
  assert.deepEqual(fastSchema.properties.mode.enum, [
    "normal:low", "normal:medium", "normal:high", "normal:xhigh", "normal:max", "normal:ultra",
    "fast:low", "fast:medium", "fast:high", "fast:xhigh", "fast:max", "fast:ultra",
  ]);

  const normalOnlySchema = buildModelConfigurationSchema("gpt-5.2");
  assert.deepEqual(normalOnlySchema.properties.mode.enum, [
    "normal:low", "normal:medium", "normal:high", "normal:xhigh",
  ]);
});

test("workspace defaults are reflected in the picker schema", () => {
  const schema = buildModelConfigurationSchema("gpt-5.6-sol", {
    speedMode: "fast",
    reasoningEffort: "max",
  });
  assert.equal(schema.properties.mode.default, "fast:max");
});
