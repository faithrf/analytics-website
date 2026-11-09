/** Small statistics helpers for judging backtest results. Pure and deterministic. */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Wilson score interval for a hit rate; returns fractions 0..1. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** t-statistic of the mean against `mu0`. */
export function tStat(xs: number[], mu0 = 0): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return sd > 0 ? (m - mu0) / (sd / Math.sqrt(n)) : 0;
}

/** Deterministic PRNG (mulberry32) so results do not change between runs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-sided bootstrap p-value that the mean of `xs` differs from `mu0` (the baseline mean, treated as known:
 * the baseline has far more samples than the events). Resamples the events, centred on mu0 under the null.
 */
export function bootstrapP(xs: number[], mu0 = 0, iters = 2000, seed = 12345): number {
  const n = xs.length;
  if (n < 2) return 1;
  const m = mean(xs);
  const centred = xs.map((x) => x - m + mu0);
  const rand = rng(seed);
  let extreme = 0;
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += centred[(rand() * n) | 0];
    if (Math.abs(s / n - mu0) >= Math.abs(m - mu0) - 1e-12) extreme++;
  }
  return (extreme + 1) / (iters + 1);
}

/** Benjamini-Hochberg adjusted p-values (q-values), in the input order. */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    prev = Math.min(prev, (order[r].p * m) / (r + 1));
    q[order[r].i] = prev;
  }
  return q;
}

/** Sum of gains over sum of losses; Infinity when there are no losses, 0 when no trades. */
export function profitFactor(rets: number[]): number {
  let g = 0;
  let l = 0;
  for (const r of rets) {
    if (r > 0) g += r;
    else l -= r;
  }
  return l > 0 ? g / l : g > 0 ? Infinity : 0;
}

/** Largest peak-to-trough fall of the cumulative sum of returns (percentage points, positive number). Input in trade order. */
export function maxDrawdown(rets: number[]): number {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rets) {
    cum += r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

export interface Accuracy {
  n: number;
  /** hit rate, percent */
  hit: number;
  hitLo: number;
  hitHi: number;
  mean: number;
  median: number;
  t: number;
  /** bootstrap p-value of mean return vs the baseline mean */
  p: number;
  pf: number;
  maxDD: number;
}

/** Accuracy figures for trade returns (percent, in exit order) against a baseline average return. */
export function accuracy(rets: number[], baselineMean: number, iters = 2000): Accuracy {
  const n = rets.length;
  if (!n) return { n: 0, hit: 0, hitLo: 0, hitHi: 0, mean: 0, median: 0, t: 0, p: 1, pf: 0, maxDD: 0 };
  const wins = rets.filter((r) => r > 0).length;
  const w = wilson(wins, n);
  const s = [...rets].sort((a, b) => a - b);
  const med = n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2;
  return {
    n,
    hit: (wins / n) * 100,
    hitLo: w.lo * 100,
    hitHi: w.hi * 100,
    mean: mean(rets),
    median: med,
    t: tStat(rets, baselineMean),
    p: bootstrapP(rets, baselineMean, iters),
    pf: profitFactor(rets),
    maxDD: maxDrawdown(rets),
  };
}
