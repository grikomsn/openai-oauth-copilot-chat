export interface TokenUsage {
  modelId: string;
  recordedAt: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface TrackedTokenUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowSeconds?: number;
  resetsAt?: number;
}

export interface AdditionalRateLimit {
  id: string;
  name: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
}

export interface CodexUsageSnapshot {
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  additional?: AdditionalRateLimit[];
  limitReached?: boolean;
  credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string };
  lastRequest?: TokenUsage;
  tracked?: TrackedTokenUsage;
  error?: string;
  updatedAt?: number;
}

export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

export interface UsageDisplayRow {
  kind: "quota" | "tokens" | "tracked" | "credits" | "warning" | "empty";
  label: string;
  description: string;
  detail?: string;
}

export function toProviderUsagePayload(raw: Record<string, unknown>): ProviderUsagePayload | undefined {
  const usage = normalizeTokenUsage(raw);
  if (usage.promptTokens === undefined && usage.completionTokens === undefined && usage.totalTokens === undefined) return undefined;
  return compactObject({
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: usage.cachedTokens === undefined ? undefined : { cached_tokens: usage.cachedTokens },
    completion_tokens_details: usage.reasoningTokens === undefined ? undefined : { reasoning_tokens: usage.reasoningTokens },
  });
}

export function recordRequestUsage(
  current: CodexUsageSnapshot,
  raw: Record<string, unknown>,
  modelId: string,
  recordedAt = Date.now(),
): CodexUsageSnapshot {
  const usage = normalizeTokenUsage(raw);
  const previous = current.tracked;
  return {
    ...current,
    lastRequest: { modelId, recordedAt, ...usage },
    tracked: {
      requests: (previous?.requests ?? 0) + 1,
      promptTokens: (previous?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
      completionTokens: (previous?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
      totalTokens: (previous?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      cachedTokens: (previous?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
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

export function formatUsageStatusBar(snapshot: CodexUsageSnapshot): string {
  const windows = [snapshot.primary, snapshot.secondary].filter((value): value is RateLimitWindow => Boolean(value));
  if (windows.length) {
    const values = windows.map((window) => `${windowLabel(window)} ${formatPercent(window.usedPercent)}`);
    return `${snapshot.limitReached ? "$(warning)" : "$(pulse)"} Codex ${values.join(" · ")}`;
  }
  if (snapshot.lastRequest) {
    return `$(symbol-numeric) Codex ${compactCount(snapshot.lastRequest.promptTokens)}→${compactCount(snapshot.lastRequest.completionTokens)}`;
  }
  return snapshot.error ? "$(warning) Codex usage" : "$(pulse) Codex usage";
}

export function formatUsageTooltip(snapshot: CodexUsageSnapshot, now = Date.now()): string {
  const lines = [`OpenAI Codex usage${snapshot.planType ? ` (${snapshot.planType})` : ""}`];
  if (snapshot.primary) lines.push(windowSummary(snapshot.primary, now));
  if (snapshot.secondary) lines.push(windowSummary(snapshot.secondary, now));
  if (snapshot.lastRequest) lines.push(`Last request: ${requestSummary(snapshot.lastRequest)}`);
  if (snapshot.tracked) lines.push(`Tracked locally: ${snapshot.tracked.requests.toLocaleString()} requests · ${snapshot.tracked.totalTokens.toLocaleString()} tokens`);
  if (snapshot.credits?.balance) lines.push(`Credit balance: ${snapshot.credits.balance}`);
  if (snapshot.error) lines.push(`Refresh error: ${snapshot.error}`);
  if (snapshot.updatedAt) lines.push(`Updated ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: CodexUsageSnapshot, now = Date.now()): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.primary) rows.push(windowRow(snapshot.primary, now));
  if (snapshot.secondary) rows.push(windowRow(snapshot.secondary, now));
  for (const limit of snapshot.additional ?? []) {
    if (limit.primary) rows.push({ ...windowRow(limit.primary, now), label: limit.name });
  }
  if (snapshot.lastRequest) rows.push({
    kind: "tokens",
    label: "Last inference",
    description: requestSummary(snapshot.lastRequest),
    detail: `${snapshot.lastRequest.modelId} · ${new Date(snapshot.lastRequest.recordedAt).toLocaleString()}`,
  });
  if (snapshot.tracked) rows.push({
    kind: "tracked",
    label: "Tracked on this device",
    description: `${snapshot.tracked.requests.toLocaleString()} requests · ${snapshot.tracked.totalTokens.toLocaleString()} tokens`,
    detail: `${snapshot.tracked.promptTokens.toLocaleString()} input · ${snapshot.tracked.completionTokens.toLocaleString()} output · ${snapshot.tracked.cachedTokens.toLocaleString()} cached`,
  });
  if (snapshot.credits && (snapshot.credits.balance || snapshot.credits.unlimited)) rows.push({
    kind: "credits",
    label: "Credits",
    description: snapshot.credits.unlimited ? "Unlimited" : snapshot.credits.balance ?? "Available",
  });
  if (snapshot.error) rows.push({ kind: "warning", label: "Usage refresh failed", description: snapshot.error });
  if (!rows.length) rows.push({ kind: "empty", label: "No usage observed yet", description: "Send a Codex request or refresh usage" });
  return rows;
}

function normalizeTokenUsage(raw: Record<string, unknown>): Omit<TokenUsage, "modelId" | "recordedAt"> {
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

function windowRow(window: RateLimitWindow, now: number): UsageDisplayRow {
  return {
    kind: "quota",
    label: `${windowLabel(window)} quota`,
    description: `${formatPercent(window.usedPercent)} used · ${formatPercent(100 - window.usedPercent)} remaining`,
    detail: window.resetsAt ? `Resets ${formatReset(window.resetsAt, now)}` : undefined,
  };
}

function windowSummary(window: RateLimitWindow, now: number): string {
  return `${windowLabel(window)}: ${formatPercent(window.usedPercent)} used${window.resetsAt ? ` · resets ${formatReset(window.resetsAt, now)}` : ""}`;
}

function requestSummary(usage: TokenUsage): string {
  return `${exactCount(usage.promptTokens)} input + ${exactCount(usage.completionTokens)} output = ${exactCount(usage.totalTokens)} tokens`;
}

function windowLabel(window: RateLimitWindow): string {
  const seconds = window.windowSeconds;
  if (!seconds) return "quota";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.round(seconds / 60)}m`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(value % 1 ? 1 : 0)}%`;
}

function formatReset(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "now";
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `in ${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

function compactCount(value: number | undefined): string {
  if (value === undefined) return "?";
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function exactCount(value: number | undefined): string {
  return value === undefined ? "?" : value.toLocaleString();
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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
