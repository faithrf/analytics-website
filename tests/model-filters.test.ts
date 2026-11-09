import { describe, expect, it } from "vitest";
import { computeFeatures, detectEvents, runModel, type EventRule, type MBar } from "@/lib/model";
import { DAY_MS } from "@/lib/trades";

function series(n: number, over: Record<number, Partial<MBar>> = {}, px: (i: number) => number = () => 100): MBar[] {
  return Array.from({ length: n }, (_, i) => {
    const p = px(i);
    return { t: Date.UTC(2020, 0, 1) + i * DAY_MS, open: p, high: p * 1.005, low: p * 0.995, close: p, volume: 1000, ...over[i] };
  });
}
const rule = (o: Partial<EventRule> = {}): EventRule => ({ kind: "day-up", minPct: 5, minGapDays: 1, ...o });
const ids = (bars: MBar[], r: EventRule, index?: MBar[]) => detectEvents(bars, r, -Infinity, { index }).map((e) => e.i);

describe("abnormal-move filter", () => {
  const stock = series(80, { 60: { close: 106 } });
  it("keeps a stock-specific move and drops a market-wide one", () => {
    const flat = series(80);
    const rally = series(80, { 60: { close: 106 } });
    expect(ids(stock, rule({ minAbnormalPct: 3 }), flat)).toEqual([60]);
    expect(ids(stock, rule({ minAbnormalPct: 3 }), rally)).toEqual([]);
    expect(ids(stock, rule({ maxAbnormalPct: 1.5 }), rally)).toEqual([60]);
  });
  it("needs index data", () => {
    expect(ids(stock, rule({ minAbnormalPct: 3 }))).toEqual([]);
    expect(computeFeatures(stock)[60].abn).toBeNull();
  });
  it("uses direction: a down event needs a negative abnormal move", () => {
    const down = series(80, { 60: { close: 94 } });
    expect(ids(down, rule({ kind: "day-down", minAbnormalPct: 3 }), series(80))).toEqual([60]);
  });
});

describe("run-up filter", () => {
  // price climbs 1%/bar before the event, so the 20 bars before it are up ~22%
  const rising = series(60, { 50: { close: 100 * 1.01 ** 50 * 1.07 } }, (i) => 100 * 1.01 ** i);
  const flat = series(60, { 50: { close: 107 } });
  it("selects by the 20-bar return before the event", () => {
    expect(ids(rising, rule({ minRunUpPct: 8 }))).toEqual([50]);
    expect(ids(flat, rule({ minRunUpPct: 8 }))).toEqual([]);
    expect(ids(flat, rule({ maxRunUpPct: 0 }))).toEqual([50]);
    expect(ids(rising, rule({ maxRunUpPct: 0 }))).toEqual([]);
  });
});

describe("regime filter", () => {
  const stock = series(260, { 250: { close: 108 } });
  const up = series(260, {}, (i) => 100 + i);
  const down = series(260, {}, (i) => 400 - i);
  it("bull = index above its 200-day average", () => {
    expect(ids(stock, rule({ regime: "bull" }), up)).toEqual([250]);
    expect(ids(stock, rule({ regime: "bull" }), down)).toEqual([]);
    expect(ids(stock, rule({ regime: "bear" }), down)).toEqual([250]);
  });
  it("is unknown (so excluded) before 200 index bars exist", () => {
    expect(ids(series(80, { 60: { close: 108 } }), rule({ regime: "bull" }), series(80, {}, (i) => 100 + i))).toEqual([]);
  });
});

describe("close vs open confirmation", () => {
  const faded = series(40, { 30: { open: 112, close: 106 } }); // gapped to 112, closed 106
  const held = series(40, { 30: { open: 104, close: 106 } });
  it("fade = closed back against the event, follow = closed with it", () => {
    expect(ids(faded, rule({ confirm: "fade" }))).toEqual([30]);
    expect(ids(faded, rule({ confirm: "follow" }))).toEqual([]);
    expect(ids(held, rule({ confirm: "follow" }))).toEqual([30]);
    expect(ids(held, rule({ confirm: "fade" }))).toEqual([]);
  });
});

describe("runModel with filters", () => {
  it("passes the index through and respects toMs", () => {
    const bars = series(80, { 40: { close: 107 }, 60: { close: 107 } });
    const r = runModel({ X: bars }, rule({ minAbnormalPct: 3 }), { instrument: "long", entry: "close", holdDays: 3, otmPct: 0, dte: 30, ivBump: 1 }, -Infinity, {
      indexFor: () => series(80),
      toMs: bars[50].t,
    });
    expect(r.events.map((e) => e.t)).toEqual([bars[40].t]);
    expect(r.events[0].abn).toBeGreaterThan(3);
    expect(r.stats.n).toBe(1);
  });
});
