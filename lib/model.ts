import tunedFile from "@/data/model-tuned.json";
import { accuracy, type Accuracy } from "@/lib/stats";
import {
  bsOption,
  DAY_MS,
  DEFAULT_SIGMA,
  histVol,
  RISK_FREE,
  YEAR_MS,
  type Bar,
} from "@/lib/trades";

/**
 * Event-driven backtests. There is no historical news archive, so a "news event"
 * is a price/volume shock found in daily bars. Option prices are Black-Scholes estimates.
 */

export interface MBar extends Bar {
  open?: number;
  volume?: number;
}

export type EventKind =
  | "gap-up"
  | "gap-down"
  | "day-up"
  | "day-down"
  /** likely earnings reaction: a gap on a volume spike near a quarterly cadence (see earningsFlags) */
  | "earn-up"
  | "earn-down";

const isGapKind = (k: EventKind) =>
  k === "gap-up" || k === "gap-down" || k === "earn-up" || k === "earn-down";
const isUpKind = (k: EventKind) =>
  k === "gap-up" || k === "day-up" || k === "earn-up";
const isEarnKind = (k: EventKind) => k === "earn-up" || k === "earn-down";

export interface EventRule {
  kind: EventKind;
  /** minimum move, in percent (positive number; direction comes from `kind`) */
  minPct: number;
  /** size bucket: skip moves of this many percent or more (positive number) */
  maxPct?: number;
  /** volume >= volMult x 20-day average volume; skipped when the ticker has no volume data */
  volMult?: number;
  /** skip an event closer than this many bars to the previous event on the same ticker */
  minGapDays: number;
  /** abnormal move on the event day (stock return minus beta x index return) must be at least this, in the event's direction, percent */
  minAbnormalPct?: number;
  /** ...and at most this (use a small value to keep only market-wide moves). Same sign convention as minAbnormalPct */
  maxAbnormalPct?: number;
  /** return over the 20 bars before the event day, percent (signed, not flipped for direction) */
  minRunUpPct?: number;
  maxRunUpPct?: number;
  /** index above ("bull") or below ("bear") its 200-day average on the event day */
  regime?: "bull" | "bear";
  /** event-day close vs open: "fade" = closed back against the event direction, "follow" = closed with it */
  confirm?: "fade" | "follow";
}

/** "covered-call" = own the stock and sell an OTM call; "cash-put" = sell an OTM put against cash. Both held to expiry. */
export type Instrument =
  | "short"
  | "long"
  | "put"
  | "call"
  | "covered-call"
  | "cash-put";
export type EntryAt = "close" | "next-open";

export interface TradeSpec {
  instrument: Instrument;
  entry: EntryAt;
  /** trading days held after entry */
  holdDays: number;
  stopPct?: number;
  targetPct?: number;
  /** options: how far out of the money the strike is, percent (0 = at the money) */
  otmPct: number;
  /** options: calendar days to expiry at entry */
  dte: number;
  /** options: implied vol = historical vol x this */
  ivBump: number;
  /** stock round-trip cost, basis points (default 0) */
  costBps?: number;
  /** sold options: fraction of the premium given up to the spread (default 0) */
  optHaircut?: number;
}

export interface Hypothesis {
  id: string;
  label: string;
  rule: EventRule;
  spec: TradeSpec;
  /** set when the preset's numbers came from `npm run model:train` and passed its out-of-sample checks */
  tuned?: {
    trainedAt: string;
    window: { from: string; to: string };
    stats: TunedStats;
    defaultStats: TunedStats;
  };
  /** why the defaults were kept, when training ran but nothing passed */
  tunedNote?: string;
}

/** Out-of-sample figures kept in data/model-tuned.json (walk-forward, trades from folds the choice never saw). */
export interface TunedStats {
  n: number;
  hit: number;
  hitLo: number;
  hitHi: number;
  mean: number;
  edge: number;
  t: number;
  p: number;
}

