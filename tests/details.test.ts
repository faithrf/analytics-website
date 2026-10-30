import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { mapDetails } from "@/lib/yahoo";

describe("mapDetails", () => {
  it("maps a quoteSummary fixture", () => {
    const d = mapDetails({
      assetProfile: {
        longBusinessSummary: "Digs things up.",
        website: "https://example.com",
        fullTimeEmployees: 80000,
        city: "Melbourne",
        country: "Australia",
        sector: "Basic Materials",
        industry: "Other Industrial Metals & Mining",
      },
      summaryDetail: {
        forwardPE: 12.5,
        dividendRate: 1.5,
        dividendYield: 0.05,
        exDividendDate: new Date(1_700_000_000_000),
        fiveYearAvgDividendYield: 4.1,
      },
      defaultKeyStatistics: { pegRatio: 1.2, "52WeekChange": -0.1, netIncomeToCommon: 9e9 },
      financialData: {
        financialCurrency: "USD",
        debtToEquity: 50.47,
        numberOfAnalystOpinions: 16,
        targetMeanPrice: 45,
        recommendationKey: "hold",
      },
      calendarEvents: { earnings: { earningsDate: [new Date(1_800_000_000_000)], isEarningsDateEstimate: true } },
      recommendationTrend: { trend: [{ period: "0m", strongBuy: 2, buy: 3, hold: 8, sell: 2, strongSell: 1 }] },
    });
    expect(d.profile.website).toBe("https://example.com");
    expect(d.profile.employees).toBe(80000);
    expect(d.valuation.forwardPE).toBe(12.5);
    expect(d.valuation.change52w).toBe(-0.1);
    expect(d.dividends.exDate).toBe(1_700_000_000_000);
    expect(d.dividends.fiveYearAvgYield).toBe(4.1);
    expect(d.financialCurrency).toBe("USD");
    expect(d.financials.debtToEquity).toBe(50.47);
    expect(d.financials.netIncome).toBe(9e9);
    expect(d.analysts.count).toBe(16);
    expect(d.analysts.trend).toEqual({ strongBuy: 2, buy: 3, hold: 8, sell: 2, strongSell: 1 });
    expect(d.events).toEqual({ earningsDate: 1_800_000_000_000, earningsEstimate: true });
  });

  it("returns all nulls for an empty result and rejects non-http websites", () => {
    const d = mapDetails({});
    expect(d.profile.summary).toBeNull();
    expect(d.analysts.trend).toBeNull();
    expect(d.financials.revenue).toBeNull();
    expect(mapDetails({ assetProfile: { website: "javascript:alert(1)" } }).profile.website).toBeNull();
  });
});
