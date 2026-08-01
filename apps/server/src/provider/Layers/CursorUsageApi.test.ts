import { describe, expect, it } from "vite-plus/test";

import { normalizeCursorUsage } from "./CursorUsageApi.ts";

describe("normalizeCursorUsage", () => {
  it("maps Cursor and API model budgets with the billing-cycle reset", () => {
    const snapshot = normalizeCursorUsage({
      billingCycleEnd: "1782821549000",
      planUsage: {
        autoSpend: 2500,
        autoLimit: 10000,
        apiSpend: 1200,
        apiLimit: 4000,
        autoPercentUsed: null,
        apiPercentUsed: null,
      },
    });

    expect(snapshot?.windows).toHaveLength(2);
    expect(snapshot?.windows[0]).toEqual({
      kind: "other",
      label: "Cursor models",
      usedPercent: 25,
      resetsAt: 1782821549,
      detail: "$25.00 / $100.00",
    });
    expect(snapshot?.windows[1]).toEqual({
      kind: "other",
      label: "API models",
      usedPercent: 30,
      resetsAt: 1782821549,
      detail: "$12.00 / $40.00",
    });
  });

  it("maps the on-demand spend limit when plan budgets are absent", () => {
    const snapshot = normalizeCursorUsage({
      billingCycleEnd: 1782821549000,
      spendLimitUsage: {
        individualUsed: 16927,
        individualLimit: 100000,
      },
    });

    expect(snapshot?.windows).toEqual([
      {
        kind: "spend",
        label: "On-demand spend",
        usedPercent: 16.927,
        resetsAt: 1782821549,
        detail: "$169.27 / $1,000.00",
      },
    ]);
  });

  it("uses total usage when the response does not split model budgets", () => {
    const snapshot = normalizeCursorUsage({
      planUsage: {
        totalSpend: 50,
        limit: 100,
        totalPercentUsed: 50,
      },
    });

    expect(snapshot?.windows).toEqual([
      {
        kind: "other",
        label: "Total usage",
        usedPercent: 50,
        detail: "$0.50 / $1.00",
      },
    ]);
  });

  it("returns null when Cursor reports no measurable usage", () => {
    expect(normalizeCursorUsage({})).toBeNull();
    expect(normalizeCursorUsage({ planUsage: { remaining: 100 } })).toBeNull();
  });
});
