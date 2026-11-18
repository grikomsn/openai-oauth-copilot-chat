import type { ModelCost } from "../kit/pricing";

export type { ModelCost } from "../kit/pricing";

const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {
  "gpt-6-astra": { input: 10, cacheRead: 1, output: 50 },
  "gpt-6.1-sol": { input: 2, cacheRead: 0.1, output: 10 },
  "gpt-6-sol": { input: 2, cacheRead: 0.2, output: 10 },
  "gpt-6-luna": { input: 0.1, cacheRead: 0.01, output: 0.5 },
  "gpt-5.6-sol": { input: 4, cacheRead: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cacheRead: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cacheRead: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cacheRead: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cacheRead: 0.5, output: 30 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  "gpt-5.4": { input: 2.5, cacheRead: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cacheRead: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cacheRead: 0.02, output: 1.25 },
  "gpt-5.4-pro": { input: 30, output: 180 },
  "gpt-5.3-codex": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.3-codex-spark": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.2": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gpt-5.1": { input: 1.25, cacheRead: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cacheRead: 0.125, output: 10 },
};

export function openAIModelCost(id: string, discovered?: ModelCost): ModelCost | undefined {
  return discovered ?? OFFICIAL_MODEL_COSTS[id];
}

