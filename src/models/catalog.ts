/** Model-directory types and normalization for the live Codex picker. */

import type { ModelsDevModelMetadata } from "./metadata";
import type { ModelCost } from "./pricing";

/** Processing speed requested for a model. */
export type SpeedMode = "normal" | "fast";
/** A model-advertised reasoning effort. */
export type ReasoningEffort = string;
/** Reasoning summary modes accepted by the Codex backend. */
export const REASONING_SUMMARIES = ["auto", "concise", "detailed", "none"] as const;
/** A supported reasoning summary mode. */
export type ReasoningSummary = typeof REASONING_SUMMARIES[number];

/** One reasoning level advertised by the model directory. */
export interface CodexReasoningLevel {
  effort: ReasoningEffort;
  description: string;
}

/** Normalized metadata for a model exposed by the extension. */
export interface CodexModelMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  input: number;
  output: number;
  image: boolean;
  toolCalling: boolean;
  supportsParallelToolCalls: boolean;
  supportsReasoningSummaryParameter: boolean;
  reasoningLevels: readonly CodexReasoningLevel[];
  defaultReasoningEffort: ReasoningEffort;
  defaultReasoningSummary: ReasoningSummary;
  supportsFast: boolean;
  fastDescription?: string;
  priority: number;
  releaseDate?: string;
  lastUpdated?: string;
  cost?: ModelCost;
}

/** A picker-ready model entry, including its selected speed mode. */
export interface CodexModelVariant extends CodexModelMetadata {
  registrationId: string;
  rawModelId: string;
  speedMode: SpeedMode;
  detail?: string;
}

interface CodexModelsPayload {
  models: RemoteCodexModel[];
}

interface RemoteCodexModel {
  slug: string;
  display_name: string;
  description: string;
  visibility: "list" | "hide";
  priority: number;
  context_window: number | null;
  max_context_window: number;
  effective_context_window_percent?: number;
  auto_compact_token_limit: number | null;
  comp_hash: string | null;
  input_modalities: string[];
  shell_type: string;
  supports_parallel_tool_calls: boolean;
  supports_reasoning_summary_parameter: boolean;
  supported_reasoning_levels: CodexReasoningLevel[];
  default_reasoning_level: ReasoningEffort;
  default_reasoning_summary: ReasoningSummary;
  additional_speed_tiers: string[];
  service_tiers: Array<{ id: string; description: string }>;
}

const DEFAULT_EFFECTIVE_CONTEXT_RATIO = 0.95;
const DEFAULT_AUTO_COMPACT_RATIO = 0.9;

/**
 * Converts the backend model-directory response into selectable model metadata.
 * Hidden models and models without a usable reasoning level are omitted.
 *
 * @example
 * ```ts
 * const models = parseCodexModelsPayload(await response.json());
 * console.log(models.map((model) => model.id));
 * ```
 *
 * @see {@link CodexModelMetadata}
 * @see {@link expandCodexModelVariants}
 */
export function parseCodexModelsPayload(payload: unknown): CodexModelMetadata[] {
  const models = (payload as Partial<CodexModelsPayload> | null)?.models;
  if (!Array.isArray(models)) throw new Error("Codex model response is missing a models array");

  // The directory can contain hidden or incomplete entries; only expose models the picker can use.
  const visibleModels = models
    .filter((model) => model.visibility === "list")
    .sort((left, right) => left.priority - right.priority)
    .flatMap((model) => parseModel(model) ?? []);
  if (!visibleModels.length) throw new Error("Codex model response contains no visible models");
  return visibleModels;
}

/**
 * Normalizes each live model into one picker entry.
 * Fast remains a capability on the normal entry and is selected through its
 * native Speed Mode configuration instead of a second picker entry.
 *
 * @example
 * ```ts
 * const variants = expandCodexModelVariants(models);
 * console.log(variants.map((model) => model.name));
 * ```
 *
 * @see {@link parseCodexModelsPayload}
 * @see {@link CodexModelVariant}
 */
