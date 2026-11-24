import {
  computeFeatures,
  detectEvents,
  simulateTrade,
  type EntryAt,
  isOptionInstrument,
  type EventKind,
  type EventRule,
  type Feat,
  type Hypothesis,
  type Instrument,
  type MBar,
  type TradeSpec,
} from "@/lib/model";
import { isCryptoId } from "@/lib/symbols";
import { accuracy, rng, tStat, type Accuracy } from "@/lib/stats";
import { DAY_MS } from "@/lib/trades";

/**
 * Walk-forward tuner. For one hypothesis family it samples many (rule, trade) settings, then replays time
 * month by month: before each test month it picks the setting that scored best on the months before it,
 * and records that setting's trades in the test month. The reported accuracy is made only of those
 * held-out trades, so it measures the whole "tune, then trade" procedure rather than one lucky setting.
 */

export interface Candidate {
  rule: EventRule;
  spec: TradeSpec;
}

export interface Win {
  startMs: number;
  endMs: number;
}

export interface TuneStats extends Accuracy {
  /** mean return minus the baseline mean for the same trade on ordinary days */
  edge: number;
  base: number;
}

export interface TuneResult {
  family: string;
  /** best setting using the whole window; null when nothing qualified */
  best: Candidate | null;
  default: Candidate;
  /** walk-forward, out-of-sample */
  oos: TuneStats;
  /** the default setting over the same held-out months */
  defaultOos: TuneStats;
  /** best setting over the whole window it was chosen on: flattering, shown for contrast */
  inSample: TuneStats | null;
  tested: number;
  folds: number;
  foldsTraded: number;
  promoted: boolean;
  reason: string;
}

export interface TuneOpts {
  candidates?: number;
  seed?: number;
  /** minimum trades in the training months for a setting to be considered */
  minTrain?: number;
  /** minimum held-out trades before a result can be promoted */
  minOos?: number;
  /** months at the end of the window that are traded out of sample (default 12) */
  testMonths?: number;
  /** how far back before each test month the setting is tuned (default 3 years) */
  trainMs?: number;
  /** called every few candidates; await a timer in it to keep a UI responsive */
  tick?: (done: number, total: number) => void | Promise<void>;
}

export const WINDOW_MONTHS = 12;
export const WINDOW_MS = 365.25 * DAY_MS;
export const TRAIN_MS = 3 * WINDOW_MS;
const BASELINE_PER_TICKER = 80;
const FILTER_PENALTY = 0.25; // t-stat points per optional filter, to prefer simple settings

const OPTION_OF: Record<Instrument, Instrument> = {
  short: "put",
  long: "call",
  put: "put",
  call: "call",
  "covered-call": "covered-call",
  "cash-put": "cash-put",
};
const STOCK_OF: Record<Instrument, Instrument> = {
  short: "short",
  long: "long",
  put: "short",
  call: "long",
  "covered-call": "long",
  "cash-put": "long",
};

interface Space {
  minPct: number[];
  volMult: (number | undefined)[];
  minAbn: (number | undefined)[];
  runup: Pick<EventRule, "minRunUpPct" | "maxRunUpPct">[];
  regime: (EventRule["regime"] | undefined)[];
  confirm: (EventRule["confirm"] | undefined)[];
  hold: number[];
  entry: EntryAt[];
  instrument: Instrument[];
  stopStock: (number | undefined)[];
  targetStock: (number | undefined)[];
  stopOpt: (number | undefined)[];
  targetOpt: (number | undefined)[];
  otm: number[];
  dte: number[];
}

export function spaceFor(h: Hypothesis): Space {
  const base = h.rule.minPct;
  return {
    minPct: [...new Set([3, 4, 5, 6, 8, base])].sort((a, b) => a - b),
    volMult: [undefined, 1.5, 2, 3],
    minAbn: [undefined, 2, 3],
    runup: [{}, { minRunUpPct: 8 }, { maxRunUpPct: 0 }],
    regime: [undefined, "bull", "bear"],
    confirm: [undefined, "fade", "follow"],
    hold: [3, 5, 10, 15],
    entry: ["close", "next-open"],
    instrument: [
      ...new Set([
        h.spec.instrument,
        STOCK_OF[h.spec.instrument],
        OPTION_OF[h.spec.instrument],
      ]),
    ],
    stopStock: [undefined, 4, 8],
    targetStock: [undefined, 6, 12],
    stopOpt: [undefined, 30, 50],
    targetOpt: [undefined, 50, 100],
    otm: [0, 3, 6],
    dte: [30, 45],
  };
}

const isOpt = isOptionInstrument;

export function candidateKey(c: Candidate): string {
  return JSON.stringify([c.rule, c.spec]);
}

const ruleKey = (r: EventRule) => JSON.stringify(r);
const specKey = (s: TradeSpec) => JSON.stringify(s);

