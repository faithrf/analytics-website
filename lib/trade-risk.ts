import { bsOption, d1d2, DAY_MS, normCdf } from "@/lib/trades";

/** Pure risk maths for the trade simulator: payoff, scenarios, probabilities, exposure. */

export interface RiskPos {
  /** option leg: true call, false put; null for a plain stock position */
  call: boolean | null;
  /** true when the option was sold (or the stock shorted) */
  sold: boolean;
  /** strike (options) or entry price (stock) */
  strike: number;
  /** option premium per share (options only) */
  premium: number;
  /** shares (options: amount / premium) */
  shares: number;
  /** annualised volatility */
  sigma: number;
}

const R = 0.04;

/** Whole-position P/L if the underlying is `s` with `t` years left (t <= 0: at expiry). */
export function pnlAt(pos: RiskPos, s: number, t: number, r = R): number {
  const sign = pos.sold ? -1 : 1;
  if (pos.call === null) return sign * (s - pos.strike) * pos.shares;
  const v = bsOption(pos.call, s, pos.strike, Math.max(t, 0), r, pos.sigma);
  return sign * (v - pos.premium) * pos.shares;
}

export function breakeven(pos: RiskPos): number {
  if (pos.call === null) return pos.strike;
  return pos.call ? pos.strike + pos.premium : pos.strike - pos.premium;
}

export interface PayoffPoint {
  s: number;
  expiry: number;
  today: number;
}

/** Payoff curves over [lo, hi]; `today` is Black-Scholes with `tYears` left. */
export function payoffCurve(pos: RiskPos, lo: number, hi: number, tYears: number, n = 60): PayoffPoint[] {
  const out: PayoffPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const s = lo + ((hi - lo) * i) / n;
    out.push({ s, expiry: pnlAt(pos, s, 0), today: pnlAt(pos, s, tYears) });
  }
  return out;
}

export const SCENARIO_PCTS = [-5, -2, -1, 0, 1, 2, 5] as const;
export interface Scenario {
  pct: number;
  price: number;
  today: number;
  expiry: number;
}

/** P/L after `daysAhead` days (default 1) and at expiry for each move from spot. */
export function scenarios(pos: RiskPos, spot: number, tYears: number, daysAhead = 1, pcts: readonly number[] = SCENARIO_PCTS): Scenario[] {
  const tLater = Math.max(tYears - daysAhead / 365, 0);
  return pcts.map((pct) => {
    const price = spot * (1 + pct / 100);
    return { pct, price, today: pnlAt(pos, price, tLater), expiry: pnlAt(pos, price, 0) };
  });
}

/** Lognormal chance the underlying finishes above `x` at expiry. */
export function probAbove(s: number, x: number, t: number, r: number, sigma: number): number {
  if (!(x > 0)) return 1;
  if (!(s > 0)) return 0;
  if (!(t > 0) || !(sigma > 0)) return s > x ? 1 : 0;
  return normCdf(d1d2(s, x, t, r, sigma)[1]);
}

export interface Probs {
  /** chance the option finishes out of the money (sold: keep the full premium) */
  otm: number;
  /** chance of any profit at expiry (right side of breakeven) */
  profit: number;
}

export function probs(pos: RiskPos, spot: number, t: number, r = R): Probs | null {
  if (pos.call === null || !(t > 0) || !(pos.sigma > 0)) return null;
  const aboveK = probAbove(spot, pos.strike, t, r, pos.sigma);
  const aboveBe = probAbove(spot, breakeven(pos), t, r, pos.sigma);
  const itm = pos.call ? aboveK : 1 - aboveK;
  const beyondBe = pos.call ? aboveBe : 1 - aboveBe;
  return { otm: 1 - itm, profit: pos.sold ? 1 - beyondBe : beyondBe };
}

/** Black-Scholes gamma per share. */
export function gamma(s: number, k: number, t: number, r: number, sigma: number): number | null {
  if (!(s > 0) || !(k > 0) || !(t > 0) || !(sigma > 0)) return null;
  const d1 = d1d2(s, k, t, r, sigma)[0];
  return Math.exp(-(d1 * d1) / 2) / Math.sqrt(2 * Math.PI) / (s * sigma * Math.sqrt(t));
}