export function expandCodexModelVariants(models: readonly CodexModelMetadata[]): CodexModelVariant[] {
  return models.flatMap((model) => {
    // Keep one stable picker identity so Speed Mode is the only way to opt into Fast.
    const normal: CodexModelVariant = {
      ...model,
      registrationId: model.id,
      rawModelId: model.id,
      speedMode: "normal",
    };
    return [normal];
  });
}

/**
 * Formats a catalog label for the model picker without changing its product name.
 *
 * @example
 * ```ts
 * formatCodexDisplayName("GPT-5.6-Luna"); // "GPT 5.6 Luna"
 * ```
 *
 * @see {@link parseCodexModelsPayload}
 */
export function formatCodexDisplayName(displayName: string): string {
  return displayName.replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

export function enrichCodexModel(model: CodexModelMetadata, metadata: ModelsDevModelMetadata | undefined): CodexModelMetadata {
  if (!metadata) return model;
  const contextWindow = metadata.contextLength;
  const output = model.output > 0 ? model.output : Math.min(metadata.maxOutputTokens ?? 0, contextWindow ?? Number.MAX_SAFE_INTEGER);
  const input = model.input > 0
    ? model.input
    : metadata.maxInputTokens ?? Math.max(0, (contextWindow ?? 0) - output);
  return {
    ...model,
    name: model.name || metadata.name || model.id,
    description: model.description || metadata.description || "",
    input,
    output,
    releaseDate: metadata.releaseDate,
    lastUpdated: metadata.lastUpdated,
    cost: metadata.cost,
  };
}

function parseModel(model: RemoteCodexModel): CodexModelMetadata | undefined {
  // Some backend releases advertise internal-only "ultra"; do not let it leak into the picker.
  const reasoningLevels = model.supported_reasoning_levels.filter(({ effort }) => effort !== "ultra");
  const defaultReasoningLevel = reasoningLevels.find(({ effort }) => effort === model.default_reasoning_level)
    ?? reasoningLevels.at(-1);
  if (!defaultReasoningLevel) return undefined;

  const { input, output } = codexTokenLimits(model);
  const supportsFast = model.additional_speed_tiers.includes("fast");
  const fastDescription = supportsFast
    ? model.service_tiers.find((tier) => tier.id === "priority")?.description
    : undefined;

  return {
    id: model.slug,
    name: formatCodexDisplayName(model.display_name),
    description: model.description,
    version: model.comp_hash ?? model.slug,
    input,
    output,
    image: model.input_modalities.includes("image"),
    toolCalling: model.shell_type !== "disabled",
    supportsParallelToolCalls: model.supports_parallel_tool_calls,
    supportsReasoningSummaryParameter: model.supports_reasoning_summary_parameter,
    reasoningLevels,
    defaultReasoningEffort: defaultReasoningLevel.effort,
    defaultReasoningSummary: model.default_reasoning_summary,
    supportsFast,
    fastDescription,
    priority: model.priority,
  };
}

function codexTokenLimits(model: RemoteCodexModel): { input: number; output: number } {
  const contextWindow = model.context_window ?? model.max_context_window;
  const effectiveRatio = model.effective_context_window_percent === undefined
    ? DEFAULT_EFFECTIVE_CONTEXT_RATIO
    : model.effective_context_window_percent / 100;
  const effectiveContextWindow = Math.floor(contextWindow * effectiveRatio);
  const defaultAutoCompactLimit = Math.floor(contextWindow * DEFAULT_AUTO_COMPACT_RATIO);
  const autoCompactLimit = Math.min(
    model.auto_compact_token_limit ?? defaultAutoCompactLimit,
    defaultAutoCompactLimit,
  );
  // Keep input below the compaction threshold and reserve the remaining effective window for output.
  const input = Math.min(autoCompactLimit, effectiveContextWindow);
  return { input, output: effectiveContextWindow - input };
}
