import { describe, expect, it } from "vitest";
import { detectEvents, liveSignals, median, runModel, simulateTrade, summarise, type EventRule, type MBar, type TradeSpec } from "@/lib/model";
import { bsPut, DAY_MS } from "@/lib/trades";

/** Flat price 100 for `n` bars with volume 1000, then per-index overrides. */
function series(n: number, over: Record<number, Partial<MBar>> = {}): MBar[] {
  return Array.from({ length: n }, (_, i) => {
    const base: MBar = { t: Date.UTC(2024, 0, 1) + i * DAY_MS, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 };
    return { ...base, ...over[i] };
  });
}

const rule = (o: Partial<EventRule> = {}): EventRule => ({ kind: "gap-up", minPct: 5, minGapDays: 1, ...o });
const spec = (o: Partial<TradeSpec> = {}): TradeSpec => ({ instrument: "long", entry: "close", holdDays: 3, otmPct: 0, dte: 30, ivBump: 1.3, ...o });

describe("detectEvents", () => {
  it("finds gap-up, gap-down, day-up, day-down", () => {
    const bars = series(40, { 25: { open: 106, close: 106 }, 26: { open: 106, close: 100 } });
    expect(detectEvents(bars, rule({ kind: "gap-up" })).map((e) => e.i)).toEqual([25]);
    expect(detectEvents(bars, rule({ kind: "day-up" })).map((e) => e.i)).toEqual([25]);
    expect(detectEvents(bars, rule({ kind: "gap-down" })).map((e) => e.i)).toEqual([]);
    expect(detectEvents(bars, rule({ kind: "day-down" })).map((e) => e.i)).toEqual([26]);
  });

  it("applies the volume filter, and skips it when there is no volume data", () => {
    const bars = series(40, { 25: { open: 106, close: 106, volume: 3000 }, 30: { open: 106, close: 106, volume: 1100 } });
    expect(detectEvents(bars, rule({ volMult: 2 })).map((e) => e.i)).toEqual([25]);
    const noVol = bars.map((b) => ({ ...b, volume: undefined }));
    expect(detectEvents(noVol, rule({ volMult: 2 })).map((e) => e.i)).toEqual([25, 30]);
  });

  it("thins clustered events with minGapDays", () => {
    const bars = series(40, { 25: { open: 106, close: 106 }, 27: { open: 114, close: 114 } });
    expect(detectEvents(bars, rule({ minGapDays: 1 })).map((e) => e.i)).toEqual([25, 27]);
    expect(detectEvents(bars, rule({ minGapDays: 5 })).map((e) => e.i)).toEqual([25]);
  });

  it("filters by fromMs", () => {
    const bars = series(40, { 25: { open: 106, close: 106 } });
    expect(detectEvents(bars, rule(), bars[30].t)).toEqual([]);
  });
});

