import assert from "node:assert/strict";
import test from "node:test";
import { expandCodexModelVariants, parseCodexModelsPayload } from "./model-catalog";

test("maps the visible remote catalog metadata", () => {
  const models = parseCodexModelsPayload({
    models: [
      remoteModel({
        slug: "gpt-5.4-mini",
        display_name: "GPT-5.4-Mini",
        priority: 20,
        supports_reasoning_summary_parameter: false,
        default_reasoning_summary: "none",
        service_tiers: [{ id: "priority", description: "Faster generation" }],
      }),
      remoteModel({
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        priority: 1,
        input_modalities: ["text", "image"],
        default_reasoning_level: "adaptive",
        default_reasoning_summary: "concise",
        supported_reasoning_levels: [
          { effort: "low", description: "Fast responses" },
          { effort: "adaptive", description: "Let the model choose" },
          { effort: "ultra", description: "Automatic delegation" },
        ],
        service_tiers: [{ id: "priority", description: "Faster generation" }],
        additional_speed_tiers: ["fast"],
      }),
      remoteModel({ slug: "codex-auto-review", visibility: "hide" }),
    ],
  });

  assert.deepEqual(models.map((model) => ({
    id: model.id,
    name: model.name,
    image: model.image,
    efforts: model.reasoningLevels.map((level) => level.effort),
    defaultEffort: model.defaultReasoningEffort,
    defaultSummary: model.defaultReasoningSummary,
    supportsSummary: model.supportsReasoningSummaryParameter,
    supportsFast: model.supportsFast,
    fastDescription: model.fastDescription,
  })), [
    {
      id: "gpt-5.6-sol",
      name: "Codex 5.6 Sol",
      image: true,
      efforts: ["low", "adaptive"],
      defaultEffort: "adaptive",
      defaultSummary: "concise",
      supportsSummary: true,
      supportsFast: true,
      fastDescription: "Faster generation",
    },
    {
      id: "gpt-5.4-mini",
      name: "Codex 5.4 Mini",
      image: false,
      efforts: ["medium"],
      defaultEffort: "medium",
      defaultSummary: "none",
      supportsSummary: false,
      supportsFast: false,
      fastDescription: undefined,
    },
  ]);
});

test("expands Fast models without changing their backend slug", () => {
  const [model] = parseCodexModelsPayload({ models: [remoteModel({
    slug: "gpt-5.6-terra",
    display_name: "GPT-5.6-Terra",
    service_tiers: [{ id: "priority", description: "Faster generation" }],
    additional_speed_tiers: ["fast"],
  })] });

  assert.deepEqual(expandCodexModelVariants([model]).map((variant) => ({
    registrationId: variant.registrationId,
    rawModelId: variant.rawModelId,
    name: variant.name,
    speedMode: variant.speedMode,
    detail: variant.detail,
  })), [
    {
      registrationId: "gpt-5.6-terra",
      rawModelId: "gpt-5.6-terra",
      name: "Codex 5.6 Terra",
      speedMode: "normal",
      detail: undefined,
    },
    {
      registrationId: "gpt-5.6-terra:fast",
      rawModelId: "gpt-5.6-terra",
      name: "Codex 5.6 Terra Fast",
      speedMode: "fast",
      detail: "Faster generation",
    },
  ]);
});

test("maps default and advertised Codex context limits", () => {
  const models = parseCodexModelsPayload({ models: [
    remoteModel({ slug: "default-limits", priority: 1, context_window: 272_000 }),
    remoteModel({
      slug: "server-limits",
      priority: 2,
      context_window: 200_000,
      effective_context_window_percent: 80,
      auto_compact_token_limit: 150_000,
    }),
  ] });

  assert.deepEqual(models.map(({ input, output }) => ({ input, output })), [
    { input: 244_800, output: 13_600 },
    { input: 150_000, output: 10_000 },
  ]);
});

test("rejects malformed catalog responses", () => {
  assert.throws(() => parseCodexModelsPayload({}), /models array/);
  assert.throws(
    () => parseCodexModelsPayload({ models: [remoteModel({ visibility: "hide" })] }),
    /no visible models/,
  );
});

function remoteModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "gpt-test",
    display_name: "GPT-Test",
    description: "Test model.",
    visibility: "list",
    priority: 10,
    context_window: 128_000,
    input_modalities: ["text"],
    shell_type: "shell_command",
    supports_parallel_tool_calls: true,
    supports_reasoning_summary_parameter: true,
    default_reasoning_summary: "auto",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [{ effort: "medium", description: "Balanced reasoning" }],
    service_tiers: [],
    additional_speed_tiers: [],
    ...overrides,
  };
}
