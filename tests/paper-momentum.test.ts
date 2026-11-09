import { describe, expect, it } from "vitest";
import type { MBar } from "@/lib/model";
import { computeLedger, PAPER, type PaperStock } from "@/lib/paper-momentum";

const D = 86_400_000;
const T0 = Date.parse("2026-11-02T00:00:00Z"); // paper start 2026-11-09 is bar index 7; bars are consecutive days

/** flat 100 bars; `jumps` maps a bar index to the close from that bar on */
function series(n: number, jumps: Record<number, number> = {}): MBar[] {
  const bars: MBar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const prev = px;
    px = jumps[i] ?? px;
    bars.push({ t: T0 + i * D, open: prev, high: Math.max(prev, px) + 1, low: Math.min(prev, px) - 1, close: px });
  }
  return bars;
}
const stock = (sym: string, bars: MBar[]): PaperStock => ({ sym, mk: "US", bars });
const spx = series(70);

describe("paper momentum ledger", () => {
  it("detects an 8% close and enters at the next open", () => {
    const l = computeLedger([stock("AAA", series(30, { 10: 109 }))], spx);
    expect(l.open).toHaveLength(1);
    expect(l.open[0]).toMatchObject({ sym: "AAA", signalDate: "2026-11-12", entryDate: "2026-11-13", entry: 109, move: 9 });
  });

  it("ignores a 7.9% move and signals before the start date", () => {
    const l = computeLedger([stock("AAA", series(40, { 10: 107.9 })), stock("BBB", series(40, { 4: 120 }))], spx);
    expect(l.open).toHaveLength(0);
    expect(l.closed).toHaveLength(0);
  });

  it("exits at the close of trading day 20 after entry, net of cost", () => {
    const bars = series(45, { 10: 110, 31: 121 }); // entry bar 11, day 20 = bar 31
    const l = computeLedger([stock("AAA", bars)], spx);
    expect(l.closed).toHaveLength(1);
    const t = l.closed[0];
    expect(t.days).toBe(PAPER.hold);
    expect(t.exitDate).toBe("2026-12-03");
    expect(t.ret).toBeCloseTo((121 / 110 - 1) * 100 - PAPER.costBps / 100, 1);
    expect(l.summary.hit).toBe(100);
  });

  it("keeps a trade open one bar short of day 20 and reports days held", () => {
    const l = computeLedger([stock("AAA", series(31, { 10: 110 }))], spx);
    expect(l.closed).toHaveLength(0);
    expect(l.open[0].days).toBe(19);
  });

  it("reports a signal on the last bar as pending", () => {
    const l = computeLedger([stock("AAA", series(11, { 10: 110 }))], spx);
    expect(l.pending).toHaveLength(1);
    expect(l.open).toHaveLength(0);
  });

  it("caps at 10 positions, ranking same-day signals by move size", () => {
    const stocks = Array.from({ length: 12 }, (_, k) => stock(`S${k}`, series(30, { 10: 109 + k * 0.1 })));
    const l = computeLedger(stocks, spx);
    expect(l.open).toHaveLength(PAPER.slots);
    expect(l.summary.skipped).toBe(2);
    const syms = l.open.map((t) => t.sym);
    expect(syms).toContain("S11");
    expect(syms).not.toContain("S0");
    expect(syms).not.toContain("S1");
  });

  it("frees a slot after exit so a later signal can be taken", () => {
    const early = Array.from({ length: 10 }, (_, k) => stock(`E${k}`, series(60, { 10: 110 })));
    const late = stock("LATE", series(60, { 40: 110 }));
    const l = computeLedger([...early, late], spx);
    expect(l.closed).toHaveLength(10);
    expect(l.open.map((t) => t.sym)).toEqual(["LATE"]);
    expect(l.summary.skipped).toBe(0);
  });

  it("does not stack a second position in a stock already held", () => {
    const l = computeLedger([stock("AAA", series(45, { 10: 110, 15: 125 }))], spx);
    expect(l.open.length + l.closed.length).toBe(1);
  });
});
