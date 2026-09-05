import { describe, expect, it } from "vite-plus/test";

import { normalizeCursorUsage } from "./CursorUsageApi.ts";

const CHECKED_AT = "2026-06-30T00:00:00.000Z";
const BILLING_PERIOD_MINS = 30 * 24 * 60;

describe("normalizeCursorUsage", () => {
  it("maps Cursor and API model budgets with the billing-cycle reset", () => {
    const limits = normalizeCursorUsage(
      {
        billingCycleEnd: "1782821549000",
        planUsage: {
          autoSpend: 2500,
          autoLimit: 10000,
          apiSpend: 1200,
          apiLimit: 4000,
          autoPercentUsed: null,
          apiPercentUsed: null,
        },
      },
      CHECKED_AT,
    );

    expect(limits?.checkedAt).toBe(CHECKED_AT);
    expect(limits?.windows).toEqual([
      {
        id: "api_models",
        kind: "monthly",
        label: "API models",
        windowDurationMins: BILLING_PERIOD_MINS,
        usedPercent: 30,
        resetsAt: "2026-06-30T12:12:29.000Z",
        detail: "$12.00 / $40.00",
      },
      {
        id: "cursor_models",
        kind: "monthly",
        label: "Cursor models",
        windowDurationMins: BILLING_PERIOD_MINS,
        usedPercent: 25,
        resetsAt: "2026-06-30T12:12:29.000Z",
        detail: "$25.00 / $100.00",
      },
    ]);
  });

  it("maps the on-demand spend limit when plan budgets are absent", () => {
    const limits = normalizeCursorUsage(
      {
        billingCycleEnd: 1782821549000,
        spendLimitUsage: { individualUsed: 16927, individualLimit: 100000 },
      },
      CHECKED_AT,
    );

    expect(limits?.windows).toEqual([
      {
        id: "spend_limit",
        kind: "monthly",
        label: "On-demand spend",
        windowDurationMins: BILLING_PERIOD_MINS,
        usedPercent: 16.927,
        resetsAt: "2026-06-30T12:12:29.000Z",
        detail: "$169.27 / $1,000.00",
      },
    ]);
  });

  it("uses total usage when the response does not split model budgets", () => {
    const limits = normalizeCursorUsage(
      { planUsage: { totalSpend: 50, limit: 100, totalPercentUsed: 50 } },
      CHECKED_AT,
    );

    expect(limits?.windows).toEqual([
      {
        id: "total_usage",
        kind: "monthly",
        label: "Total usage",
        windowDurationMins: BILLING_PERIOD_MINS,
        usedPercent: 50,
        detail: "$0.50 / $1.00",
      },
    ]);
  });

  it("returns null when Cursor reports no measurable usage", () => {
    expect(normalizeCursorUsage({}, CHECKED_AT)).toBeNull();
    expect(normalizeCursorUsage({ planUsage: { remaining: 100 } }, CHECKED_AT)).toBeNull();
  });
});