/** Share-equivalent exposure: signed shares (negative = short) and dollar value. */
export function exposure(pos: RiskPos, spot: number, t: number, r = R): { shares: number; dollars: number } | null {
  const sign = pos.sold ? -1 : 1;
  if (pos.call === null) return { shares: sign * pos.shares, dollars: sign * pos.shares * spot };
  if (!(t > 0) || !(spot > 0) || !(pos.strike > 0) || !(pos.sigma > 0)) return null;
  const d1 = d1d2(spot, pos.strike, t, r, pos.sigma)[0];
  const delta = pos.call ? normCdf(d1) : normCdf(d1) - 1;
  const sh = sign * delta * pos.shares;
  return { shares: sh, dollars: sh * spot };
}

/** Plain-English warning when a 1% move shifts delta a lot, or expiry is close and price is near the strike. */
export function gammaWarning(pos: RiskPos, spot: number, t: number, r = R): string | null {
  if (pos.call === null) return null;
  const g = gamma(spot, pos.strike, t, r, pos.sigma);
  if (g === null) return null;
  const deltaShift = g * spot * 0.01;
  const days = t * 365;
  const near = Math.abs(Math.log(spot / pos.strike)) < pos.sigma * Math.sqrt(Math.max(t, 1 / 365));
  if (days < 3 && near) return "Very sensitive to small moves today: expiry is close and the price is near the strike, so this can swing from safe to a big loss or gain within hours.";
  if (deltaShift >= 0.15) return "Very sensitive to small moves: a 1% move in the stock changes how much the option reacts, so profits and losses can speed up quickly.";
  return null;
}

export interface QuoteQuality {
  mid: number | null;
  spread: number | null;
  spreadPct: number | null;
}

export function quoteQuality(bid: number | null | undefined, ask: number | null | undefined): QuoteQuality {
  if (typeof bid !== "number" || typeof ask !== "number" || !(bid > 0) || !(ask >= bid)) return { mid: null, spread: null, spreadPct: null };
  const mid = (bid + ask) / 2;
  return { mid, spread: ask - bid, spreadPct: (ask - bid) / mid };
}

/** Earnings / ex-dividend dates falling after `nowMs` and up to the expiry day. */
export function eventsBeforeExpiry(nowMs: number, expiryMs: number, earningsMs: number | null, exDivMs: number | null): { earnings: number | null; exDiv: number | null } {
  const within = (ms: number | null) => (ms !== null && ms > nowMs && ms <= expiryMs + DAY_MS ? ms : null);
  return { earnings: within(earningsMs), exDiv: within(exDivMs) };
}

export interface StrikeRow {
  strike: number;
  premium: number;
  breakeven: number;
  /** chance of profit at expiry (sold: staying safe) */
  safe: number | null;
  /** chance of finishing out of the money */
  otm: number | null;
}

/** Up to `count` strikes around `k` from rows carrying the mid and optional iv. */
export function compareStrikes(
  rows: { strike: number; mid: number | null; iv: number | null }[],
  opts: { call: boolean; sold: boolean; spot: number; t: number; k: number; sigma: number; count?: number; r?: number },
): StrikeRow[] {
  const { call, sold, spot, t, k, sigma, count = 5, r = R } = opts;
  const usable = rows.filter((x) => x.mid !== null && x.mid > 0).sort((a, b) => a.strike - b.strike);
  if (usable.length === 0) return [];
  let at = 0;
  usable.forEach((x, i) => {
    if (Math.abs(x.strike - k) < Math.abs(usable[at].strike - k)) at = i;
  });
  const start = Math.min(Math.max(at - Math.floor(count / 2), 0), Math.max(usable.length - count, 0));
  return usable.slice(start, start + count).map((x) => {
    const pos: RiskPos = { call, sold, strike: x.strike, premium: x.mid as number, shares: 1, sigma: x.iv && x.iv > 0 ? x.iv : sigma };
    const p = probs(pos, spot, t, r);
    return { strike: x.strike, premium: x.mid as number, breakeven: breakeven(pos), safe: p ? p.profit : null, otm: p ? p.otm : null };
  });
}
