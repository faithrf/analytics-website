import { describe, expect, it } from "vitest";
import { BASE_HYPOTHESES, type MBar } from "@/lib/model";
import {
  candidateKey,
  filterCount,
  sampleCandidates,
  tuneFamily,
} from "@/lib/model-tune";
import { rng } from "@/lib/stats";
import { DAY_MS } from "@/lib/trades";

const N = 1500;
const T0 = Date.UTC(2025, 0, 1);

/** Noisy flat series with a +7% volume spike every `every` bars; `drift` is the daily % gain for 10 bars after it. */
function stock(seed: number, drift: number, every = 22): MBar[] {
  const r = rng(seed);
  const bars: MBar[] = [];
  let px = 100;
  let boost = 0;
  for (let i = 0; i < N; i++) {
    const open = px;
    let ret = (r() - 0.5) * 0.01;
    let volume = 1000;
    if (i > 60 && (i + seed) % every === 0) {
      ret = 0.07;
      volume = 4000;
      boost = 10;
    } else if (boost > 0) {
      ret += drift / 100;
      boost--;
    }
    px = open * (1 + ret);
    bars.push({
      t: T0 + i * DAY_MS,
      open,
      high: Math.max(open, px) * 1.002,
      low: Math.min(open, px) * 0.998,
      close: px,
      volume,
    });
  }
  return bars;
}
const universe = (drift: number) =>
  Object.fromEntries(
    Array.from({ length: 10 }, (_, k) => [`S${k}`, stock(k + 1, drift)]),
  );
const TRAIN = 400 * DAY_MS;
// 400 days of history to train on before the 12 test months
const win = { startMs: T0 + (N - 366 - 400) * DAY_MS, endMs: T0 + N * DAY_MS };
const fam = BASE_HYPOTHESES.find((h) => h.id === "momentum")!;
const noIndex = () => undefined;

describe("sampleCandidates", () => {
  it("is deterministic, unique, and starts with the default", () => {
    const a = sampleCandidates(fam, 60, 7);
    const b = sampleCandidates(fam, 60, 7);
    expect(a.map(candidateKey)).toEqual(b.map(candidateKey));
    expect(new Set(a.map(candidateKey)).size).toBe(a.length);
    expect(a[0]).toEqual({ rule: fam.rule, spec: fam.spec });
    expect(a.every((c) => c.rule.minGapDays > c.spec.holdDays)).toBe(true);
  });
  it("counts optional filters", () => {
    expect(
      filterCount({
        rule: { ...fam.rule, regime: "bull" },
        spec: { ...fam.spec, stopPct: 5 },
      }),
    ).toBe(fam.rule.volMult !== undefined ? 3 : 2);
  });
});

describe("tuneFamily", () => {
  it("finds and promotes a planted drift, scoring only held-out months", async () => {
    const res = await tuneFamily(fam, universe(1.5), noIndex, win, {
      candidates: 120,
      minOos: 20,
      minTrain: 10,
      trainMs: TRAIN,
    });
    expect(res.best).not.toBeNull();
    expect(res.oos.n).toBeGreaterThanOrEqual(20);
    expect(res.oos.edge).toBeGreaterThan(1);
    expect(res.oos.p).toBeLessThan(0.05);
    expect(res.folds).toBe(12);
  });

  it("promotes when the default is poor and tuning beats it out of sample", async () => {
    const poor = { ...fam, rule: { ...fam.rule, minPct: 30 } };
    const res = await tuneFamily(poor, universe(1.5), noIndex, win, {
      candidates: 120,
      minOos: 20,
      minTrain: 10,
      trainMs: TRAIN,
    });
    expect(res.defaultOos.n).toBe(0);
    expect(res.promoted).toBe(true);
    expect(res.reason).toMatch(/Walk-forward/);
  });

  it("does not promote when spikes have no follow-through", async () => {
    const res = await tuneFamily(fam, universe(0), noIndex, win, {
      candidates: 120,
      minOos: 20,
      minTrain: 10,
      trainMs: TRAIN,
    });
    expect(res.promoted).toBe(false);
    expect(res.reason).toMatch(/defaults stay/);
  });

  it("refuses to promote on too few out-of-sample trades", async () => {
    const small = { S0: stock(1, 1.5) };
    const res = await tuneFamily(fam, small, noIndex, win, {
      candidates: 60,
      minOos: 30,
      minTrain: 10,
      trainMs: TRAIN,
    });
    expect(res.promoted).toBe(false);
  });

  it("reports progress", async () => {
    const ticks: number[] = [];
    await tuneFamily(fam, universe(1), noIndex, win, {
      candidates: 30,
      trainMs: TRAIN,
      tick: (d) => void ticks.push(d),
    });
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[ticks.length - 1]).toBe(30);
  });
});
