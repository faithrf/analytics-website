import { describe, expect, it } from "vitest";
import {
  detectEvents,
  earningsFlags,
  simulateTrade,
  type EventRule,
  type MBar,
  type TradeSpec,
} from "@/lib/model";
import { STRATEGY_RULES, STRATEGY_STUDY } from "@/lib/strategy-rules";
import { DAY_MS } from "@/lib/trades";
import {
  clusterT,
  makeCells,
  summarise,
  trainScore,
  type Tr,
} from "../scripts/strategy-study";

const T0 = Date.UTC(2025, 0, 2);

/** Daily bars from a close series; open = prior close, 1% range, volume 1M unless overridden. */
function bars(closes: number[], vol: (i: number) => number = () => 1e6): MBar[] {
  return closes.map((c, i) => ({
    t: T0 + i * DAY_MS,
    open: i ? closes[i - 1] : c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: vol(i),
  }));
}
/** Slightly noisy flat series so historical vol is defined. */
const flat = (n: number) => Array.from({ length: n }, (_, i) => 100 + (i % 2 ? 0.5 : 0));

const sold = (instrument: "covered-call" | "cash-put", over: Partial<TradeSpec> = {}): TradeSpec => ({
  instrument,
  entry: "close",
  holdDays: 21,
  otmPct: 5,
  dte: 30,
  ivBump: 1,
  ...over,
});

describe("earnings proxy", () => {
  const closes = flat(200);
  closes[163] = 106; // gap up on bar 163
  for (let i = 164; i < 200; i++) closes[i] = 106;
  const gapBars = bars(closes, (i) => (i === 100 || i === 163 ? 3e6 : 1e6));
  gapBars[163].open = 106; // the reaction is a gap

  it("flags a bar when a volume spike came about one quarter earlier", () => {
    const fl = earningsFlags(gapBars);
    expect(fl[163]).toBe(true);
    expect(fl[150]).toBe(false);
  });
  const rule: EventRule = { kind: "earn-up", minPct: 5, volMult: 2, minGapDays: 21 };
  it("finds the reaction as an earn-up event", () => {
    expect(detectEvents(gapBars, rule).map((e) => e.i)).toEqual([163]);
  });
  it("respects the size bucket and the cadence requirement", () => {
    expect(detectEvents(gapBars, { ...rule, maxPct: 5 })).toHaveLength(0);
    const noCadence = bars(closes, (i) => (i === 163 ? 3e6 : 1e6));
    noCadence[163].open = 106;
    expect(detectEvents(noCadence, rule)).toHaveLength(0);
  });
  it("does not fire earn-down on an up gap", () => {
    expect(detectEvents(gapBars, { ...rule, kind: "earn-down" })).toHaveLength(0);
  });
});

describe("sold options held to expiry", () => {
  const base = flat(120);
  const path = (after: number) => base.map((c, i) => (i > 50 ? after : c));

  it("covered call, stock flat: keeps the premium, no assignment", () => {
    const o = simulateTrade(bars(path(100)), 50, sold("covered-call"));
    expect(o).not.toBeNull();
    expect(o!.assigned).toBe(false);
    expect(o!.premiumPct!).toBeGreaterThan(0);
    expect(o!.ret).toBeCloseTo(o!.premiumPct!, 6);
  });
  it("covered call, big rally: upside capped at the strike", () => {
    const o = simulateTrade(bars(path(130)), 50, sold("covered-call"))!;
    expect(o.assigned).toBe(true);
    expect(o.ret).toBeLessThan(o.stockRet!);
    expect(o.ret).toBeCloseTo(5 + o.premiumPct!, 0);
  });
  it("cash put, big drop: assigned and loses more than the premium", () => {
    const o = simulateTrade(bars(path(80)), 50, sold("cash-put"))!;
    expect(o.assigned).toBe(true);
    expect(o.ret).toBeLessThan(-10);
  });
  it("costs and the spread haircut lower the return", () => {
    const b = bars(path(100));
    const gross = simulateTrade(b, 50, sold("covered-call"))!;
    const net = simulateTrade(b, 50, sold("covered-call", { costBps: 10, optHaircut: 0.1 }))!;
    expect(gross.ret - net.ret).toBeCloseTo(0.1 + 0.1 * gross.premiumPct!, 1);
  });
  it("returns null when the data ends before expiry", () => {
    expect(simulateTrade(bars(flat(70)), 50, sold("cash-put"))).toBeNull();
  });
  it("stock cost is charged on long and short", () => {
    const b = bars(flat(120));
    const spec: TradeSpec = { instrument: "long", entry: "next-open", holdDays: 5, otmPct: 0, dte: 30, ivBump: 1 };
    const a = simulateTrade(b, 50, spec)!;
    const c = simulateTrade(b, 50, { ...spec, costBps: 10 })!;
    expect(a.ret - c.ret).toBeCloseTo(0.1, 6);
  });
});

describe("study statistics", () => {
  const tr = (month: string, edge: number, ret = edge): Tr => ({ cell: 0, k: 0, t: 0, exitT: 0, ret, edge, month });

  it("clusters by month: many trades in one month count once", () => {
    const trs = [
      ...Array.from({ length: 50 }, () => tr("2025-01", 5)),
      tr("2025-02", -1),
      tr("2025-03", -1),
      tr("2025-04", -1),
    ];
    const pooled = summarise(trs).tPooled;
    const c = clusterT(trs);
    expect(c.k).toBe(4);
    expect(pooled).toBeGreaterThan(c.t);
  });
  it("disqualifies thin or negative training cells", () => {
    expect(trainScore([tr("2025-01", 1)])).toBe(-Infinity);
    const neg = Array.from({ length: 40 }, (_, i) => tr(`2025-${String((i % 12) + 1).padStart(2, "0")}`, -1));
    expect(trainScore(neg)).toBe(-Infinity);
    const pos = Array.from({ length: 40 }, (_, i) => tr(`2025-${String((i % 12) + 1).padStart(2, "0")}`, 1 + (i % 3)));
    expect(trainScore(pos)).toBeGreaterThan(0);
  });
  it("counts the grid: 50 earnings cells and 144 option cells", () => {
    const cells = makeCells();
    expect(cells.filter((c) => c.group.startsWith("earn"))).toHaveLength(50);
    expect(cells.filter((c) => !c.group.startsWith("earn"))).toHaveLength(144);
    expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
  });
});

describe("strategy rule cards", () => {
  it("has a setting, a verdict and a reason for every rule", () => {
    for (const fam of Object.values(STRATEGY_RULES)) {
      expect(fam.length).toBeGreaterThan(4);
      for (const r of fam) {
        expect(r.rule && r.setting && r.why).toBeTruthy();
        expect(["matters", "small", "none", "hurts"]).toContain(r.verdict);
      }
    }
  });
  it("records the holdout and verdict honestly", () => {
    for (const s of Object.values(STRATEGY_STUDY)) {
      expect(["confirmed", "unproven", "dead"]).toContain(s.verdict);
      expect(s.cellsTried).toBeGreaterThan(40);
      if (s.holdout.n > 1) {
        expect(s.holdout.hitLo).toBeLessThanOrEqual(s.holdout.hit);
        expect(s.holdout.hitHi).toBeGreaterThanOrEqual(s.holdout.hit);
      }
    }
  });
});
