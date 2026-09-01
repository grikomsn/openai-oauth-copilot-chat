import assert from "node:assert/strict";
import test from "node:test";
import { costCategory, modelPricingFields, openAIModelCost } from "./pricing";

test("converts USD per-million rates to VS Code pricing fields", () => {
  assert.deepEqual(modelPricingFields({ input: 2, cacheRead: 0.2, output: 12 }), {
    pricing: "In: $2 · Out: $12 /1M tokens",
    inputCost: 200,
    outputCost: 1200,
    cacheCost: 20,
    priceCategory: "medium",
  });
  assert.deepEqual(modelPricingFields({ input: 0, cacheRead: 0, output: 0 }), {
    pricing: "Free",
    inputCost: 0,
    outputCost: 0,
    cacheCost: 0,
    priceCategory: "low",
  });
  assert.equal(modelPricingFields(undefined), undefined);
});

test("uses official standard rates when models.dev metadata is unavailable", () => {
  assert.deepEqual(openAIModelCost("gpt-5.6-terra"), { input: 2, cacheRead: 0.2, output: 12 });
  assert.equal(openAIModelCost("future-model"), undefined);
});

test("categorizes a weighted three-to-one input and output blend", () => {
  assert.equal(costCategory({ input: 0.2, output: 1.2 }), "low");
  assert.equal(costCategory({ input: 2, output: 12 }), "medium");
  assert.equal(costCategory({ input: 5, output: 25 }), "high");
  assert.equal(costCategory({ input: 30, output: 180 }), "very_high");
});
