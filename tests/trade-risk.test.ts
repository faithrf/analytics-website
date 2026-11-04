import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { breakeven, compareStrikes, eventsBeforeExpiry, exposure, gammaWarning, payoffCurve, pnlAt, probs, quoteQuality, scenarios, type RiskPos } from "@/lib/trade-risk";
import { bsPut, DAY_MS } from "@/lib/trades";

const T = 30 / 365;
const prem = bsPut(100, 95, T, 0.04, 0.3);
const soldPut: RiskPos = { call: false, sold: true, strike: 95, premium: prem, shares: 100, sigma: 0.3 };
const boughtCall: RiskPos = { call: true, sold: false, strike: 100, premium: 3, shares: 100, sigma: 0.3 };

describe("payoff", () => {
  it("sold put keeps premium above strike and loses below breakeven", () => {
    expect(pnlAt(soldPut, 120, 0)).toBeCloseTo(prem * 100, 6);
    expect(pnlAt(soldPut, breakeven(soldPut), 0)).toBeCloseTo(0, 6);
    expect(pnlAt(soldPut, 80, 0)).toBeLessThan(0);
  });
  it("bought call loses the premium at most", () => {
    expect(pnlAt(boughtCall, 50, 0)).toBeCloseTo(-300, 6);
    expect(breakeven(boughtCall)).toBe(103);
  });
  it("curve spans the range", () => {
    const c = payoffCurve(boughtCall, 80, 120, T, 10);
    expect(c).toHaveLength(11);
    expect(c[0].s).toBe(80);
    expect(c[10].s).toBeCloseTo(120);
  });
  it("stock short profits when price falls", () => {
    expect(pnlAt({ call: null, sold: true, strike: 100, premium: 0, shares: 10, sigma: 0.3 }, 90, 0)).toBe(100);
  });
});

describe("scenarios", () => {
  it("has seven rows with a zero move in the middle", () => {
    const s = scenarios(soldPut, 100, T);
    expect(s.map((x) => x.pct)).toEqual([-5, -2, -1, 0, 1, 2, 5]);
    expect(s[3].price).toBe(100);
    // a sold put gains from a day of decay when nothing moves
    expect(s[3].today).toBeGreaterThan(0);
  });
});

describe("probs", () => {
  it("any-profit chance exceeds keep-full-premium chance for a sold put", () => {
    const p = probs(soldPut, 100, T)!;
    expect(p.profit).toBeGreaterThan(p.otm);
    expect(p.otm).toBeGreaterThan(0.5);
  });
  it("bought call: profit chance is below the in-the-money chance", () => {
    const p = probs(boughtCall, 100, T)!;
    expect(p.profit).toBeLessThan(1 - p.otm);
  });
  it("null with no time left", () => {
    expect(probs(soldPut, 100, 0)).toBeNull();
  });
});

describe("exposure and gamma", () => {
  it("sold put is long shares, sold call short", () => {
    const e = exposure(soldPut, 100, T)!;
    expect(e.shares).toBeGreaterThan(0);
    expect(exposure({ ...soldPut, call: true }, 100, T)!.shares).toBeLessThan(0);
    expect(e.dollars).toBeCloseTo(e.shares * 100, 6);
  });
  it("warns near expiry at the money, not far out", () => {
    expect(gammaWarning(boughtCall, 100, 1 / 365)).toMatch(/small moves today/);
    expect(gammaWarning({ ...boughtCall, strike: 60 }, 100, 90 / 365)).toBeNull();
  });
});

describe("quote and events", () => {
  it("computes spread percent of mid", () => {
    const q = quoteQuality(0.9, 1.1);
    expect(q.mid).toBeCloseTo(1);
    expect(q.spreadPct).toBeCloseTo(0.2);
    expect(quoteQuality(0, 1).mid).toBeNull();
  });
  it("flags only dates before expiry", () => {
    const now = 1_000 * DAY_MS;
    const e = eventsBeforeExpiry(now, now + 10 * DAY_MS, now + 5 * DAY_MS, now + 20 * DAY_MS);
    expect(e.earnings).toBe(now + 5 * DAY_MS);
    expect(e.exDiv).toBeNull();
  });
});

describe("compareStrikes", () => {
  it("returns five strikes centred on the chosen one", () => {
    const rows = [90, 92.5, 95, 97.5, 100, 102.5, 105].map((strike) => ({ strike, mid: bsPut(100, strike, T, 0.04, 0.3), iv: null }));
    const out = compareStrikes(rows, { call: false, sold: true, spot: 100, t: T, k: 95, sigma: 0.3 });
    expect(out.map((r) => r.strike)).toEqual([90, 92.5, 95, 97.5, 100]);
    expect(out[0].otm!).toBeGreaterThan(out[4].otm!);
  });
});
