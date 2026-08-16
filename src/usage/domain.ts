/** Usage payload normalization, local tracking, and persistence. */

/** Token counts reported by one Codex inference request. */
export interface TokenUsage {
  modelId: string;
  recordedAt: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/** Locally accumulated token totals for the current extension session. */
export interface TrackedTokenUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens?: number;
  reasoningTokens: number;
}

/** One ChatGPT quota window and its reset information. */
export interface RateLimitWindow {
  usedPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
}

/** A named quota family beyond the primary and secondary windows. */

/** One banked Codex rate-limit reset credit. */
export interface RateLimitResetCredit {
  id?: string;
  resetType?: string;
  status?: string;
  grantedAt?: number;
  expiresAt?: number;
  title?: string;
  description?: string;
}

/** Banked Codex reset credits returned by the account backend. */
export interface RateLimitResetCredits {
  availableCount: number;
  credits?: RateLimitResetCredit[];
}

export interface AdditionalRateLimit {
  id: string;
  name: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
}

/** Complete usage state shown by the extension. */
export interface CodexUsageSnapshot {
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  additional?: AdditionalRateLimit[];
  limitReached?: boolean;
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string };
  resetCredits?: RateLimitResetCredits;
  resetCreditsError?: string;
  lastRequest?: TokenUsage;
  tracked?: TrackedTokenUsage;
  error?: string;
  updatedAt?: number;
}

/** Compact token payload sent to VS Code's language-model provider API. */
export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

/**
 * Converts Responses API token usage into the compact payload VS Code consumes.
 * Cache read and write counts remain nested under prompt token details.
 *
 * @example
 * ```ts
 * const usage = toProviderUsagePayload({
 *   input_tokens: 100,
 *   output_tokens: 20,
 *   input_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 },
 * });
 * ```
 *
 * @see {@link recordRequestUsage}
 * @see {@link ProviderUsagePayload}
 */
export function toProviderUsagePayload(raw: Record<string, unknown>): ProviderUsagePayload | undefined {
  const usage = normalizeTokenUsage(raw);
  if (usage.promptTokens === undefined && usage.completionTokens === undefined && usage.totalTokens === undefined) return undefined;
  // Match the nested Responses API shape while omitting empty detail objects.
  const promptTokenDetails = compactObject({
    cached_tokens: usage.cachedTokens,
    cache_write_tokens: usage.cacheWriteTokens,
  });
  return compactObject({
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: Object.keys(promptTokenDetails).length ? promptTokenDetails : undefined,
    completion_tokens_details: usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
  });
}

/**
 * Records the latest request and accumulates local token counters.
 *
 * @example
 * ```ts
 * const snapshot = recordRequestUsage({}, { input_tokens: 100, output_tokens: 20 }, "gpt-5.6-sol");
 * console.log(snapshot.tracked?.totalTokens); // 120
 * ```
 *
 * @see {@link toProviderUsagePayload}
 * @see {@link formatUsageRows}
 */
