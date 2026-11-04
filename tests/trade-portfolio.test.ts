import { describe, expect, it } from "vitest";
import { closedStats, netPositions, shareEquivalent, type PortfolioRow } from "@/lib/trade-portfolio";
import { DAY_MS, parseTrades, type Trade, type TradeResult } from "@/lib/trades";

const NOW = Date.UTC(2026, 5, 1);
const res = (o: Partial<TradeResult>): TradeResult => ({ status: "open", entry: 100, exit: null, mark: 100, shares: 10, value: 1000, pl: 0, plPct: 0, days: 1, ...o });
const tr = (o: Partial<Trade>): Trade => ({ id: "a", side: "long", symbol: "AAPL", amount: 1000, startMs: NOW - DAY_MS, createdMs: NOW, ...o });

describe("netPositions", () => {
  it("nets long and short shares per stock", () => {
    const rows: PortfolioRow[] = [
      { trade: tr({}), result: res({ shares: 10 }), price: 100 },
      { trade: tr({ id: "b", side: "short" }), result: res({ shares: 50 }), price: 100 },
    ];
    const [p] = netPositions(rows, NOW);
    expect(p.shares).toBe(-40);
    expect(p.direction).toBe("bearish");
  });
  it("ignores finished trades", () => {
    expect(netPositions([{ trade: tr({}), result: res({ status: "closed" }), price: 100 }], NOW)).toEqual([]);
  });
  it("uses delta for options and flips sold ones", () => {
    const base = { trade: tr({ side: "call", expiryMs: NOW + 30 * DAY_MS }), price: 100 };
    const r = res({ shares: 100, strike: 100, sigma: 0.3, spot: 100 });
    const bought = shareEquivalent(base.trade, r, 100, NOW)!;
    expect(bought.shares).toBeGreaterThan(40);
    expect(bought.shares).toBeLessThan(70);
    const sold = shareEquivalent({ ...base.trade, sold: true }, r, 100, NOW)!;
    expect(sold.shares).toBeCloseTo(-bought.shares);
    const put = shareEquivalent({ ...base.trade, side: "put" }, r, 100, NOW)!;
    expect(put.shares).toBeLessThan(0);
  });
  it("falls back to intrinsic sign without sigma", () => {
    const e = shareEquivalent(tr({ side: "put", expiryMs: NOW + DAY_MS }), res({ shares: 100, strike: 110 }), 100, NOW)!;
    expect(e.shares).toBe(-100);
    expect(e.approx).toBe(true);
  });
});

describe("closedStats", () => {
  it("computes win rate, averages and strategy P/L", () => {
    const rows: PortfolioRow[] = [
      { trade: tr({}), result: res({ status: "target", pl: 100 }), price: 1 },
      { trade: tr({ id: "b" }), result: res({ status: "stop", pl: -50 }), price: 1 },
      { trade: tr({ id: "c", side: "short" }), result: res({ status: "closed", pl: 30 }), price: 1 },
      { trade: tr({ id: "d" }), result: res({ status: "open", pl: 999 }), price: 1 },
    ];
    const s = closedStats(rows);
    expect(s.count).toBe(3);
    expect(s.winRate).toBeCloseTo(66.67, 1);
    expect(s.avgWin).toBe(65);
    expect(s.avgLoss).toBe(-50);
    expect(s.byStrategy.find((b) => b.label === "Buy shares")?.pl).toBe(50);
  });
});

describe("journal fields", () => {
  const raw = { id: "x", symbol: "BHP", amount: 100, startMs: NOW };
  it("old trades parse without reason/review", () => {
    const [t] = parseTrades([raw]);
    expect(t.reason).toBeUndefined();
    expect(t.review).toBeUndefined();
  });
  it("keeps and sanitises reason and review", () => {
    const [t] = parseTrades([{ ...raw, reason: "  earnings  ", review: { verdict: "partly", note: " luck " } }]);
    expect(t.reason).toBe("earnings");
    expect(t.review).toEqual({ verdict: "partly", note: "luck" });
    expect(parseTrades([{ ...raw, review: { verdict: "maybe" } }])[0].review).toBeUndefined();
  });
});
