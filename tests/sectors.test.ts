import { describe, expect, it } from "vitest";
import { computeFeatures, detectEvents, runModel, type EventRule, type MBar } from "@/lib/model";
import { indexSymbolFor, SECTORS, tickerSector } from "@/lib/sectors";
import { isCryptoId, isNonEquityId, isValidId, toYahoo } from "@/lib/symbols";
import { DAY_MS } from "@/lib/trades";

describe("sectors", () => {
  it("has the requested sectors with valid, unique-per-sector ids", () => {
    const labels = SECTORS.map((s) => s.id);
    for (const id of ["finance", "tech", "healthcare", "energy", "consumer", "industrials", "crypto", "cryptostocks"])
      expect(labels).toContain(id);
    for (const s of SECTORS) {
      expect(new Set(s.ids).size).toBe(s.ids.length);
      for (const id of s.ids) expect(isValidId(id)).toBe(true);
    }
    expect(SECTORS.find((s) => s.id === "finance")!.ids.length).toBeGreaterThanOrEqual(20);
  });
  it("looks up a ticker's sector", () => {
    expect(tickerSector("JPM.US")).toBe("finance");
    expect(tickerSector("JPM")).toBe("finance");
    expect(tickerSector("XOM.US")).toBe("energy");
    expect(tickerSector("BTC-USD")).toBe("crypto");
    expect(tickerSector("COIN.US")).toBe("cryptostocks");
    expect(tickerSector("ZZZZ.US")).toBeNull();
  });
});

describe("crypto ids", () => {
  it("are recognised and passed to Yahoo unchanged", () => {
    expect(isCryptoId("ETH-USD")).toBe(true);
    expect(isCryptoId("AAPL.US")).toBe(false);
    expect(isNonEquityId("BTC-USD")).toBe(true);
    expect(toYahoo("BTC-USD")).toBe("BTC-USD");
  });
  it("use BTC-USD as the index, never the ASX 200", () => {
    expect(indexSymbolFor("ETH-USD")).toBe("BTC-USD");
    expect(indexSymbolFor("BTC-USD")).toBeNull();
    expect(indexSymbolFor("AAPL.US")).toBe("^GSPC");
    expect(indexSymbolFor("BHP")).toBe("^AXJO");
  });
});

describe("crypto in the model", () => {
  const bars = (n: number): MBar[] =>
    Array.from({ length: n }, (_, i) => {
      // seven-day weeks, volume spikes every 63 bars so the earnings proxy would fire
      const p = i === 130 ? 106 : 100;
      return { t: Date.UTC(2024, 0, 1) + i * DAY_MS, open: i === 130 ? 106 : 100, high: 107, low: 99, close: p, volume: i % 63 === 0 || i === 130 ? 5000 : 1000 };
    });
  const rule = (o: Partial<EventRule> = {}): EventRule => ({ kind: "day-up", minPct: 5, minGapDays: 1, ...o });
  it("switches the earnings proxy off, so earn rules never fire", () => {
    const b = bars(200);
    expect(computeFeatures(b).some((f) => f.earn)).toBe(true);
    expect(computeFeatures(b, undefined, true).some((f) => f.earn)).toBe(false);
    expect(detectEvents(b, rule({ kind: "earn-up" })).length).toBeGreaterThan(0);
    const spec = { instrument: "long" as const, entry: "close" as const, holdDays: 3, otmPct: 5, dte: 30, ivBump: 1 };
    expect(runModel({ "ETH-USD": b }, rule({ kind: "earn-up" }), spec).summary.count).toBe(0);
    expect(runModel({ "ETH-USD": b }, rule(), spec).summary.count).toBe(1);
  });
  it("does not crash beta filters with BTC as the index, or without one", () => {
    const b = bars(200);
    const spec = { instrument: "long" as const, entry: "close" as const, holdDays: 3, otmPct: 5, dte: 30, ivBump: 1 };
    const r = rule({ minAbnormalPct: 2, regime: "bull" });
    expect(() => runModel({ "ETH-USD": b }, r, spec, -Infinity, { indexFor: () => b })).not.toThrow();
    expect(runModel({ "ETH-USD": b }, r, spec).summary.count).toBe(0);
  });
});
