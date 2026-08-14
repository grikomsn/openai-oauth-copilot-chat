/** Model-picker configuration and request-option translation. */

import {
  REASONING_SUMMARIES,
  type CodexModelMetadata,
  type ReasoningEffort,
  type ReasoningSummary,
  type SpeedMode,
} from "./model-catalog";

export type { ReasoningEffort, ReasoningSummary, SpeedMode } from "./model-catalog";

/** Capabilities used to build a model's configuration controls. */
export interface ModelOptionSpec {
  efforts: readonly ReasoningEffort[];
  descriptions: Readonly<Partial<Record<ReasoningEffort, string>>>;
  defaultEffort: ReasoningEffort;
  supportsFast: boolean;
  fastDescription?: string;
  supportsReasoningSummaryParameter: boolean;
  defaultReasoningSummary: ReasoningSummary;
}

/** Options resolved from the picker and workspace fallback settings. */
export interface ModelRequestOptions {
  speedMode: SpeedMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummary: ReasoningSummary;
  webSearch: boolean;
}

/**
 * Projects live model metadata into the option specification used by VS Code.
 *
 * @example
 * ```ts
 * const spec = modelOptionSpec(model);
 * console.log(spec.efforts, spec.supportsFast);
 * ```
 *
 * @see {@link CodexModelMetadata}
 * @see {@link resolveModelRequestOptions}
 */
export function modelOptionSpec(
  model: Pick<
    CodexModelMetadata,
    "reasoningLevels" | "defaultReasoningEffort" | "supportsFast" | "fastDescription" | "supportsReasoningSummaryParameter" | "defaultReasoningSummary"
  >,
): ModelOptionSpec {
  return {
    efforts: model.reasoningLevels.map((level) => level.effort),
    descriptions: Object.fromEntries(model.reasoningLevels.map((level) => [level.effort, level.description])),
    defaultEffort: model.defaultReasoningEffort,
    supportsFast: model.supportsFast,
    fastDescription: model.fastDescription,
    supportsReasoningSummaryParameter: model.supportsReasoningSummaryParameter,
    defaultReasoningSummary: model.defaultReasoningSummary,
  };
}

/**
 * Resolves request and workspace settings against one live model's capabilities.
 * Per-request settings take precedence over legacy and workspace fallbacks.
 *
 * @example
 * ```ts
 * const options = resolveModelRequestOptions(
 *   spec,
 *   { reasoningEffort: "high" },
 *   { reasoningSummary: "concise" },
 *   "normal",
 * );
 * ```
 *
 * @see {@link modelOptionSpec}
 * @see {@link applyModelRequestOptions}
 */
export function resolveModelRequestOptions(
  spec: ModelOptionSpec,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefaults: Readonly<Record<string, unknown>>,
  speedMode: SpeedMode,
): ModelRequestOptions {
  const legacyMode = parseLegacyMode(stringOption(requestConfiguration, "mode"));
  // Prefer request-specific values, then legacy picker values, workspace fallbacks, and live model defaults.
  const requestedEffort = parseConfiguredEffort(stringOption(requestConfiguration, "reasoningEffort"))
    ?? legacyMode?.reasoningEffort
    ?? parseConfiguredEffort(stringOption(workspaceDefaults, "reasoningEffort"));
  const requestedSummary = parseConfiguredSummary(stringOption(requestConfiguration, "reasoningSummary"))
    ?? parseConfiguredSummary(stringOption(workspaceDefaults, "reasoningSummary"));
  const requestedWebSearch = booleanOption(requestConfiguration, "webSearch")
    ?? booleanOption(workspaceDefaults, "webSearch");
  const requestedSpeed = parseConfiguredSpeed(stringOption(requestConfiguration, "speedMode"))
    ?? legacyMode?.speedMode
    ?? parseConfiguredSpeed(stringOption(workspaceDefaults, "speedMode"));
  // A registered Fast variant is authoritative; settings cannot turn it back into a normal request.
  return {
    reasoningEffort: requestedEffort && spec.efforts.includes(requestedEffort)
      ? requestedEffort
      : spec.defaultEffort,
    reasoningSummary: requestedSummary === "model" || requestedSummary === undefined
      ? spec.defaultReasoningSummary
      : requestedSummary,
    webSearch: requestedWebSearch ?? false,
    speedMode: speedMode === "fast"
      ? "fast"
      : spec.supportsFast && requestedSpeed === "fast" ? "fast" : "normal",
  };
}