export function recordRequestUsage(
  current: CodexUsageSnapshot,
  raw: Record<string, unknown>,
  modelId: string,
  recordedAt = Date.now(),
): CodexUsageSnapshot {
  const usage = normalizeTokenUsage(raw);
  const previous = current.tracked;
  // Preserve the latest request separately while making tracked counters additive across requests.
  return {
    ...current,
    lastRequest: { modelId, recordedAt, ...usage },
    tracked: {
      requests: (previous?.requests ?? 0) + 1,
      promptTokens: (previous?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
      completionTokens: (previous?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
      totalTokens: (previous?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      cachedTokens: (previous?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
      cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
      reasoningTokens: (previous?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    },
    updatedAt: recordedAt,
  };
}

export function mergeQuotaPayload(
  current: CodexUsageSnapshot,
  raw: unknown,
  updatedAt = Date.now(),
): CodexUsageSnapshot {
  const payload = asRecord(raw);
  if (!payload) return { ...current, error: "OpenAI returned an invalid usage response", updatedAt };
  const rateLimit = asRecord(payload.rate_limit);
  const credits = asRecord(payload.credits);
  const additional = Array.isArray(payload.additional_rate_limits)
    ? payload.additional_rate_limits.flatMap((entry) => {
        const item = asRecord(entry);
        const limits = asRecord(item?.rate_limit);
        if (!item || !limits) return [];
        return [{
          id: stringValue(item.metered_feature) ?? "additional",
          name: stringValue(item.limit_name) ?? stringValue(item.metered_feature) ?? "Additional limit",
          primary: parseWindow(limits.primary_window),
          secondary: parseWindow(limits.secondary_window),
        }];
      })
    : undefined;
  return compactObject({
    ...current,
    planType: stringValue(payload.plan_type) ?? current.planType,
    primary: parseWindow(rateLimit?.primary_window) ?? current.primary,
    secondary: parseWindow(rateLimit?.secondary_window) ?? current.secondary,
    additional: additional?.length ? additional : current.additional,
    limitReached: booleanValue(rateLimit?.limit_reached) ?? current.limitReached,
    credits: credits ? compactObject({
      hasCredits: booleanValue(credits.has_credits),
      unlimited: booleanValue(credits.unlimited),
      balance: stringValue(credits.balance),
    }) : current.credits,
    error: undefined,
    updatedAt,
  });
}

export function mergeResetCreditsPayload(
  current: CodexUsageSnapshot,
  raw: unknown,
  updatedAt = Date.now(),
): CodexUsageSnapshot {
  const payload = asRecord(raw);
  if (!payload) return { ...current, resetCreditsError: "OpenAI returned invalid reset-credit details", updatedAt };
  const nested = asRecord(payload.rate_limit_reset_credits) ?? asRecord(payload.rateLimitResetCredits);
  const source = nested ?? payload;
  const rawCredits = Array.isArray(source.credits) ? source.credits : undefined;
  const credits = rawCredits?.flatMap(parseResetCredit);
  const availableCount = numberValue(source.available_count ?? source.availableCount);
  if (availableCount === undefined && credits === undefined) {
    return { ...current, resetCreditsError: "OpenAI returned invalid reset-credit details", updatedAt };
  }
  return {
    ...current,
    resetCredits: compactObject({
      availableCount: availableCount ?? credits?.length ?? 0,
      credits,
    }),
    resetCreditsError: undefined,
    updatedAt,
  };
}

export function parseResetCreditConsumePayload(raw: unknown): { outcome: string; windowsReset?: number } {
  const payload = asRecord(raw);
  const rawOutcome = stringValue(payload?.outcome) ?? stringValue(payload?.code);
  if (!rawOutcome) throw new Error("OpenAI returned an invalid reset-credit response");
  return compactObject({
    outcome: normalizeResetCreditOutcome(rawOutcome),
    windowsReset: numberValue(payload?.windows_reset ?? payload?.windowsReset),
  });
}

export function buildResetCreditConsumePayload(
  creditId: string,
  redeemRequestId: string,
  accountId?: string,
): { credit_id: string; redeem_request_id: string; account_id?: string } {
  return compactObject({ credit_id: creditId, redeem_request_id: redeemRequestId, account_id: accountId });
}

/**
 * Removes opaque reset-credit IDs before a usage snapshot is persisted in VS Code global state.
 */
export function usageSnapshotForPersistence(snapshot: CodexUsageSnapshot): CodexUsageSnapshot {
  return {
    ...snapshot,
    resetCredits: snapshot.resetCredits ? {
      availableCount: snapshot.resetCredits.availableCount,
      credits: snapshot.resetCredits.credits?.map(({ id: _id, ...credit }) => credit),
    } : undefined,
  };
}

function normalizeTokenUsage(raw: Record<string, unknown>): Omit<TokenUsage, "modelId" | "recordedAt"> {
  // Responses API and compatibility payloads use different names for the same token detail objects.
  const inputDetails = asRecord(raw.input_tokens_details) ?? asRecord(raw.prompt_tokens_details);
  const outputDetails = asRecord(raw.output_tokens_details) ?? asRecord(raw.completion_tokens_details);
  const promptTokens = numberValue(raw.input_tokens ?? raw.prompt_tokens);
  const completionTokens = numberValue(raw.output_tokens ?? raw.completion_tokens);
  return compactObject({
    promptTokens,
    completionTokens,
    totalTokens: numberValue(raw.total_tokens) ?? (
      promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined
    ),
    cachedTokens: numberValue(inputDetails?.cached_tokens),
    cacheWriteTokens: numberValue(inputDetails?.cache_write_tokens),
    reasoningTokens: numberValue(outputDetails?.reasoning_tokens),
  });
}

function parseWindow(value: unknown): RateLimitWindow | undefined {
  const raw = asRecord(value);
  const usedPercent = numberValue(raw?.used_percent);
  if (!raw || usedPercent === undefined) return undefined;
  const resetAtSeconds = numberValue(raw.reset_at);
  return compactObject({
    usedPercent,
    windowSeconds: numberValue(raw.limit_window_seconds),
    resetsAt: resetAtSeconds === undefined ? undefined : resetAtSeconds * 1000,
  });
}

function parseResetCredit(value: unknown): RateLimitResetCredit[] {
  const raw = asRecord(value);
  if (!raw) return [];
  const credit = compactObject({
    id: stringValue(raw.id) ?? stringValue(raw.credit_id) ?? stringValue(raw.creditId),
    resetType: stringValue(raw.reset_type) ?? stringValue(raw.resetType),
    status: stringValue(raw.status),
    grantedAt: timestampValue(raw.granted_at ?? raw.grantedAt),
    expiresAt: timestampValue(raw.expires_at ?? raw.expiresAt),
    title: stringValue(raw.title) ?? stringValue(raw.name),
    description: stringValue(raw.description),
  });
  return Object.keys(credit).length ? [credit] : [];
}

function normalizeResetCreditOutcome(outcome: string): string {
  return ({
    already_redeemed: "alreadyRedeemed",
    nothing_to_reset: "nothingToReset",
    no_credit: "noCredit",
  } as Record<string, string>)[outcome] ?? outcome;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" || (typeof value === "string" && value.trim() && !Number.isNaN(Number(value)))) {
    const parsed = numberValue(value);
    if (parsed === undefined) return undefined;
    return parsed < 100_000_000_000 ? parsed * 1000 : parsed;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
