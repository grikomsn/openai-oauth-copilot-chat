/** Pure usage view models and display formatting. */

import type { CodexUsageSnapshot, RateLimitResetCredit, RateLimitWindow, TokenUsage } from "./domain";

export interface UsageDisplayRow {
  kind: "quota" | "reset" | "tokens" | "tracked" | "credits" | "warning" | "empty";
  label: string;
  description: string;
  detail?: string;
  action?: "redeemReset";
  actionId?: string;
}

export function formatUsageStatusBar(snapshot: CodexUsageSnapshot): string {
  const windows = [snapshot.primary, snapshot.secondary].filter((value): value is RateLimitWindow => Boolean(value));
  if (windows.length) {
    const values = windows.map((window) => `${windowLabel(window)} ${formatPercent(window.usedPercent)}`);
    return `${snapshot.limitReached ? "$(warning)" : "$(pulse)"} Codex ${values.join(" · ")}`;
  }
  if (snapshot.lastRequest) return `$(symbol-numeric) Codex ${compactCount(snapshot.lastRequest.promptTokens)}→${compactCount(snapshot.lastRequest.completionTokens)}`;
  return snapshot.error ? "$(warning) Codex usage" : "$(pulse) Codex usage";
}

export function formatUsageTooltip(snapshot: CodexUsageSnapshot, now = Date.now()): string {
  const lines = [`Codex Bridge usage${snapshot.planType ? ` (${snapshot.planType})` : ""}`];
  if (snapshot.primary) lines.push(windowSummary(snapshot.primary, now));
  if (snapshot.secondary) lines.push(windowSummary(snapshot.secondary, now));
  if (snapshot.resetCredits?.availableCount) lines.push(`Reset credits: ${snapshot.resetCredits.availableCount}`);
  if (snapshot.lastRequest) lines.push(`Last request: ${requestSummary(snapshot.lastRequest)}`);
  if (snapshot.tracked) lines.push(`Tracked locally: ${snapshot.tracked.requests.toLocaleString()} requests · ${snapshot.tracked.totalTokens.toLocaleString()} tokens`);
  if (snapshot.credits?.balance) lines.push(`Credit balance: ${snapshot.credits.balance}`);
  if (snapshot.resetCreditsError) lines.push(`Reset-credit refresh: ${snapshot.resetCreditsError}`);
  if (snapshot.error) lines.push(`Refresh error: ${snapshot.error}`);
  if (snapshot.updatedAt) lines.push(`Updated ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: CodexUsageSnapshot, now = Date.now()): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.primary) rows.push(windowRow(snapshot.primary, now));
  if (snapshot.secondary) rows.push(windowRow(snapshot.secondary, now));
  for (const limit of snapshot.additional ?? []) if (limit.primary) rows.push({ ...windowRow(limit.primary, now), label: limit.name });
  if (snapshot.resetCredits?.availableCount) {
    const credits = [...(snapshot.resetCredits.credits ?? [])].sort((left, right) => (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY));
    for (const credit of credits) rows.push(resetCreditRow(credit, now));
    const undisclosedCount = snapshot.resetCredits.availableCount - credits.length;
    if (!credits.length || undisclosedCount > 0) rows.push({
      kind: "reset",
      label: `${snapshot.resetCredits.availableCount.toLocaleString()} reset credit${snapshot.resetCredits.availableCount === 1 ? "" : "s"} available`,
      description: credits.length ? `${undisclosedCount.toLocaleString()} credit detail${undisclosedCount === 1 ? "" : "s"} unavailable` : "Credit details unavailable",
      detail: "Refresh usage to try again",
    });
  }
  if (snapshot.lastRequest) rows.push({
    kind: "tokens", label: "Last inference", description: requestSummary(snapshot.lastRequest),
    detail: `${snapshot.lastRequest.modelId} · ${new Date(snapshot.lastRequest.recordedAt).toLocaleString()}`,
  });
  if (snapshot.tracked) rows.push({
    kind: "tracked", label: "Tracked on this device",
    description: `${snapshot.tracked.requests.toLocaleString()} requests · ${snapshot.tracked.totalTokens.toLocaleString()} tokens`,
    detail: `${snapshot.tracked.promptTokens.toLocaleString()} input · ${snapshot.tracked.completionTokens.toLocaleString()} output · ${snapshot.tracked.cachedTokens.toLocaleString()} cached · ${(snapshot.tracked.cacheWriteTokens ?? 0).toLocaleString()} cache write`,
  });
  if (snapshot.credits && (snapshot.credits.balance || snapshot.credits.unlimited)) rows.push({ kind: "credits", label: "Credits", description: snapshot.credits.unlimited ? "Unlimited" : snapshot.credits.balance ?? "Available" });
  if (snapshot.error) rows.push({ kind: "warning", label: "Usage refresh failed", description: snapshot.error });
  if (snapshot.resetCreditsError) rows.push({ kind: "warning", label: "Reset credits unavailable", description: snapshot.resetCreditsError });
  if (!rows.length) rows.push({ kind: "empty", label: "No usage observed yet", description: "Send a Codex request or refresh usage" });
  return rows;
}

function resetCreditRow(credit: RateLimitResetCredit, now: number): UsageDisplayRow {
  const description = credit.expiresAt ? `Expires ${formatDate(credit.expiresAt)} (${formatReset(credit.expiresAt, now)})` : "Expiry unavailable";
  const detail = [credit.description, credit.grantedAt ? `Granted ${formatDate(credit.grantedAt)}` : undefined, credit.status && credit.status !== "available" ? `Status: ${credit.status}` : undefined]
    .filter((value): value is string => Boolean(value)).join(" · ");
  return {
    kind: "reset", label: credit.title ?? resetCreditTypeLabel(credit.resetType), description,
    detail: detail || "Redeems both the 5-hour and weekly Codex windows",
    action: credit.id && credit.status === "available" ? "redeemReset" : undefined,
    actionId: credit.id && credit.status === "available" ? credit.id : undefined,
  };
}

function windowRow(window: RateLimitWindow, now: number): UsageDisplayRow {
  return { kind: "quota", label: `${windowLabel(window)} quota`, description: `${formatPercent(window.usedPercent)} used · ${formatPercent(100 - window.usedPercent)} remaining`, detail: window.resetsAt ? `Resets ${formatReset(window.resetsAt, now)}` : undefined };
}
function windowSummary(window: RateLimitWindow, now: number): string { return `${windowLabel(window)}: ${formatPercent(window.usedPercent)} used${window.resetsAt ? ` · resets ${formatReset(window.resetsAt, now)}` : ""}`; }
function requestSummary(usage: TokenUsage): string {
  const cache = [usage.cachedTokens === undefined ? undefined : `${exactCount(usage.cachedTokens)} cached`, usage.cacheWriteTokens === undefined ? undefined : `${exactCount(usage.cacheWriteTokens)} cache write`].filter((value): value is string => Boolean(value));
  return `${exactCount(usage.promptTokens)} input + ${exactCount(usage.completionTokens)} output = ${exactCount(usage.totalTokens)} tokens${cache.length ? ` · ${cache.join(" · ")}` : ""}`;
}
function windowLabel(window: RateLimitWindow): string {
  const seconds = window.windowSeconds;
  if (!seconds) return "quota";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.round(seconds / 60)}m`;
}
function formatPercent(value: number): string { return `${Math.max(0, Math.min(100, value)).toFixed(value % 1 ? 1 : 0)}%`; }
function formatReset(resetsAt: number, now: number): string {
  if (resetsAt <= now) return "now";
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `in ${hours}h${remainder ? ` ${remainder}m` : ""}`;
}
function formatDate(timestamp: number): string { return new Date(timestamp).toLocaleString(); }
function resetCreditTypeLabel(resetType: string | undefined): string {
  if (!resetType) return "Codex reset credit";
  if (resetType.toLowerCase().includes("codex")) return "Codex rate-limit reset";
  return `${resetType} reset`;
}
function compactCount(value: number | undefined): string {
  if (value === undefined) return "?";
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}
function exactCount(value: number | undefined): string { return value === undefined ? "?" : value.toLocaleString(); }
