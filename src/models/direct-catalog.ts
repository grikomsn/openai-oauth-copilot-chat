/** Defensive normalization of the account-specific ChatGPT public API catalog. */
import type { CodexModelMetadata, CodexReasoningLevel } from "./catalog";

export function parseDirectModelsPayload(raw: unknown): CodexModelMetadata[] {
  const root = record(raw);
  if (!Array.isArray(root?.models)) throw new Error("ChatGPT model response is missing a models array.");
  const models = root.models.flatMap((entry, priority) => {
    const model = record(entry);
    if (!model || model.visibility !== "list" || model.supported_in_api !== true
      || typeof model.slug !== "string" || !model.slug || typeof model.display_name !== "string"
      || !positive(model.context_window)) return [];
    const levels: CodexReasoningLevel[] = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.flatMap((rawLevel) => {
        const level = record(rawLevel);
        return typeof level?.effort === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(level.effort) && level.effort !== "ultra"
          ? [{ effort: level.effort, description: typeof level.description === "string" ? level.description : level.effort }] : [];
      }) : [];
    const output = Math.min(positive(model.max_output_tokens) ? model.max_output_tokens : 8192, Math.max(1, model.context_window - 1));
    return [{
      id: model.slug, name: model.display_name, description: typeof model.description === "string" ? model.description : "",
      version: model.slug, input: Math.max(1, model.context_window - output), output,
      image: Array.isArray(model.input_modalities) && model.input_modalities.includes("image"),
      toolCalling: true, supportsParallelToolCalls: model.supports_parallel_tool_calls !== false,
      supportsReasoningSummaryParameter: model.supports_reasoning_summary_parameter === true,
      reasoningLevels: levels, defaultReasoningEffort: levels.find((level) => level.effort === model.default_reasoning_level)?.effort ?? levels[0]?.effort ?? "",
      defaultReasoningSummary: "none" as const,
      // Fast model slugs remain distinct catalog entries; do not guess service-tier overrides.
      supportsFast: false, supportsImageGeneration: false, priority,
    } satisfies CodexModelMetadata];
  });
  if (!models.length) throw new Error("No API-supported ChatGPT models are available for this account.");
  return models;
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}
function positive(raw: unknown): raw is number { return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 1; }