/** Number of optional filters switched on, used for the simplicity penalty. */
export function filterCount(c: Candidate): number {
  const r = c.rule;
  const s = c.spec;
  return [
    r.volMult,
    r.minAbnormalPct,
    r.maxAbnormalPct,
    r.minRunUpPct,
    r.maxRunUpPct,
    r.regime,
    r.confirm,
    s.stopPct,
    s.targetPct,
  ].filter((x) => x !== undefined).length;
}

/** Deterministic sample of settings for a family, always starting with the family's own default. */
export function sampleCandidates(
  h: Hypothesis,
  n: number,
  seed: number,
): Candidate[] {
  const sp = spaceFor(h);
  const r = rng(seed);
  const pick = <T>(xs: T[]): T => xs[(r() * xs.length) | 0];
  const out: Candidate[] = [{ rule: h.rule, spec: h.spec }];
  const seen = new Set([candidateKey(out[0])]);
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const instrument = pick(sp.instrument);
    const opt = isOpt(instrument);
    const hold = pick(sp.hold);
    const rule: EventRule = {
      kind: h.rule.kind as EventKind,
      minPct: pick(sp.minPct),
      volMult: pick(sp.volMult),
      minGapDays: Math.max(10, hold + 1),
      minAbnormalPct: pick(sp.minAbn),
      ...pick(sp.runup),
      regime: pick(sp.regime),
      confirm: pick(sp.confirm),
    };
    for (const k of Object.keys(rule) as (keyof EventRule)[])
      if (rule[k] === undefined) delete rule[k];
    const spec: TradeSpec = {
      instrument,
      entry: pick(sp.entry),
      holdDays: hold,
      stopPct: pick(opt ? sp.stopOpt : sp.stopStock),
      targetPct: pick(opt ? sp.targetOpt : sp.targetStock),
      otmPct: opt ? pick(sp.otm) : 0,
      dte: opt ? pick(sp.dte) : h.spec.dte,
      ivBump: h.spec.ivBump,
    };
    if (spec.stopPct === undefined) delete spec.stopPct;
    if (spec.targetPct === undefined) delete spec.targetPct;
    const c = { rule, spec };
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

interface T {
  t: number;
  ret: number;
}
const slice = (xs: T[], a: number, b: number) =>
  xs.filter((x) => x.t >= a && x.t < b);
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function statsOf(rets: number[], base: number, iters = 1000): TuneStats {
  const a = accuracy(rets, base, iters);
  return { ...a, edge: a.n ? a.mean - base : 0, base };
}

/**
 * Tune one family. `data` and `indexFor` use any ticker key; bars may extend before `win.startMs` for
 * indicator warm-up (events and trades are only taken inside the window).
 */
export async function tuneFamily(
  family: Hypothesis,
  data: Record<string, MBar[]>,
  indexFor: (ticker: string) => MBar[] | undefined,
  win: Win,
  opts: TuneOpts = {},
): Promise<TuneResult> {
  const nCand = opts.candidates ?? 300;
  const minTrain = opts.minTrain ?? 20;
  const minOos = opts.minOos ?? 30;
  const testMonths = opts.testMonths ?? WINDOW_MONTHS;
  const trainMs = opts.trainMs ?? TRAIN_MS;
  const tickers = Object.keys(data);
  const feats: Record<string, Feat[]> = {};
  const index: Record<string, MBar[] | undefined> = {};
  for (const k of tickers) {
    index[k] = indexFor(k);
    feats[k] = computeFeatures(data[k], index[k], isCryptoId(k));
  }
  const evCache = new Map<string, { k: string; i: number; t: number }[]>();
  const events = (rule: EventRule) => {
    const key = ruleKey(rule);
    let hit = evCache.get(key);
    if (!hit) {
      hit = [];
      for (const k of tickers)
        for (const e of detectEvents(data[k], rule, win.startMs, {
          index: index[k],
          feats: feats[k],
        }))
          if (e.t < win.endMs) hit.push({ k, i: e.i, t: e.t });
      evCache.set(key, hit);
    }
    return hit;
  };
  const tradeCache = new Map<string, T[]>();
  const trades = (c: Candidate) => {
    const key = candidateKey(c);
    let hit = tradeCache.get(key);
    if (!hit) {
      hit = [];
      for (const e of events(c.rule)) {
        const o = simulateTrade(data[e.k], e.i, c.spec);
        if (o) hit.push({ t: e.t, ret: o.ret });
      }
      tradeCache.set(key, hit);
    }
    return hit;
  };
  const baseCache = new Map<string, T[]>();
  const baseline = (spec: TradeSpec) => {
    const key = specKey(spec);
    let hit = baseCache.get(key);
    if (!hit) {
      hit = [];
      for (const k of tickers) {
        const bars = data[k];
        const days: number[] = [];
        for (let i = 1; i < bars.length; i++)
          if (bars[i].t >= win.startMs && bars[i].t < win.endMs) days.push(i);
        const step = Math.max(1, Math.ceil(days.length / BASELINE_PER_TICKER));
        for (let j = 0; j < days.length; j += step) {
          const o = simulateTrade(bars, days[j], spec);
          if (o) hit.push({ t: bars[days[j]].t, ret: o.ret });
        }
      }
      baseCache.set(key, hit);
    }
    return hit;
  };

  const cands = sampleCandidates(family, nCand, opts.seed ?? 20260101);
  const def = cands[0];
  const month = WINDOW_MS / 12;
  const testStart = win.endMs - testMonths * month;
  const bound = (m: number) => testStart + m * month;
  const trainFrom = (a: number) => Math.max(win.startMs, a - trainMs);

  /** training score: t-stat of the edge over the baseline, minus a simplicity penalty; -Infinity when disqualified */
  const score = (c: Candidate, a: number, b: number) => {
    const tr = slice(trades(c), a, b).map((x) => x.ret);
    if (tr.length < minTrain) return -Infinity;
    const base = mean(slice(baseline(c.spec), a, b).map((x) => x.ret));
    if (mean(tr) <= 0 || mean(tr) <= base) return -Infinity;
    return tStat(tr, base) - FILTER_PENALTY * filterCount(c);
  };
  const bestOf = (a: number, b: number) => {
    let best: Candidate | null = null;
    let bs = -Infinity;
    for (const c of cands) {
      const s = score(c, a, b);
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    return best;
  };

  // precompute with progress so a UI can show it
  for (let i = 0; i < cands.length; i++) {
    trades(cands[i]);
    baseline(cands[i].spec);
    if (opts.tick && i % 10 === 0) await opts.tick(i, cands.length);
  }
  if (opts.tick) await opts.tick(cands.length, cands.length);

  const oosRets: number[] = [];
  const oosW: { n: number; base: number }[] = [];
  const defRets: number[] = [];
  const defW: { n: number; base: number }[] = [];
  let foldsTraded = 0;
  const folds = testMonths;
  for (let m = 0; m < testMonths; m++) {
    const a = bound(m);
    const b = m === testMonths - 1 ? win.endMs : bound(m + 1);
    const pick = bestOf(trainFrom(a), a);
    if (pick) {
      const te = slice(trades(pick), a, b).map((x) => x.ret);
      if (te.length) {
        foldsTraded++;
        oosRets.push(...te);
        oosW.push({
          n: te.length,
          base: mean(slice(baseline(pick.spec), a, b).map((x) => x.ret)),
        });
      }
    }
    const dt = slice(trades(def), a, b).map((x) => x.ret);
    if (dt.length) {
      defRets.push(...dt);
      defW.push({
        n: dt.length,
        base: mean(slice(baseline(def.spec), a, b).map((x) => x.ret)),
      });
    }
  }
  const wavg = (w: { n: number; base: number }[]) =>
    w.reduce((s, x) => s + x.n, 0)
      ? w.reduce((s, x) => s + x.n * x.base, 0) / w.reduce((s, x) => s + x.n, 0)
      : 0;
  const oos = statsOf(oosRets, wavg(oosW));
  const defaultOos = statsOf(defRets, wavg(defW));

  const finalFrom = trainFrom(win.endMs);
  const best = bestOf(finalFrom, win.endMs);
  const inSample = best
    ? statsOf(
        slice(trades(best), finalFrom, win.endMs).map((x) => x.ret),
        mean(
          slice(baseline(best.spec), finalFrom, win.endMs).map((x) => x.ret),
        ),
      )
    : null;

  let promoted = false;
  let reason: string;
  if (!best)
    reason = `No setting had at least ${minTrain} winning trades to learn from, so the defaults stay.`;
  else if (oos.n < minOos)
    reason = `Only ${oos.n} out-of-sample trades (need ${minOos}); too few to trust, so the defaults stay.`;
  else if (oos.mean <= 0)
    reason = `Out-of-sample the tuned picks lost money outright (average ${oos.mean.toFixed(2)}%), so the defaults stay.`;
  else if (!(oos.edge > 0 && oos.mean > 0))
    reason = `Out-of-sample the tuned picks did not beat the baseline (edge ${oos.edge.toFixed(2)} pts, p=${oos.p.toFixed(2)}), so the defaults stay.`;
  else if (oos.p >= 0.05)
    reason = `Out-of-sample edge ${oos.edge.toFixed(2)} pts is not statistically solid (p=${oos.p.toFixed(2)}), so the defaults stay.`;
  else if (!(oos.edge > defaultOos.edge))
    reason = `Tuning did not beat the default out of sample (${oos.edge.toFixed(2)} vs ${defaultOos.edge.toFixed(2)} pts), so the defaults stay.`;
  else {
    promoted = true;
    reason = `Walk-forward out-of-sample: ${oos.n} trades, edge ${oos.edge.toFixed(2)} pts, p=${oos.p.toFixed(3)}, beating the default (${defaultOos.edge.toFixed(2)} pts).`;
  }
  return {
    family: family.id,
    best,
    default: def,
    oos,
    defaultOos,
    inSample,
    tested: cands.length,
    folds,
    foldsTraded,
    promoted,
    reason,
  };
}
