import {
  REASONING_SUMMARIES,
  type CodexModelMetadata,
  type ReasoningEffort,
  type ReasoningSummary,
  type SpeedMode,
} from "./model-catalog";

export type { ReasoningEffort, ReasoningSummary, SpeedMode } from "./model-catalog";

export interface ModelOptionSpec {
  efforts: readonly ReasoningEffort[];
  descriptions: Readonly<Partial<Record<ReasoningEffort, string>>>;
  defaultEffort: ReasoningEffort;
  supportsReasoningSummaryParameter: boolean;
  defaultReasoningSummary: ReasoningSummary;
}

export interface ModelRequestOptions {
  speedMode: SpeedMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummary: ReasoningSummary;
}

export function modelOptionSpec(
  model: Pick<
    CodexModelMetadata,
    "reasoningLevels" | "defaultReasoningEffort" | "supportsReasoningSummaryParameter" | "defaultReasoningSummary"
  >,
): ModelOptionSpec {
  return {
    efforts: model.reasoningLevels.map((level) => level.effort),
    descriptions: Object.fromEntries(model.reasoningLevels.map((level) => [level.effort, level.description])),
    defaultEffort: model.defaultReasoningEffort,
    supportsReasoningSummaryParameter: model.supportsReasoningSummaryParameter,
    defaultReasoningSummary: model.defaultReasoningSummary,
  };
}

export function resolveModelRequestOptions(
  spec: ModelOptionSpec,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefaults: Readonly<Record<string, unknown>>,
  speedMode: SpeedMode,
): ModelRequestOptions {
  const requestedEffort = parseConfiguredEffort(stringOption(requestConfiguration, "reasoningEffort"))
    ?? parseLegacyMode(stringOption(requestConfiguration, "mode"));
  const requestedSummary = parseConfiguredSummary(stringOption(requestConfiguration, "reasoningSummary"))
    ?? parseConfiguredSummary(stringOption(workspaceDefaults, "reasoningSummary"));
  return {
    reasoningEffort: requestedEffort && spec.efforts.includes(requestedEffort)
      ? requestedEffort
      : spec.defaultEffort,
    reasoningSummary: requestedSummary === "model" || requestedSummary === undefined
      ? spec.defaultReasoningSummary
      : requestedSummary,
    speedMode,
  };
}

export function buildModelConfigurationSchema(
  spec: ModelOptionSpec,
  defaults?: ModelRequestOptions,
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} {
  const defaultEffort = defaults && spec.efforts.includes(defaults.reasoningEffort)
    ? defaults.reasoningEffort
    : spec.defaultEffort;
  const defaultSummary = defaults?.reasoningSummary ?? spec.defaultReasoningSummary;
  return {
    type: "object",
    properties: {
      reasoningEffort: {
        type: "string",
        title: "Reasoning Effort",
        enum: [...spec.efforts],
        enumItemLabels: spec.efforts.map(formatOptionLabel),
        enumDescriptions: spec.efforts.map((effort) => spec.descriptions[effort] ?? formatOptionLabel(effort)),
        default: defaultEffort,
        group: "navigation",
      },
      ...(spec.supportsReasoningSummaryParameter ? {
        reasoningSummary: {
          type: "string",
          title: "Reasoning Summary",
          enum: [...REASONING_SUMMARIES],
          enumItemLabels: REASONING_SUMMARIES.map(formatOptionLabel),
          enumDescriptions: [
            "Let Codex choose the summary detail",
            "Return a concise reasoning summary",
            "Return a detailed reasoning summary",
            "Do not request a reasoning summary",
          ],
          default: defaultSummary,
          group: "navigation",
        },
      } : {}),
    },
  };
}

export function applyModelRequestOptions(
  body: Readonly<Record<string, unknown>>,
  options: ModelRequestOptions,
  supportsReasoningSummaryParameter = true,
): Record<string, unknown> {
  return {
    ...body,
    reasoning: {
      effort: options.reasoningEffort,
      ...(supportsReasoningSummaryParameter && options.reasoningSummary !== "none"
        ? { summary: options.reasoningSummary }
        : {}),
    },
    ...(options.speedMode === "fast" ? { service_tier: "priority" } : {}),
  };
}

function stringOption(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

function parseConfiguredEffort(value: string | undefined): ReasoningEffort | undefined {
  return value && value !== "model" ? value : undefined;
}

function parseConfiguredSummary(value: string | undefined): ReasoningSummary | "model" | undefined {
  return value === "model" ? value : REASONING_SUMMARIES.find((summary) => summary === value);
}

function parseLegacyMode(value: string | undefined): ReasoningEffort | undefined {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts.length > 2) return undefined;
  const effort = parts.length === 2 ? parts[1] : parts[0];
  return effort || undefined;
}

function formatOptionLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
