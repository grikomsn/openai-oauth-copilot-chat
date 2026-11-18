import type { ModelCost } from "./pricing";

import { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS, RemoteSnapshot, type SnapshotStore } from "../kit/remote-snapshot";

export { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS };
export const MODELS_DEV_CACHE_KEY = "openaiCodex.modelsDevMetadata.v1";

export interface ModelsDevModelMetadata {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly family?: string;
  readonly contextLength?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean;
  readonly reasoning?: boolean;
  readonly reasoningOptions?: readonly string[];
  readonly releaseDate?: string;
  readonly lastUpdated?: string;
  readonly cost?: ModelCost;
}

export interface ModelsDevSnapshot {
  readonly fetchedAt: number;
  readonly models: Readonly<Record<string, ModelsDevModelMetadata>>;
}

export type MetadataCache = SnapshotStore;

export function normalizeModelsDevSnapshot(payload: unknown, fetchedAt: number): ModelsDevSnapshot {
  const provider = asRecord(asRecord(payload)?.openai);
  const rawModels = asRecord(provider?.models);
  if (!rawModels) throw new Error("Models.dev returned no OpenAI model catalog");
  const models = Object.fromEntries(Object.entries(rawModels).flatMap(([key, value]) => {
    const model = normalizeModel(key, value);
    return model ? [[model.id, model]] : [];
  }));
  if (!Object.keys(models).length) throw new Error("Models.dev returned no usable OpenAI models");
  return { fetchedAt, models };
}

export function parseCachedModelsDevSnapshot(value: unknown): ModelsDevSnapshot | undefined {
  const snapshot = asRecord(value);
  const rawModels = asRecord(snapshot?.models);
  if (!snapshot || !validTimestamp(snapshot.fetchedAt) || !rawModels) return undefined;
  const models: Record<string, ModelsDevModelMetadata> = {};
  for (const [key, raw] of Object.entries(rawModels)) {
    const model = parseCachedModel(key, raw);
    if (!model) return undefined;
    models[model.id] = model;
  }
  return { fetchedAt: snapshot.fetchedAt, models };
}

/** models.dev enrichment with the kit's persisted stale-while-revalidate lifecycle. */
export class ModelsDevMetadata extends RemoteSnapshot<ModelsDevSnapshot> {
  constructor(cache: MetadataCache, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now()) {
    super({
      cacheKey: MODELS_DEV_CACHE_KEY,
      store: cache,
      fetch: fetchImpl,
      now,
      normalize: normalizeModelsDevSnapshot,
      parseCached: parseCachedModelsDevSnapshot,
      empty: () => ({ fetchedAt: 0, models: {} }),
    });
  }

  getModel(id: string): ModelsDevModelMetadata | undefined {
    return this.current?.models[id];
  }
}

function normalizeModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = stringValue(raw.id) ?? key.trim();
  if (!id) return undefined;
  const modalities = asRecord(raw.modalities);
  const limit = asRecord(raw.limit);
  const cost = normalizeCost(asRecord(raw.cost));
  return {
    id,
    name: optionalString(raw.name),
    description: optionalString(raw.description),
    family: optionalString(raw.family),
    contextLength: optionalTokenCount(limit?.context),
    maxInputTokens: optionalTokenCount(limit?.input),
    maxOutputTokens: optionalTokenCount(limit?.output),
    imageInput: stringArray(modalities?.input).includes("image"),
    toolCalling: optionalBoolean(raw.tool_call),
    reasoning: optionalBoolean(raw.reasoning),
    reasoningOptions: normalizeReasoningOptions(raw.reasoning_options),
    releaseDate: optionalString(raw.release_date),
    lastUpdated: optionalString(raw.last_updated),
    ...(cost ? { cost } : {}),
  };
}

function parseCachedModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = stringValue(raw.id) ?? key.trim();
  if (!id || !validOptionalNumber(raw.contextLength) || !validOptionalNumber(raw.maxInputTokens) || !validOptionalNumber(raw.maxOutputTokens)) return undefined;
  if (!validOptionalBoolean(raw.imageInput) || !validOptionalBoolean(raw.toolCalling) || !validOptionalBoolean(raw.reasoning)) return undefined;
  if (raw.reasoningOptions !== undefined && !isStringArray(raw.reasoningOptions)) return undefined;
  const cost = parseCost(raw.cost);
  return {
    id,
    name: optionalString(raw.name),
    description: optionalString(raw.description),
    family: optionalString(raw.family),
    contextLength: optionalTokenCount(raw.contextLength),
    maxInputTokens: optionalTokenCount(raw.maxInputTokens),
    maxOutputTokens: optionalTokenCount(raw.maxOutputTokens),
    imageInput: optionalBoolean(raw.imageInput),
    toolCalling: optionalBoolean(raw.toolCalling),
    reasoning: optionalBoolean(raw.reasoning),
    reasoningOptions: raw.reasoningOptions === undefined ? undefined : stringArray(raw.reasoningOptions),
    releaseDate: optionalString(raw.releaseDate),
    lastUpdated: optionalString(raw.lastUpdated),
    ...(cost ? { cost } : {}),
  };
}

function normalizeCost(raw: Record<string, unknown> | undefined): ModelCost | undefined {
  const input = optionalNonNegativeNumber(raw?.input);
  const output = optionalNonNegativeNumber(raw?.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = optionalNonNegativeNumber(raw?.cache_read);
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) };
}

function parseCost(value: unknown): ModelCost | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const input = optionalNonNegativeNumber(raw.input);
  const output = optionalNonNegativeNumber(raw.output);
  const cacheRead = optionalNonNegativeNumber(raw.cacheRead);
  if (input === undefined || output === undefined) return undefined;
  return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }) };
}

function normalizeReasoningOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = [...new Set(value.flatMap((entry) => {
    const option = asRecord(entry);
    if (option?.type === "toggle") return ["toggle"];
    return option?.type === "effort" ? stringArray(option.values) : [];
  }))];
  return options.length ? options : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : stringValue(value); }
function optionalBoolean(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function optionalTokenCount(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined; }
function optionalNonNegativeNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function validTimestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validOptionalNumber(value: unknown): boolean { return value === undefined || optionalTokenCount(value) !== undefined; }
function validOptionalBoolean(value: unknown): boolean { return value === undefined || typeof value === "boolean"; }
