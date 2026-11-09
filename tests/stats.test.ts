import { describe, expect, it } from "vitest";
import { accuracy, benjaminiHochberg, bootstrapP, maxDrawdown, profitFactor, tStat, wilson } from "@/lib/stats";

describe("stats", () => {
  it("wilson interval brackets the rate and tightens with n", () => {
    const a = wilson(6, 10);
    const b = wilson(600, 1000);
    expect(a.lo).toBeLessThan(0.6);
    expect(a.hi).toBeGreaterThan(0.6);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0 });
    expect(wilson(10, 10).hi).toBe(1);
  });
  it("t-stat of a constant-shifted sample", () => {
    expect(tStat([1, 2, 3, 4, 5], 3)).toBeCloseTo(0);
    expect(tStat([1, 1, 1], 0)).toBe(0);
    expect(tStat([2, 3, 4, 3, 2, 4], 0)).toBeGreaterThan(5);
  });
  it("bootstrap p is small for a clear edge, large for noise, and repeatable", () => {
    const edge = Array.from({ length: 60 }, (_, i) => 2 + (i % 5) - 2);
    expect(bootstrapP(edge, 0)).toBeLessThan(0.01);
    const noise = Array.from({ length: 60 }, (_, i) => (i % 2 ? 3 : -3));
    expect(bootstrapP(noise, 0)).toBeGreaterThan(0.5);
    expect(bootstrapP(edge, 0)).toBe(bootstrapP(edge, 0));
  });
  it("Benjamini-Hochberg", () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeCloseTo(0.04);
    expect(q[1]).toBeCloseTo(0.0533, 3);
    expect(q[2]).toBeCloseTo(0.0533, 3);
    expect(q[3]).toBeCloseTo(0.5);
    expect(benjaminiHochberg([])).toEqual([]);
  });
  it("profit factor and drawdown", () => {
    expect(profitFactor([10, -5, 5, -5])).toBeCloseTo(1.5);
    expect(profitFactor([1, 2])).toBe(Infinity);
    expect(profitFactor([])).toBe(0);
    expect(maxDrawdown([5, -3, -4, 10, -2])).toBe(7);
    expect(maxDrawdown([1, 2])).toBe(0);
  });
  it("accuracy summary", () => {
    const a = accuracy([5, -2, 3, 4, -1, 6], 0);
    expect(a.n).toBe(6);
    expect(a.hit).toBeCloseTo(66.67, 1);
    expect(a.mean).toBeCloseTo(2.5);
    expect(a.median).toBeCloseTo(3.5);
    expect(accuracy([], 0).n).toBe(0);
  });
});
