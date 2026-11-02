import { d1d2, DAY_MS, normCdf } from "@/lib/trades";

/** Horizon (trading days) used for plain shares, which have no expiry: one week. */
export const SHARE_HORIZON = 5;
const MIN_WINDOWS = 20;
const YEAR_BARS = 260;
const MONTH_BARS = 21;

/** Trading days between two dates: calendar days * 5/7, rounded, at least 1. */
export function tradingDaysBetween(fromMs: number, toMs: number): number {
  return Math.max(1, Math.round(((toMs - fromMs) / DAY_MS) * (5 / 7)));
}

/** Fractional change over every rolling `n`-bar window (close[i+n] / close[i] - 1). */
export function windowMoves(closes: number[], n: number): number[] {
  const out: number[] = [];
  if (!(n >= 1)) return out;
  for (let i = 0; i + n < closes.length; i++) {
    if (closes[i] > 0 && closes[i + n] > 0) out.push(closes[i + n] / closes[i] - 1);
  }
  return out;
}

/** Linear-interpolated percentile (p 0-1) of an unsorted list. Null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Share of moves that reached `needed`: at or above it for a rise (the default when needed >= 0), at or below it for a fall. */
export function hitRate(moves: number[], needed: number, above = needed >= 0): number | null {
  if (moves.length === 0) return null;
  const hits = moves.filter((m) => (above ? m >= needed : m <= needed)).length;
  return hits / moves.length;
}

export interface MoveStats {
  /** mean absolute fractional move */
  typical: number;
  /** 10th and 90th percentile fractional moves */
  p10: number;
  p90: number;
  moves: number[];
}

/** Move statistics over `n`-bar windows of the last ~year of closes. Null when there is too little history. */
export function moveStats(closes: number[], n: number): MoveStats | null {
  const moves = windowMoves(closes.slice(-YEAR_BARS), n);
  if (moves.length < MIN_WINDOWS) return null;
  const p10 = percentile(moves, 0.1);
  const p90 = percentile(moves, 0.9);
  if (p10 === null || p90 === null) return null;
  return { typical: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length, p10, p90, moves };
}

/** Change over the last ~month (21 bars) of closes, as a fraction. Null when too short. */
export function monthChange(closes: number[]): number | null {
  if (closes.length <= MONTH_BARS) return null;
  const a = closes[closes.length - 1 - MONTH_BARS];
  const b = closes[closes.length - 1];
  return a > 0 && b > 0 ? b / a - 1 : null;
}

/** Where the last close sits in the 52-week low-high range, 0 (at the low) to 1 (at the high). */
export function rangePosition(closes: number[]): number | null {
  const yr = closes.slice(-YEAR_BARS);
  if (yr.length < MONTH_BARS) return null;
  const lo = Math.min(...yr);
  const hi = Math.max(...yr);
  return hi > lo ? (yr[yr.length - 1] - lo) / (hi - lo) : null;
}

/** Market-implied 1-sigma move by expiry: price * iv * sqrt(calendarDays / 365). */
export function impliedMove(price: number, iv: number, calendarDays: number): { dollars: number; pct: number } {
  const pct = iv * Math.sqrt(Math.max(calendarDays, 0) / 365);
  return { dollars: price * pct, pct };
}

export interface Greeks {
  /** per share, long position: call 0..1, put -1..0 */
  delta: number;
  /** risk-neutral chance the option finishes in the money */
  probItm: number;
  /** option value lost per share per calendar day (negative for a long) */
  thetaDay: number;
}

/** Black-Scholes delta, in-the-money chance and theta for one share. t in years. Null on bad inputs. */
export function greeks(call: boolean, s: number, k: number, t: number, r: number, sigma: number): Greeks | null {
  if (!(s > 0) || !(k > 0) || !(t > 0) || !(sigma > 0)) return null;
  const [d1, d2] = d1d2(s, k, t, r, sigma);
  const pdf = Math.exp(-(d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  const decay = -(s * pdf * sigma) / (2 * Math.sqrt(t));
  const carry = r * k * Math.exp(-r * t);
  const thetaYear = call ? decay - carry * normCdf(d2) : decay + carry * normCdf(-d2);
  return {
    delta: call ? normCdf(d1) : normCdf(d1) - 1,
    probItm: call ? normCdf(d2) : normCdf(-d2),
    thetaDay: thetaYear / 365,
  };
}