/**
 * Builds the per-model configuration schema shown by the Copilot Chat picker.
 * Unsupported reasoning-summary controls are intentionally omitted.
 *
 * @example
 * ```ts
 * const schema = buildModelConfigurationSchema(spec, defaults);
 * console.log(schema.properties.reasoningEffort.enum);
 * console.log(schema.properties.speedMode.enum);
 * ```
 *
 * @see {@link ModelOptionSpec}
 * @see {@link applyModelRequestOptions}
 */
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
  // Every Fast-capable model has one picker entry, so its Speed Mode toggle is
  // always visible; legacy Fast defaults only choose the initial toggle value.
  // Keep this in the tokens group because VS Code renders one control per group.
  const exposesSpeedMode = spec.supportsFast;
  const defaultSpeedMode = defaults?.speedMode === "fast" ? "fast" : "normal";
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
      webSearch: {
        type: "boolean",
        title: "Web Search",
        description: "Allow Codex to use OpenAI-hosted web search for this model.",
        default: defaults?.webSearch ?? false,
        group: "navigation",
      },
      ...(exposesSpeedMode ? {
        speedMode: {
          type: "string",
          title: "Speed Mode",
          enum: ["normal", "fast"],
          enumItemLabels: ["Normal", "Fast"],
          enumDescriptions: [
            "Standard speed and usage",
            spec.fastDescription ?? "Faster generation with increased usage",
          ],
          default: defaultSpeedMode,
          group: "tokens",
        },
      } : {}),
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

/**
 * Applies resolved model options to a Responses API request body.
 *
 * @example
 * ```ts
 * const body = applyModelRequestOptions(
 *   { model: "gpt-5", stream: true },
 *   { speedMode: "fast", reasoningEffort: "high", reasoningSummary: "concise", webSearch: false },
 * );
 * ```
 *
 * @see {@link resolveModelRequestOptions}
 */
export function applyModelRequestOptions(
  body: Readonly<Record<string, unknown>>,
  options: ModelRequestOptions,
  supportsReasoningSummaryParameter = true,
): Record<string, unknown> {
  // Omit unsupported/"none" summaries and only opt into the priority tier for Fast mode.
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

function booleanOption(value: Readonly<Record<string, unknown>> | undefined, key: string): boolean | undefined {
  return typeof value?.[key] === "boolean" ? value[key] as boolean : undefined;
}

function parseConfiguredEffort(value: string | undefined): ReasoningEffort | undefined {
  return value && value !== "model" ? value : undefined;
}

function parseConfiguredSpeed(value: string | undefined): SpeedMode | undefined {
  return value === "normal" || value === "fast" ? value : undefined;
}

function parseConfiguredSummary(value: string | undefined): ReasoningSummary | "model" | undefined {
  return value === "model" ? value : REASONING_SUMMARIES.find((summary) => summary === value);
}

function parseLegacyMode(value: string | undefined): { speedMode?: SpeedMode; reasoningEffort?: ReasoningEffort } | undefined {
  if (!value) return undefined;
  // Older picker values were either an effort or a speed:effort pair; keep both forms readable.
  const [first, second, extra] = value.split(":");
  if (extra !== undefined || !first) return undefined;
  if (second === undefined) {
    return first === "normal" || first === "fast"
      ? { speedMode: first }
      : { reasoningEffort: first };
  }
  if (first !== "normal" && first !== "fast") return undefined;
  return { speedMode: first, reasoningEffort: second };
}

function formatOptionLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