describe("simulateTrade", () => {
  it("long and short at close, held N days", () => {
    const bars = series(30, { 10: { close: 110 }, 13: { close: 121 } });
    const l = simulateTrade(bars, 10, spec())!;
    expect(l.entry).toBe(110);
    expect(l.exit).toBe(121);
    expect(l.ret).toBeCloseTo(10);
    expect(simulateTrade(bars, 10, spec({ instrument: "short" }))!.ret).toBeCloseTo(-10);
  });

  it("enters at next-day open", () => {
    const bars = series(30, { 11: { open: 104 }, 14: { close: 109.2 } });
    const t = simulateTrade(bars, 10, spec({ entry: "next-open" }))!;
    expect(t.entryI).toBe(11);
    expect(t.entry).toBe(104);
    expect(t.ret).toBeCloseTo(5);
  });

  it("returns null when the hold runs past the data", () => {
    expect(simulateTrade(series(12), 10, spec())).toBeNull();
  });

  it("stop and target use daily high/low; stop wins a same-bar tie", () => {
    const bars = series(30, { 11: { low: 94, high: 100 }, 12: { high: 120 } });
    const stop = simulateTrade(bars, 10, spec({ stopPct: 5 }))!;
    expect(stop.reason).toBe("stop");
    expect(stop.exit).toBeCloseTo(95);
    expect(stop.ret).toBeCloseTo(-5);
    const tgt = simulateTrade(bars, 10, spec({ targetPct: 15 }))!;
    expect(tgt.reason).toBe("target");
    expect(tgt.exitI).toBe(12);
    const tie = series(30, { 11: { low: 94, high: 120 } });
    expect(simulateTrade(tie, 10, spec({ stopPct: 5, targetPct: 15 }))!.reason).toBe("stop");
  });

  it("short stop triggers on the high", () => {
    const bars = series(30, { 11: { high: 108 } });
    const t = simulateTrade(bars, 10, spec({ instrument: "short", stopPct: 5 }))!;
    expect(t.reason).toBe("stop");
    expect(t.ret).toBeCloseTo(-5);
  });

  it("prices a put with Black-Scholes and gains when the stock falls", () => {
    const bars = series(60, { 40: { close: 100 }, 43: { close: 85, high: 100, low: 85 } });
    const t = simulateTrade(bars, 40, spec({ instrument: "put", holdDays: 3 }))!;
    expect(t.strike).toBeCloseTo(100);
    expect(t.entry).toBeGreaterThan(0);
    expect(t.entry).toBeLessThan(100);
    expect(t.ret).toBeGreaterThan(0);
    // flat-vol series: premium equals BS at DEFAULT-ish sigma*bump, so it is a real positive number
    expect(t.entry).toBeCloseTo(bsPut(100, 100, 30 / 365, 0.04, t.sigma!), 6);
  });

  it("an option can lose at most its premium", () => {
    const bars = series(60, { 43: { close: 130 } });
    const t = simulateTrade(bars, 40, spec({ instrument: "put", holdDays: 3 }))!;
    expect(t.ret).toBeGreaterThanOrEqual(-100);
    expect(t.ret).toBeLessThan(0);
  });

  it("option stop closes early", () => {
    const bars = series(60, { 41: { close: 115 } });
    const t = simulateTrade(bars, 40, spec({ instrument: "put", holdDays: 5, stopPct: 50 }))!;
    expect(t.reason).toBe("stop");
    expect(t.exitI).toBe(41);
  });
});

describe("runModel", () => {
  const bars = series(80, { 30: { open: 108, close: 108 }, 31: { close: 100 }, 33: { close: 100 } });

  it("builds event rows, summary, curve and per-ticker rows", () => {
    const r = runModel({ AAA: bars }, rule(), spec({ instrument: "short" }));
    expect(r.events).toHaveLength(1);
    expect(r.events[0].move).toBeCloseTo(8);
    expect(r.events[0].ret).toBeCloseTo((1 - 100 / 108) * 100);
    expect(r.summary.count).toBe(1);
    expect(r.summary.winRate).toBe(100);
    expect(r.byTicker[0].ticker).toBe("AAA");
    expect(r.curve).toHaveLength(1);
    expect(r.curve[0].pl).toBeCloseTo(r.events[0].ret);
  });

  it("baseline excludes event days and edge = event avg - baseline avg", () => {
    const r = runModel({ AAA: bars }, rule(), spec({ instrument: "short" }));
    expect(r.baseline.count).toBeGreaterThan(30);
    expect(r.edge).toBeCloseTo(r.summary.avg - r.baseline.avg);
    expect(r.edge).toBeGreaterThan(0);
  });

  it("returns an empty, zero-edge result when nothing triggers", () => {
    const r = runModel({ AAA: series(50) }, rule(), spec());
    expect(r.events).toHaveLength(0);
    expect(r.edge).toBe(0);
  });
});

describe("summarise", () => {
  it("computes stats", () => {
    const s = summarise([10, -10, 20, 0]);
    expect(s.count).toBe(4);
    expect(s.winRate).toBe(50);
    expect(s.avg).toBe(5);
    expect(s.median).toBe(5);
    expect(s.best).toBe(20);
    expect(s.worst).toBe(-10);
    expect(s.compounded).toBeCloseTo((1.1 * 0.9 * 1.2 - 1) * 100);
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe("liveSignals", () => {
  it("lists tickers whose latest bar triggers", () => {
    const up = series(40, { 39: { open: 110, close: 110 } });
    const flat = series(40);
    const sig = liveSignals({ UP: up, FLAT: flat }, rule());
    expect(sig.map((s) => s.ticker)).toEqual(["UP"]);
    expect(sig[0].move).toBeCloseTo(10);
  });
});
