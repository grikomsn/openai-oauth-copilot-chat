import assert from "node:assert/strict";
import test from "node:test";
import { formatUsageRows, formatUsageStatusBar, formatUsageTooltip } from "./presentation";

test("formats quota usage through the presentation boundary", () => {
  const now = Date.UTC(2026, 7, 16, 0, 0, 0);
  const snapshot = {
    planType: "pro",
    primary: { usedPercent: 25, windowSeconds: 18_000, resetsAt: now + 3_600_000 },
  };
  assert.equal(formatUsageStatusBar(snapshot), "$(pulse) Codex 5h 25%");
  assert.match(formatUsageTooltip(snapshot, now), /5h: 25% used · resets in 1h/);
  assert.deepEqual(formatUsageRows(snapshot, now)[0], {
    kind: "quota",
    label: "5h quota",
    description: "25% used · 75% remaining",
    detail: "Resets in 1h",
  });
});

test("exposes only available reset credits as actions", () => {
  const rows = formatUsageRows({
    resetCredits: {
      availableCount: 2,
      credits: [
        { id: "available", status: "available", title: "Available" },
        { id: "used", status: "redeemed", title: "Redeemed" },
      ],
    },
  }, 0);
  assert.equal(rows[0]?.action, "redeemReset");
  assert.equal(rows[0]?.actionId, "available");
  assert.equal(rows[1]?.action, undefined);
});
