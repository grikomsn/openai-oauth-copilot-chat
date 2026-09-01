export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
}

export interface ModelPricingFields {
  readonly pricing: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheCost?: number;
  readonly priceCategory: "low" | "medium" | "high" | "very_high";
}

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "gpt-5.6-sol": { input: 4, cacheRead: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cacheRead: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cacheRead: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cacheRead: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cacheRead: 0.5, output: 30 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  "gpt-5.4": { input: 2.5, cacheRead: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cacheRead: 0.075, output: 4.5 },
  "gpt-5.4-pro": { input: 30, output: 180 },
  "gpt-5.3-codex": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.3-codex-spark": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.2": { input: 1.75, cacheRead: 0.175, output: 14 },
};

export function openAIModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  return discovered ?? OFFICIAL_MODEL_COSTS[id];
}

export function modelPricingFields(cost: ModelCost | undefined): ModelPricingFields | undefined {
  if (!cost) return undefined;
  if (cost.input === 0 && cost.output === 0) {
    return {
      pricing: "Free",
      inputCost: 0,
      outputCost: 0,
      ...(cost.cacheRead === undefined ? {} : { cacheCost: 0 }),
      priceCategory: "low",
    };
  }
  return {
    pricing: `In: $${formatPrice(cost.input)} · Out: $${formatPrice(cost.output)} /1M tokens`,
    inputCost: Math.round(cost.input * 100),
    outputCost: Math.round(cost.output * 100),
    ...(cost.cacheRead === undefined ? {} : { cacheCost: Math.round(cost.cacheRead * 100) }),
    priceCategory: costCategory(cost),
  };
}

export function costCategory(cost: Pick<ModelCost, "input" | "output">): ModelPricingFields["priceCategory"] {
  const weighted = cost.input * 3 + cost.output;
  if (weighted <= 2) return "low";
  if (weighted <= 25) return "medium";
  if (weighted <= 50) return "high";
  return "very_high";
}

function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}
