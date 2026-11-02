import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { greeks, hitRate, impliedMove, monthChange, moveStats, percentile, rangePosition, tradingDaysBetween, windowMoves } from "@/lib/trade-insights";
import { bsPut, DAY_MS } from "@/lib/trades";

describe("tradingDaysBetween", () => {
  it("scales calendar days by 5/7 with a floor of 1", () => {
    expect(tradingDaysBetween(0, 14 * DAY_MS)).toBe(10);
    expect(tradingDaysBetween(0, DAY_MS)).toBe(1);
    expect(tradingDaysBetween(0, 0)).toBe(1);
  });
});

describe("windowMoves / percentile / hitRate", () => {
  it("computes rolling n-bar moves", () => {
    expect(windowMoves([100, 110, 99], 1)).toEqual([0.1, -0.1].map((v, i) => (i === 0 ? 110 / 100 - 1 : 99 / 110 - 1)));
    expect(windowMoves([100, 110, 121], 2)).toHaveLength(1);
    expect(windowMoves([100], 1)).toEqual([]);
  });
  it("interpolates percentiles", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1);
  });
  it("counts hits in the needed direction", () => {
    const m = [-0.1, -0.02, 0.01, 0.05, 0.2];
    expect(hitRate(m, 0.05)).toBeCloseTo(0.4);
    expect(hitRate(m, -0.05)).toBeCloseTo(0.2);
    expect(hitRate([], 0.1)).toBeNull();
  });
});

describe("moveStats / trend", () => {
  const closes = Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i);
  it("needs enough windows", () => {
    expect(moveStats(closes.slice(0, 10), 5)).toBeNull();
    const s = moveStats(closes, 5);
    expect(s?.typical).toBeCloseTo(1.01 ** 5 - 1, 6);
    expect(s?.p10).toBeCloseTo(s?.p90 ?? 0, 6);
  });
  it("month change and range position", () => {
    expect(monthChange(closes)).toBeCloseTo(1.01 ** 21 - 1, 6);
    expect(monthChange([1, 2, 3])).toBeNull();
    expect(rangePosition(closes)).toBe(1);
    expect(rangePosition(closes.slice(0, 5))).toBeNull();
  });
});

describe("impliedMove / greeks", () => {
  it("scales iv by sqrt of the year fraction", () => {
    const m = impliedMove(100, 0.4, 365);
    expect(m.pct).toBeCloseTo(0.4);
    expect(m.dollars).toBeCloseTo(40);
  });
  it("matches Black-Scholes basics", () => {
    const put = greeks(false, 100, 100, 0.5, 0.04, 0.3);
    const call = greeks(true, 100, 100, 0.5, 0.04, 0.3);
    expect(put && put.delta).toBeLessThan(0);
    expect(put && call && call.delta - put.delta).toBeCloseTo(1, 6);
    expect(put && call && call.probItm + put.probItm).toBeCloseTo(1, 6);
    expect(put && put.thetaDay).toBeLessThan(0);
    // theta agrees with a one-day price difference
    const d = bsPut(100, 100, 0.5 - 1 / 365, 0.04, 0.3) - bsPut(100, 100, 0.5, 0.04, 0.3);
    expect(put && put.thetaDay).toBeCloseTo(d, 2);
  });
  it("returns null on bad inputs", () => {
    expect(greeks(true, 100, 100, 0, 0.04, 0.3)).toBeNull();
    expect(greeks(true, 100, 100, 1, 0.04, 0)).toBeNull();
  });
});
