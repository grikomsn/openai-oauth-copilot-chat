import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResetCreditConsumePayload,
  mergeQuotaPayload,
  mergeResetCreditsPayload,
  parseResetCreditConsumePayload,
  recordRequestUsage,
  toProviderUsagePayload,
  usageSnapshotForPersistence,
} from "./domain";
import { formatUsageRows, formatUsageStatusBar } from "./presentation";

test("normalizes Responses API usage for Copilot inference reporting", () => {
  assert.deepEqual(toProviderUsagePayload({
    input_tokens: 120,
    output_tokens: 30,
    input_tokens_details: { cached_tokens: 40, cache_write_tokens: 80 },
    output_tokens_details: { reasoning_tokens: 12 },
  }), {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 80 },
    completion_tokens_details: { reasoning_tokens: 12 },
  });
});

test("tracks request tokens without discarding quota windows", () => {
  const snapshot = recordRequestUsage({ primary: { usedPercent: 20 } }, {
    input_tokens: 100,
    output_tokens: 25,
  }, "gpt-5.6-sol", 1_000);
  assert.equal(snapshot.primary?.usedPercent, 20);
  assert.deepEqual(snapshot.tracked, {
    requests: 1,
    promptTokens: 100,
    completionTokens: 25,
    totalTokens: 125,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  });
});

test("parses Codex primary and secondary subscription windows", () => {
  const snapshot = mergeQuotaPayload({}, {
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 18, limit_window_seconds: 18_000, reset_at: 2_000 },
      secondary_window: { used_percent: 42, limit_window_seconds: 604_800, reset_at: 3_000 },
    },
    credits: { has_credits: true, unlimited: false, balance: "12.50" },
  }, 1_500);
  assert.equal(snapshot.planType, "plus");
  assert.deepEqual(snapshot.primary, { usedPercent: 18, windowSeconds: 18_000, resetsAt: 2_000_000 });
  assert.deepEqual(snapshot.secondary, { usedPercent: 42, windowSeconds: 604_800, resetsAt: 3_000_000 });
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Codex 5h 18% · 7d 42%");
});

test("handles an account with no banked reset credits", () => {
  const snapshot = mergeResetCreditsPayload({}, { available_count: 0, credits: [] }, 2_000);
  assert.deepEqual(snapshot.resetCredits, { availableCount: 0, credits: [] });
  assert.equal(snapshot.resetCreditsError, undefined);
  assert.equal(formatUsageRows(snapshot).some((row) => row.kind === "reset"), false);
});

test("sorts reset credits by expiry and exposes only ephemeral redemption IDs", () => {
  const snapshot = mergeResetCreditsPayload({}, {
    available_count: 2,
    credits: [
      {
        id: "later-credit",
        title: "Full reset (Weekly + 5 hr)",
        status: "available",
        expires_at: "2026-08-30T00:00:00Z",
        granted_at: "2026-07-31T00:00:00Z",
      },
      {
        credit_id: "earlier-credit",
        reset_type: "codexRateLimits",
        status: "available",
        expires_at: "2026-08-15T00:00:00Z",
      },
    ] as unknown,
  }, 3_000);
  const rows = formatUsageRows(snapshot, Date.parse("2026-08-07T00:00:00Z"));
  assert.equal(rows[0].label, "Codex rate-limit reset");
  assert.equal(rows[0].action, "redeemReset");
  assert.equal(rows[0].actionId, "earlier-credit");
  assert.equal(rows[1].actionId, "later-credit");
  assert.equal(rows[0].description.includes("Expires"), true);

  const persisted = usageSnapshotForPersistence(snapshot);
  assert.equal(persisted.resetCredits?.credits?.[0].id, undefined);
  assert.equal(persisted.resetCredits?.credits?.[1].id, undefined);
});

test("only exposes available reset credits as redeemable", () => {
  const snapshot = mergeResetCreditsPayload({}, {
    available_count: 2,
    credits: [
      { id: "available-credit", status: "available" },
      { id: "redeemed-credit", status: "redeemed" },
    ],
  });
  const rows = formatUsageRows(snapshot);
  assert.equal(rows[0].actionId, "available-credit");
  assert.equal(rows[1].action, undefined);
  assert.equal(rows[1].actionId, undefined);
});

test("normalizes reset-credit consume outcomes and builds account-scoped requests", () => {
  assert.deepEqual(parseResetCreditConsumePayload({ code: "already_redeemed", windows_reset: 2 }), {
    outcome: "alreadyRedeemed",
    windowsReset: 2,
  });
  assert.deepEqual(buildResetCreditConsumePayload("credit-1", "request-1", "account-1"), {
    credit_id: "credit-1",
    redeem_request_id: "request-1",
    account_id: "account-1",
  });
  assert.deepEqual(buildResetCreditConsumePayload("credit-1", "request-2"), {
    credit_id: "credit-1",
    redeem_request_id: "request-2",
  });
});
