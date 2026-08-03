export type SpeedMode = "normal" | "fast";
export type ReasoningEffort = string;
export const REASONING_SUMMARIES = ["auto", "concise", "detailed", "none"] as const;
export type ReasoningSummary = typeof REASONING_SUMMARIES[number];

export interface CodexReasoningLevel {
  effort: ReasoningEffort;
  description: string;
}

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
}

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

export function parseCodexModelsPayload(payload: unknown): CodexModelMetadata[] {
  const models = (payload as Partial<CodexModelsPayload> | null)?.models;
  if (!Array.isArray(models)) throw new Error("Codex model response is missing a models array");

  const visibleModels = models
    .filter((model) => model.visibility === "list")
    .sort((left, right) => left.priority - right.priority)
    .map(parseModel);
  if (!visibleModels.length) throw new Error("Codex model response contains no visible models");
  return visibleModels;
}

export function expandCodexModelVariants(models: readonly CodexModelMetadata[]): CodexModelVariant[] {
  return models.flatMap((model) => {
    const normal: CodexModelVariant = {
      ...model,
      registrationId: model.id,
      rawModelId: model.id,
      speedMode: "normal",
    };
    if (!model.supportsFast) return [normal];
    return [normal, {
      ...model,
      registrationId: `${model.id}:fast`,
      rawModelId: model.id,
      name: `${model.name} Fast`,
      speedMode: "fast",
      detail: model.fastDescription,
    }];
  });
}

export function formatCodexDisplayName(displayName: string): string {
  return displayName.replaceAll("-", " ").replaceAll("GPT", "Codex").replace(/\s+/g, " ").trim();
}

function parseModel(model: RemoteCodexModel): CodexModelMetadata {
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
    reasoningLevels: model.supported_reasoning_levels.filter(({ effort }) => effort !== "ultra"),
    defaultReasoningEffort: model.default_reasoning_level,
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
  const input = Math.min(autoCompactLimit, effectiveContextWindow);
  return { input, output: effectiveContextWindow - input };
}