export interface TunedFamily {
  promoted: boolean;
  reason: string;
  rule: EventRule;
  spec: TradeSpec;
  oos: TunedStats;
  defaultOos: TunedStats;
  inSample: TunedStats | null;
  tested: number;
  folds: number;
}

export interface TunedFile {
  trainedAt: string | null;
  window?: { from: string; to: string };
  universe?: number;
  families: Record<string, TunedFamily>;
}

export const VOL_AVG_DAYS = 20;

/** Hand-picked starting points. `npm run model:train` tunes around these and never overwrites them. */
export const BASE_HYPOTHESES: Hypothesis[] = [
  {
    id: "fade-gap",
    label: "Sell the news: fade gap-ups (short)",
    rule: { kind: "gap-up", minPct: 4, volMult: 1.5, minGapDays: 10 },
    spec: {
      instrument: "short",
      entry: "close",
      holdDays: 5,
      stopPct: 8,
      otmPct: 0,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "spike-puts",
    label: "Sell the news: buy puts after spike",
    rule: { kind: "day-up", minPct: 6, volMult: 2, minGapDays: 10 },
    spec: {
      instrument: "put",
      entry: "close",
      holdDays: 5,
      otmPct: 3,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "panic",
    label: "Panic overdone: buy after gap-down",
    rule: { kind: "gap-down", minPct: 5, volMult: 1.5, minGapDays: 10 },
    spec: {
      instrument: "long",
      entry: "close",
      holdDays: 10,
      stopPct: 10,
      otmPct: 0,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "momentum",
    label: "Momentum: follow big up day",
    rule: { kind: "day-up", minPct: 6, volMult: 1.5, minGapDays: 11 },
    spec: {
      instrument: "long",
      entry: "next-open",
      holdDays: 10,
      otmPct: 0,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "earn-drift-up",
    label: "Earnings drift: long after a positive reaction",
    rule: { kind: "earn-up", minPct: 5, volMult: 2, minGapDays: 21 },
    spec: {
      instrument: "long",
      entry: "next-open",
      holdDays: 20,
      otmPct: 0,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "earn-drift-down",
    label: "Earnings drift: short after a negative reaction",
    rule: { kind: "earn-down", minPct: 5, volMult: 2, minGapDays: 21 },
    spec: {
      instrument: "short",
      entry: "next-open",
      holdDays: 20,
      otmPct: 0,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "covered-call-spike",
    label: "Sell premium: covered call after a big up day",
    rule: { kind: "day-up", minPct: 6, volMult: 1.5, minGapDays: 21 },
    spec: {
      instrument: "covered-call",
      entry: "close",
      holdDays: 21,
      otmPct: 5,
      dte: 30,
      ivBump: 1.3,
    },
  },
  {
    id: "cash-put-drop",
    label: "Sell premium: cash-secured put after a big down day",
    rule: { kind: "day-down", minPct: 6, volMult: 1.5, minGapDays: 21 },
    spec: {
      instrument: "cash-put",
      entry: "close",
      holdDays: 21,
      otmPct: 5,
      dte: 30,
      ivBump: 1.3,
    },
  },
];

const TUNED = tunedFile as unknown as TunedFile;

/** Presets as shown in the UI: the defaults, replaced by tuned numbers only where training promoted them. */
export const HYPOTHESES: Hypothesis[] = BASE_HYPOTHESES.map((h) => {
  const t = TUNED.families?.[h.id];
  if (!t || !TUNED.trainedAt) return h;
  if (!t.promoted) return { ...h, tunedNote: t.reason };
  return {
    ...h,
    rule: t.rule,
    spec: t.spec,
    tuned: {
      trainedAt: TUNED.trainedAt,
      window: TUNED.window ?? { from: "", to: "" },
      stats: t.oos,
      defaultStats: t.defaultOos,
    },
  };
});

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Percent move that defines the event on bar `i`: gap uses open vs prior close, day uses close vs prior close. */
export function eventMove(
  bars: MBar[],
  i: number,
  kind: EventKind,
): number | null {
  if (i < 1) return null;
  const prev = bars[i - 1].close;
  const px = isGapKind(kind) ? bars[i].open : bars[i].close;
  if (!finite(px) || !(prev > 0)) return null;
  return (px / prev - 1) * 100;
}

/** Volume on bar `i` relative to the average of the prior 20 bars; null when unknown. */
export function volRatio(bars: MBar[], i: number): number | null {
  const v = bars[i].volume;
  if (!finite(v)) return null;
  const prior = bars
    .slice(Math.max(0, i - VOL_AVG_DAYS), i)
    .map((b) => b.volume)
    .filter((x): x is number => finite(x) && x > 0);
  if (prior.length < Math.min(10, VOL_AVG_DAYS)) return null;
  const avg = mean(prior);
  return avg > 0 ? v / avg : null;
}

const hasVolume = (bars: MBar[]) =>
  bars.some((b) => finite(b.volume) && (b.volume as number) > 0);

/**
 * Likely-earnings proxy (Yahoo has no earnings history): a bar counts when a volume spike (>= 2x the
 * 20-day average) occurred about one, two or four quarters earlier. Used together with a spike on the bar itself.
 */
export function earningsFlags(bars: MBar[]): boolean[] {
  const spike = bars.map((_, i) => (volRatio(bars, i) ?? 0) >= 2);
  const wins: [number, number][] = [
    [58, 68],
    [121, 133],
    [248, 258],
  ];
  return bars.map((_, i) =>
    wins.some(([lo, hi]) => {
      for (let l = lo; l <= hi; l++) if (i - l >= 0 && spike[i - l]) return true;
      return false;
    }),
  );
}

export const RUNUP_DAYS = 20;
export const BETA_DAYS = 60;
export const REGIME_DAYS = 200;

/** Per-bar features that need the index (abnormal move, regime) or look back (run-up). */
export interface Feat {
  /** close-to-close return on the bar, percent */
  dayRet: number | null;
  /** dayRet minus beta x index return (beta from the prior 60 bars), percent */
  abn: number | null;
  /** return over the 20 bars before this bar, percent */
  runUp: number | null;
  /** index above its 200-day average; null without index data */
  bull: boolean | null;
  /** close vs open on the bar, percent */
  fade: number | null;
  /** a volume spike one, two or four quarters earlier: the bar may be an earnings reaction */
  earn: boolean;
}

export function computeFeatures(bars: MBar[], index?: MBar[]): Feat[] {
  const n = bars.length;
  const pos = new Map<number, number>();
  index?.forEach((b, j) => pos.set(b.t, j));
  const sr: (number | null)[] = new Array(n).fill(null);
  const ir: (number | null)[] = new Array(n).fill(null);
  const bull: (boolean | null)[] = new Array(n).fill(null);
  if (index) {
    // trailing 200-bar sum of index closes
    const csum = [0];
    for (const b of index) csum.push(csum[csum.length - 1] + b.close);
    for (let i = 0; i < n; i++) {
      const j = pos.get(bars[i].t);
      if (j === undefined) continue;
      if (j >= 1 && index[j - 1].close > 0)
        ir[i] = (index[j].close / index[j - 1].close - 1) * 100;
      if (j + 1 >= REGIME_DAYS)
        bull[i] =
          index[j].close >
          (csum[j + 1] - csum[j + 1 - REGIME_DAYS]) / REGIME_DAYS;
    }
  }
  for (let i = 1; i < n; i++)
    if (bars[i - 1].close > 0)
      sr[i] = (bars[i].close / bars[i - 1].close - 1) * 100;
  const out: Feat[] = [];
  const earn = earningsFlags(bars);
  for (let i = 0; i < n; i++) {
    let abn: number | null = null;
    if (sr[i] !== null && ir[i] !== null) {
      let sx = 0,
        sy = 0,
        sxx = 0,
        sxy = 0,
        m = 0;
      for (let k = Math.max(1, i - BETA_DAYS); k < i; k++) {
        const x = ir[k];
        const y = sr[k];
        if (x === null || y === null) continue;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
        m++;
      }
      let beta = 1;
      if (m >= 30) {
        const vx = sxx / m - (sx / m) ** 2;
        if (vx > 1e-9)
          beta = Math.min(
            3,
            Math.max(-1, (sxy / m - (sx / m) * (sy / m)) / vx),
          );
      }
      abn = (sr[i] as number) - beta * (ir[i] as number);
    }
    const b = bars[i];
    out.push({
      dayRet: sr[i],
      abn,
      runUp:
        i - 1 - RUNUP_DAYS >= 0 && bars[i - 1 - RUNUP_DAYS].close > 0
          ? (bars[i - 1].close / bars[i - 1 - RUNUP_DAYS].close - 1) * 100
          : null,
      bull: bull[i],
      fade: finite(b.open) && b.open > 0 ? (b.close / b.open - 1) * 100 : null,
      earn: earn[i],
    });
  }
  return out;
}

const needsFeatures = (r: EventRule) =>
  isEarnKind(r.kind) ||
  r.minAbnormalPct !== undefined ||
  r.maxAbnormalPct !== undefined ||
  r.minRunUpPct !== undefined ||
  r.maxRunUpPct !== undefined ||
  r.regime !== undefined ||
  r.confirm !== undefined;

function passesFeatures(
  rule: EventRule,
  up: boolean,
  f: Feat | undefined,
): boolean {
  if (!needsFeatures(rule)) return true;
  if (!f) return false;
  if (isEarnKind(rule.kind) && !f.earn) return false;
  const dir = up ? 1 : -1;
  if (rule.minAbnormalPct !== undefined || rule.maxAbnormalPct !== undefined) {
    if (f.abn === null) return false;
    const a = f.abn * dir;
    if (rule.minAbnormalPct !== undefined && a < rule.minAbnormalPct)
      return false;
    if (rule.maxAbnormalPct !== undefined && a > rule.maxAbnormalPct)
      return false;
  }
  if (rule.minRunUpPct !== undefined || rule.maxRunUpPct !== undefined) {
    if (f.runUp === null) return false;
    if (rule.minRunUpPct !== undefined && f.runUp < rule.minRunUpPct)
      return false;
    if (rule.maxRunUpPct !== undefined && f.runUp > rule.maxRunUpPct)
      return false;
  }
  if (rule.regime !== undefined) {
    if (f.bull === null || f.bull !== (rule.regime === "bull")) return false;
  }
  if (rule.confirm !== undefined) {
    if (f.fade === null) return false;
    const withEvent = f.fade * dir >= 0;
    if (withEvent !== (rule.confirm === "follow")) return false;
  }
  return true;
}

function triggers(
  bars: MBar[],
  i: number,
  rule: EventRule,
  volData: boolean,
  feats?: Feat[],
): { move: number; vol: number | null } | null {
  const move = eventMove(bars, i, rule.kind);
  if (move === null) return null;
  const up = isUpKind(rule.kind);
  if (up ? move < rule.minPct : move > -rule.minPct) return null;
  if (rule.maxPct !== undefined && Math.abs(move) >= rule.maxPct) return null;
  const vol = volRatio(bars, i);
  if (
    rule.volMult !== undefined &&
    rule.volMult > 0 &&
    volData &&
    (vol === null || vol < rule.volMult)
  )
    return null;
  if (!passesFeatures(rule, up, feats?.[i])) return null;
  return { move, vol };
}

export interface ModelEvent {
  i: number;
  t: number;
  move: number;
  vol: number | null;
}

export interface DetectOpts {
  /** index bars (same dates) for the abnormal-move and regime filters */
  index?: MBar[];
  /** precomputed features, to avoid recomputing across many rules */
  feats?: Feat[];
}

/** Bars (by index) where the rule fires, thinned by minGapDays. */
export function detectEvents(
  bars: MBar[],
  rule: EventRule,
  fromMs = -Infinity,
  opts: DetectOpts = {},
): ModelEvent[] {
  const volData = hasVolume(bars);
  const feats = needsFeatures(rule)
    ? (opts.feats ?? computeFeatures(bars, opts.index))
    : undefined;
  const out: ModelEvent[] = [];
  let last = -Infinity;
  for (let i = 1; i < bars.length; i++) {
    const hit = triggers(bars, i, rule, volData, feats);
    if (!hit) continue;
    if (i - last < rule.minGapDays) continue;
    last = i;
    if (bars[i].t >= fromMs)
      out.push({ i, t: bars[i].t, move: hit.move, vol: hit.vol });
  }
  return out;
}

export type ExitReason = "hold" | "stop" | "target";

export interface TradeOutcome {
  entryI: number;
  exitI: number;
  entryT: number;
  exitT: number;
  entry: number;
  exit: number;
  /** return on the money put in (stock price or option premium), percent; negative = loss */
  ret: number;
  reason: ExitReason;
  /** options only */
  strike?: number;
  sigma?: number;
  /** sold options: premium (before the spread haircut) as percent of the money tied up (stock price or strike) */
  premiumPct?: number;
  /** sold options: the option finished in the money (stock called away / put to us) */
  assigned?: boolean;
  /** sold options: the plain stock return over the same days, percent, before costs */
  stockRet?: number;
  /** sold options: the risk-free return over the same days, percent */
  cashRet?: number;
}

const isOpt = (s: Instrument) => s === "put" || s === "call";
export const isSold = (s: Instrument) =>
  s === "covered-call" || s === "cash-put";
export const isOptionInstrument = (s: Instrument) => isOpt(s) || isSold(s);

/**
 * Take the trade for an event on bar `idx`. Null when the trade can't be completed with the data
 * (not enough bars after the event, missing prices, or a worthless option premium).
 */
export function simulateTrade(
  bars: MBar[],
  idx: number,
  spec: TradeSpec,
): TradeOutcome | null {
  const entryI = spec.entry === "close" ? idx : idx + 1;
  const hold = Math.max(1, Math.round(spec.holdDays));
  const exitI = entryI + hold;
  if (entryI < 1 || exitI >= bars.length) return null;
  const eb = bars[entryI];
  const entry = spec.entry === "close" ? eb.close : (eb.open ?? eb.close);
  if (!(entry > 0)) return null;
  // after a close entry the entry bar is already over; after an open entry its range counts
  const firstCheck = spec.entry === "close" ? entryI + 1 : entryI;

  if (isSold(spec.instrument)) {
    // sold premium, held to expiry (the last bar on or before it) and settled at that close
    const call = spec.instrument === "covered-call";
    const expiryT = eb.t + spec.dte * DAY_MS;
    let at = entryI;
    while (at + 1 < bars.length && bars[at + 1].t <= expiryT) at++;
    if (
      at === entryI ||
      (at === bars.length - 1 && bars[at].t < expiryT - 4 * DAY_MS)
    )
      return null;
    const base =
      histVol(bars.slice(Math.max(0, idx - 40), idx), bars[idx].t) ??
      DEFAULT_SIGMA;
    const sigmaIn = base * spec.ivBump;
    const strike = entry * (1 + ((call ? 1 : -1) * spec.otmPct) / 100);
    const mid = bsOption(
      call,
      entry,
      strike,
      spec.dte / 365,
      RISK_FREE,
      sigmaIn,
    );
    if (!(mid > entry * 1e-5)) return null;
    const got = mid * (1 - (spec.optHaircut ?? 0));
    const sx = bars[at].close;
    const cost = (spec.costBps ?? 0) / 100; // percent of the money tied up
    const owed = call ? Math.max(sx - strike, 0) : Math.max(strike - sx, 0);
    const assigned = call ? sx > strike : sx < strike;
    const capital = call ? entry : strike;
    const pnl = call ? sx - entry + got - owed : got - owed;
    // a covered call buys and sells the stock; a put's stock leg trades one side, and only when assigned
    const costPct = call ? cost : assigned ? cost / 2 : 0;
    const days = (bars[at].t - eb.t) / DAY_MS;
    return {
      entryI,
      exitI: at,
      entryT: eb.t,
      exitT: bars[at].t,
      entry,
      exit: sx,
      ret: (pnl / capital) * 100 - costPct,
      reason: "hold",
      strike,
      sigma: sigmaIn,
      premiumPct: (mid / capital) * 100,
      assigned,
      stockRet: (sx / entry - 1) * 100,
      cashRet: RISK_FREE * (days / 365) * 100,
    };
  }

  if (!isOpt(spec.instrument)) {
    const dir = spec.instrument === "long" ? 1 : -1;
    const stopPx =
      spec.stopPct !== undefined
        ? entry * (1 - (dir * spec.stopPct) / 100)
        : undefined;
    const tgtPx =
      spec.targetPct !== undefined
        ? entry * (1 + (dir * spec.targetPct) / 100)
        : undefined;
    let exit = bars[exitI].close;
    let at = exitI;
    let reason: ExitReason = "hold";
    for (let j = firstCheck; j <= exitI; j++) {
      const b = bars[j];
      const stopHit =
        stopPx !== undefined &&
        (dir === 1 ? b.low <= stopPx : b.high >= stopPx);
      const tgtHit =
        tgtPx !== undefined && (dir === 1 ? b.high >= tgtPx : b.low <= tgtPx);
      // when both fall inside one bar the order is unknown: assume the stop went first
      if (stopHit) {
        const gapped =
          b.open !== undefined &&
          j > entryI &&
          (dir === 1
            ? b.open < (stopPx as number)
            : b.open > (stopPx as number));
        exit = gapped ? (b.open as number) : (stopPx as number);
        at = j;
        reason = "stop";
        break;
      }
      if (tgtHit) {
        exit = tgtPx as number;
        at = j;
        reason = "target";
        break;
      }
    }
    const ret = dir * (exit / entry - 1) * 100 - (spec.costBps ?? 0) / 100;
    return {
      entryI,
      exitI: at,
      entryT: eb.t,
      exitT: bars[at].t,
      entry,
      exit,
      ret,
      reason,
    };
  }

  // options: IV = historical vol before the event x bump; at exit the bump is gone (IV falls back after the news)
  const base =
    histVol(bars.slice(Math.max(0, idx - 40), idx), bars[idx].t) ??
    DEFAULT_SIGMA;
  const sigmaIn = base * spec.ivBump;
  const call = spec.instrument === "call";
  const strike = entry * (1 + ((call ? 1 : -1) * spec.otmPct) / 100);
  const premium = bsOption(
    call,
    entry,
    strike,
    spec.dte / 365,
    RISK_FREE,
    sigmaIn,
  );
  if (!(premium > entry * 1e-5)) return null;
  const valueAt = (j: number, px: number) => {
    const left = (spec.dte * DAY_MS - (bars[j].t - eb.t)) / YEAR_MS;
    return bsOption(call, px, strike, left, RISK_FREE, base);
  };
  let exit = valueAt(exitI, bars[exitI].close);
  let at = exitI;
  let reason: ExitReason = "hold";
  // stop/target are % of the premium, checked on daily closes (no intraday option prices)
  for (let j = firstCheck; j <= exitI; j++) {
    const v = j === exitI ? exit : valueAt(j, bars[j].close);
    if (spec.stopPct !== undefined && v <= premium * (1 - spec.stopPct / 100)) {
      exit = v;
      at = j;
      reason = "stop";
      break;
    }
    if (
      spec.targetPct !== undefined &&
      v >= premium * (1 + spec.targetPct / 100)
    ) {
      exit = v;
      at = j;
      reason = "target";
      break;
    }
  }
  return {
    entryI,
    exitI: at,
    entryT: eb.t,
    exitT: bars[at].t,
    entry: premium,
    exit,
    ret: (exit / premium - 1) * 100,
    reason,
    strike,
    sigma: sigmaIn,
  };
}

export interface EventRow extends TradeOutcome {
  ticker: string;
  /** event day */
  t: number;
  move: number;
  vol: number | null;
  /** abnormal move vs the index, percent; null without index data */
  abn: number | null;
  /** return over the 20 bars before the event, percent */
  runUp: number | null;
}

export interface Summary {
  count: number;
  winRate: number;
  avg: number;
  median: number;
  best: number;
  worst: number;
  /** product of (1 + return) over all trades, percent */
  compounded: number;
}

const EMPTY: Summary = {
  count: 0,
  winRate: 0,
  avg: 0,
  median: 0,
  best: 0,
  worst: 0,
  compounded: 0,
};

export function summarise(rets: number[]): Summary {
  if (!rets.length) return EMPTY;
  return {
    count: rets.length,
    winRate: (rets.filter((r) => r > 0).length / rets.length) * 100,
    avg: mean(rets),
    median: median(rets),
    best: Math.max(...rets),
    worst: Math.min(...rets),
    compounded: (rets.reduce((p, r) => p * (1 + r / 100), 1) - 1) * 100,
  };
}

export interface TickerRow extends Summary {
  ticker: string;
}

export interface CurvePoint {
  t: number;
  /** cumulative profit with $100 put into every trade */
  pl: number;
}

export interface ModelResult {
  events: EventRow[];
  summary: Summary;
  baseline: Summary;
  /** event avg return minus baseline avg return, percentage points */
  edge: number;
  byTicker: TickerRow[];
  curve: CurvePoint[];
  /** accuracy figures for the event trades against the baseline */
  stats: Accuracy;
}

export interface RunOpts {
  /** events and baseline days from this time on are dropped */
  toMs?: number;
  /** index bars for a ticker (abnormal-move and regime filters) */
  indexFor?: (ticker: string) => MBar[] | undefined;
}

/** Max baseline trades per ticker (every k-th non-event day, so it stays quick and deterministic). */
export const BASELINE_PER_TICKER = 300;

export function runModel(
  data: Record<string, MBar[]>,
  rule: EventRule,
  spec: TradeSpec,
  fromMs = -Infinity,
  run: RunOpts = {},
): ModelResult {
  const toMs = run.toMs ?? Infinity;
  const events: EventRow[] = [];
  const baseRets: number[] = [];
  for (const [ticker, bars] of Object.entries(data)) {
    const index = run.indexFor?.(ticker);
    const feats = computeFeatures(bars, index);
    const evs = detectEvents(bars, rule, -Infinity, { index, feats });
    const evIdx = new Set(evs.map((e) => e.i));
    for (const e of evs) {
      if (e.t < fromMs || e.t >= toMs) continue;
      const o = simulateTrade(bars, e.i, spec);
      if (o)
        events.push({
          ...o,
          ticker,
          t: e.t,
          move: e.move,
          vol: e.vol,
          abn: feats[e.i].abn,
          runUp: feats[e.i].runUp,
        });
    }
    const days: number[] = [];
    for (let i = 1; i < bars.length; i++)
      if (bars[i].t >= fromMs && bars[i].t < toMs && !evIdx.has(i))
        days.push(i);
    const step = Math.max(1, Math.ceil(days.length / BASELINE_PER_TICKER));
    for (let k = 0; k < days.length; k += step) {
      const o = simulateTrade(bars, days[k], spec);
      if (o) baseRets.push(o.ret);
    }
  }
  events.sort((a, b) => a.t - b.t || a.ticker.localeCompare(b.ticker));
  const summary = summarise(events.map((e) => e.ret));
  const baseline = summarise(baseRets);
  const groups = new Map<string, number[]>();
  for (const e of events)
    groups.set(e.ticker, [...(groups.get(e.ticker) ?? []), e.ret]);
  const byTicker = [...groups]
    .map(([ticker, r]) => ({ ticker, ...summarise(r) }))
    .sort((a, b) => b.avg - a.avg);
  let pl = 0;
  const curve = [...events]
    .sort((a, b) => a.exitT - b.exitT)
    .map((e) => ({ t: e.exitT, pl: (pl += e.ret) }));
  const stats = accuracy(
    [...events].sort((a, b) => a.exitT - b.exitT).map((e) => e.ret),
    baseline.avg,
  );
  return {
    events,
    summary,
    baseline,
    edge: events.length && baseRets.length ? summary.avg - baseline.avg : 0,
    byTicker,
    curve,
    stats,
  };
}

export interface LiveSignal {
  ticker: string;
  t: number;
  move: number;
  vol: number | null;
  close: number;
}

/** Tickers whose latest bar triggers the rule right now (minGapDays is not applied). */
export function liveSignals(
  data: Record<string, MBar[]>,
  rule: EventRule,
  indexFor?: (ticker: string) => MBar[] | undefined,
): LiveSignal[] {
  const out: LiveSignal[] = [];
  for (const [ticker, bars] of Object.entries(data)) {
    const i = bars.length - 1;
    if (i < 1) continue;
    const hit = triggers(
      bars,
      i,
      rule,
      hasVolume(bars),
      needsFeatures(rule)
        ? computeFeatures(bars, indexFor?.(ticker))
        : undefined,
    );
    if (hit)
      out.push({
        ticker,
        t: bars[i].t,
        move: hit.move,
        vol: hit.vol,
        close: bars[i].close,
      });
  }
  return out.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
}

export const US_MEGA = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AVGO",
  "JPM",
  "V",
  "UNH",
  "XOM",
  "LLY",
  "WMT",
  "MA",
  "COST",
  "NFLX",
  "AMD",
  "ORCL",
  "CRM",
];
export const ASX_20 = [
  "CBA",
  "BHP",
  "CSL",
  "NAB",
  "WBC",
  "ANZ",
  "WES",
  "MQG",
  "GMG",
  "FMG",
  "WDS",
  "TLS",
  "RIO",
  "WOW",
  "TCL",
  "ALL",
  "COL",
  "REA",
  "QBE",
  "XRO",
];
/** About 125 liquid US large caps (today's, so survivorship bias applies). */
export const US_LIQUID = [
  ...new Set([
    ...US_MEGA,
    ..."BAC WFC GS MS C HD LOW MCD NKE SBUX KO PEP PG JNJ PFE MRK ABBV TMO ABT CVX COP SLB CAT DE BA GE HON UPS LMT RTX T VZ DIS CMCSA INTC QCOM TXN CSCO ADBE IBM MU AMAT PYPL".split(
      " ",
    ),
    ..."SPGI BLK SCHW AXP USB PNC MET PRU CB MMC AON ICE CME BKNG UBER ISRG SYK BSX MDT DHR GILD AMGN REGN VRTX BMY CVS CI ELV HCA ZTS MDLZ MO PM CL KMB GIS TGT DG TJX ROST ORLY AZO F GM EOG OXY PSX MPC VLO HAL DUK SO NEE LIN APD SHW FCX NEM NUE UNP CSX NSC FDX GD NOC EMR ETN ITW MMM PH PANW NOW INTU ADP MRVL KLAC LRCX ADI NXPI MCHP PLTR ANET TMUS CHTR EA".split(
      " ",
    ),
  ]),
];
export const ASX_50 = [
  ...ASX_20,
  ..."STO ORG AMC BXB SUN IAG SCG APA QAN MPL ASX JBH S32 NST EVN PLS BSL NXT SOL TLC LLC ALQ COH SHL RMD SGH WTC CPU DXS GPT MIN ORI".split(
    " ",
  ),
];
export const MAX_TICKERS = 160;
