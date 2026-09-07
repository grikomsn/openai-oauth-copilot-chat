/** Model-picker configuration and request-option translation. */

import {
  REASONING_SUMMARIES,
  type CodexModelMetadata,
  type ReasoningEffort,
  type ReasoningSummary,
  type SpeedMode,
} from "./catalog";

export type { ReasoningEffort, ReasoningSummary, SpeedMode } from "./catalog";

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
  imageGeneration: boolean;
  /** Opted-in context cap in input tokens; 0 keeps the model's default handling. */
  contextSize: number;
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
  const efforts = model.reasoningLevels.map((level) => level.effort);
  return {
    efforts,
    descriptions: Object.fromEntries(model.reasoningLevels.map((level) => [level.effort, level.description])),
    defaultEffort: efforts.includes("low") ? "low" : model.defaultReasoningEffort,
    supportsFast: model.supportsFast,
    fastDescription: model.fastDescription,
    supportsReasoningSummaryParameter: model.supportsReasoningSummaryParameter,
    defaultReasoningSummary: model.defaultReasoningSummary,
  };
}

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; "auto" selects the model's default handling. */
  readonly value: number | "auto";
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/**
 * Builds the context window tiers offered for a model's input limit.
 * Returns undefined when no tier fits below the limit, so small models keep
 * their picker unchanged.
 *
 * @example
 * ```ts
 * const options = contextSizeOptions(model.input);
 * console.log(options?.map((option) => option.label));
 * ```
 *
 * @see {@link resolveContextCap}
 */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    // VS Code treats every numeric contextSize, including zero, as an input budget.
    { value: "auto", label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/**
 * Resolves the effective context cap for a request.
 * Auto (0) and "Maximum" (the model's full input limit) keep the default
 * streaming behavior, so only strictly smaller tiers return a cap.
 *
 * @example
 * ```ts
 * const cap = resolveContextCap(options.contextSize, model.maxInputTokens);
 * ```
 *
 * @see {@link contextSizeOptions}
 */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
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
  const selectedMode = parseLegacyMode(stringOption(requestConfiguration, "mode"));
  // Prefer the combined picker value, then separate request settings, workspace fallbacks, and live model defaults.
  const requestedEffort = selectedMode?.reasoningEffort
    ?? parseConfiguredEffort(stringOption(requestConfiguration, "reasoningEffort"))
    ?? parseConfiguredEffort(stringOption(workspaceDefaults, "reasoningEffort"));
  const requestedSummary = parseConfiguredSummary(stringOption(requestConfiguration, "reasoningSummary"))
    ?? parseConfiguredSummary(stringOption(workspaceDefaults, "reasoningSummary"));
  const requestedWebSearch = booleanOption(requestConfiguration, "webSearch")
    ?? booleanOption(workspaceDefaults, "webSearch");
  const requestedImageGeneration = booleanOption(requestConfiguration, "imageGeneration")
    ?? booleanOption(workspaceDefaults, "imageGeneration");
  const requestedSpeed = selectedMode?.speedMode
    ?? parseConfiguredSpeed(stringOption(requestConfiguration, "speedMode"))
    ?? parseConfiguredSpeed(stringOption(workspaceDefaults, "speedMode"));
  const requestedContextSize = parseConfiguredContextSize(numberOption(requestConfiguration, "contextSize"));
  // A registered Fast variant is authoritative; settings cannot turn it back into a normal request.
  return {
    reasoningEffort: requestedEffort && spec.efforts.includes(requestedEffort)
      ? requestedEffort
      : spec.defaultEffort,
    reasoningSummary: requestedSummary === "model" || requestedSummary === undefined
      ? spec.defaultReasoningSummary
      : requestedSummary,
    webSearch: requestedWebSearch ?? false,
    imageGeneration: requestedImageGeneration ?? false,
    speedMode: speedMode === "fast"
      ? "fast"
      : spec.supportsFast && requestedSpeed === "fast" ? "fast" : "normal",
    contextSize: requestedContextSize ?? 0,
  };
}

/**
 * Builds the per-model configuration schema shown by the Copilot Chat picker.
 * Unsupported reasoning-summary controls are intentionally omitted. Optional
 * context tiers add a Context Window control to the tokens group.
 *
 * @example
 * ```ts
 * const schema = buildModelConfigurationSchema(spec, defaults, contextSizeOptions(model.input));
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
  contextOptions?: readonly ContextSizeOption[],
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} {
  const defaultEffort = defaults && spec.efforts.includes(defaults.reasoningEffort)
    ? defaults.reasoningEffort
    : spec.defaultEffort;
  const defaultSummary = defaults?.reasoningSummary ?? spec.defaultReasoningSummary;
  const defaultSpeedMode = defaults?.speedMode === "fast" ? "fast" : "normal";
  // VS Code renders one control per group. When Context Window occupies the
  // tokens slot, fold Fast into the reasoning choices in the navigation slot.
  const combinesSpeedMode = spec.supportsFast && Boolean(contextOptions?.length);
  const exposesSpeedMode = spec.supportsFast && !combinesSpeedMode;
  const modeOptions = spec.efforts.flatMap((effort) => {
    const label = formatOptionLabel(effort);
    const description = spec.descriptions[effort] ?? label;
    return [
      { value: `normal:${effort}`, label, description },
      {
        value: `fast:${effort}`,
        label: `${label} Fast`,
        description: `${description}. ${spec.fastDescription ?? "Faster generation with increased usage"}`,
      },
    ];
  });
  return {
    type: "object",
    properties: {
      ...(combinesSpeedMode ? {
        mode: {
          type: "string",
          title: "Reasoning & Speed",
          enum: modeOptions.map((option) => option.value),
          enumItemLabels: modeOptions.map((option) => option.label),
          enumDescriptions: modeOptions.map((option) => option.description),
          default: `${defaultSpeedMode}:${defaultEffort}`,
          group: "navigation",
        },
      } : {
        reasoningEffort: {
          type: "string",
          title: "Reasoning Effort",
          enum: [...spec.efforts],
          enumItemLabels: spec.efforts.map(formatOptionLabel),
          enumDescriptions: spec.efforts.map((effort) => spec.descriptions[effort] ?? formatOptionLabel(effort)),
          default: defaultEffort,
          group: "navigation",
        },
      }),
      webSearch: {
        type: "boolean",
        title: "Web Search",
        description: "Allow Codex to use OpenAI-hosted web search for this model.",
        default: defaults?.webSearch ?? false,
        group: "navigation",
      },
      imageGeneration: {
        type: "boolean",
        title: "Image Generation",
        description: "Allow Codex to use OpenAI-hosted image generation for this model.",
        default: defaults?.imageGeneration ?? false,
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
          ...(contextOptions?.length ? {} : { group: "tokens" }),
        },
      } : {}),
      ...(contextOptions?.length ? {
        contextSize: {
          type: ["string", "number"],
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: "auto",
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

function numberOption(value: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  return typeof value?.[key] === "number" ? value[key] as number : undefined;
}

function parseConfiguredContextSize(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
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
