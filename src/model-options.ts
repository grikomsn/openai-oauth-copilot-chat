export type SpeedMode = "normal" | "fast";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface ModelOptionSpec {
  efforts: readonly ReasoningEffort[];
  defaultEffort: ReasoningEffort;
  supportsFast: boolean;
}

export interface ModelRequestOptions {
  speedMode: SpeedMode;
  reasoningEffort: ReasoningEffort;
}

const DEFAULT_SPEC: ModelOptionSpec = {
  efforts: ["low", "medium", "high", "xhigh"],
  defaultEffort: "high",
  supportsFast: false,
};

const MODEL_OPTIONS: Readonly<Record<string, ModelOptionSpec>> = {
  "gpt-5.6-sol": {
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "low",
    supportsFast: true,
  },
  "gpt-5.6-terra": {
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
    supportsFast: true,
  },
  "gpt-5.6-luna": {
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
    supportsFast: true,
  },
  "gpt-5.5": { ...DEFAULT_SPEC, defaultEffort: "medium", supportsFast: true },
  "gpt-5.2": {
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    supportsFast: false,
  },
};

export function modelOptionSpec(modelId: string): ModelOptionSpec {
  return MODEL_OPTIONS[modelId] ?? DEFAULT_SPEC;
}

export function resolveModelRequestOptions(
  modelId: string,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefaults: Readonly<Record<string, unknown>>,
): ModelRequestOptions {
  const spec = modelOptionSpec(modelId);
  const pickerMode = parsePickerMode(stringOption(requestConfiguration, "mode"));
  const requestedEffort = pickerMode?.reasoningEffort
    ?? stringOption(requestConfiguration, "reasoningEffort")
    ?? stringOption(workspaceDefaults, "reasoningEffort");
  const requestedSpeed = pickerMode?.speedMode
    ?? stringOption(requestConfiguration, "speedMode")
    ?? stringOption(workspaceDefaults, "speedMode");
  return {
    reasoningEffort: spec.efforts.includes(requestedEffort as ReasoningEffort)
      ? requestedEffort as ReasoningEffort
      : spec.defaultEffort,
    speedMode: spec.supportsFast && requestedSpeed === "fast" ? "fast" : "normal",
  };
}

export function buildModelConfigurationSchema(
  modelId: string,
  defaults?: ModelRequestOptions,
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} {
  const spec = modelOptionSpec(modelId);
  const speeds: readonly SpeedMode[] = spec.supportsFast ? ["normal", "fast"] : ["normal"];
  const modes = speeds.flatMap((speedMode) => spec.efforts.map((reasoningEffort) => ({
    speedMode,
    reasoningEffort,
    value: `${speedMode}:${reasoningEffort}`,
  })));
  const defaultSpeed = spec.supportsFast && defaults?.speedMode === "fast" ? "fast" : "normal";
  const defaultEffort = defaults && spec.efforts.includes(defaults.reasoningEffort)
    ? defaults.reasoningEffort
    : spec.defaultEffort;
  const properties: Record<string, Record<string, unknown>> = {};
  properties.mode = {
    type: "string",
    title: spec.supportsFast ? "Speed & Effort" : "Reasoning Effort",
    enum: modes.map((mode) => mode.value),
    enumItemLabels: modes.map((mode) => spec.supportsFast
      ? `${formatOptionLabel(mode.speedMode)} · ${formatOptionLabel(mode.reasoningEffort)}`
      : formatOptionLabel(mode.reasoningEffort)),
    enumDescriptions: modes.map((mode) => {
      const speed = mode.speedMode === "fast"
        ? "1.5x speed with increased usage"
        : "Standard speed and usage";
      return spec.supportsFast ? `${speed}; ${effortDescription(mode.reasoningEffort)}` : effortDescription(mode.reasoningEffort);
    }),
    default: `${defaultSpeed}:${defaultEffort}`,
    group: "navigation",
  };
  return { type: "object", properties };
}

export function applyModelRequestOptions(
  body: Readonly<Record<string, unknown>>,
  options: ModelRequestOptions,
): Record<string, unknown> {
  return {
    ...body,
    reasoning: { effort: options.reasoningEffort, summary: "auto" },
    ...(options.speedMode === "fast" ? { service_tier: "priority" } : {}),
  };
}

function stringOption(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

function parsePickerMode(value: string | undefined): ModelRequestOptions | undefined {
  if (!value) return undefined;
  const [speedMode, reasoningEffort, extra] = value.split(":");
  if (extra !== undefined || !["normal", "fast"].includes(speedMode)) return undefined;
  if (!["none", "low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoningEffort)) return undefined;
  return { speedMode: speedMode as SpeedMode, reasoningEffort: reasoningEffort as ReasoningEffort };
}

function formatOptionLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function effortDescription(value: ReasoningEffort): string {
  switch (value) {
    case "none": return "No additional reasoning";
    case "low": return "Faster responses with lighter reasoning";
    case "medium": return "Balanced speed and reasoning depth";
    case "high": return "Greater reasoning depth for complex problems";
    case "xhigh": return "Extra-high reasoning depth";
    case "max": return "Maximum reasoning depth";
    case "ultra": return "Maximum reasoning with automatic task delegation";
  }
}
