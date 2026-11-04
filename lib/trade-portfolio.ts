import { greeks } from "@/lib/trade-insights";
import { isOption, RISK_FREE, YEAR_MS, type Trade, type TradeResult } from "@/lib/trades";

/** One trade with its evaluated result and the underlying's current price (null when unknown). */
export interface PortfolioRow {
  trade: Trade;
  result: TradeResult | null;
  price: number | null;
}

export interface NetPosition {
  symbol: string;
  /** signed share-equivalents: positive = bullish (long), negative = bearish (short) */
  shares: number;
  direction: "bullish" | "bearish" | "flat";
  trades: number;
  /** true when any option leg fell back to the intrinsic-value sign (no usable delta) */
  approx: boolean;
}

/**
 * Share-equivalent of one open trade. Stocks: +/- shares. Options: Black-Scholes delta x units
 * (units = amount / premium = 100 x contracts), sign flipped for sold options. When delta cannot
 * be computed the approximation is 1 if the option is in the money, else 0, with the same sign rule.
 */
export function shareEquivalent(trade: Trade, result: TradeResult, price: number | null, now: number): { shares: number; approx: boolean } | null {
  if (result.status !== "open" || result.shares === null || result.entry === null) return null;
  if (!isOption(trade.side)) return { shares: trade.side === "short" ? -result.shares : result.shares, approx: false };
  const call = trade.side === "call";
  const spot = price ?? result.spot ?? null;
  if (spot === null || result.strike === undefined) return null;
  const t = trade.expiryMs !== undefined ? (trade.expiryMs - now) / YEAR_MS : 0;
  const g = result.sigma !== undefined ? greeks(call, spot, result.strike, t, RISK_FREE, result.sigma) : null;
  const delta = g ? g.delta : (call ? spot > result.strike : spot < result.strike) ? (call ? 1 : -1) : 0;
  const sign = trade.sold ? -1 : 1;
  return { shares: sign * delta * result.shares, approx: !g };
}

/** Net direction per stock across open trades, largest absolute exposure first. */
export function netPositions(rows: PortfolioRow[], now: number): NetPosition[] {
  const by = new Map<string, NetPosition>();
  for (const { trade, result, price } of rows) {
    if (!result) continue;
    const eq = shareEquivalent(trade, result, price, now);
    if (!eq) continue;
    const p = by.get(trade.symbol) ?? { symbol: trade.symbol, shares: 0, direction: "flat" as const, trades: 0, approx: false };
    p.shares += eq.shares;
    p.trades++;
    p.approx ||= eq.approx;
    by.set(trade.symbol, p);
  }
  return [...by.values()]
    .map((p) => ({ ...p, direction: Math.abs(p.shares) < 0.5 ? ("flat" as const) : p.shares > 0 ? ("bullish" as const) : ("bearish" as const) }))
    .sort((a, b) => Math.abs(b.shares) - Math.abs(a.shares));
}

export interface ClosedStats {
  count: number;
  winRate: number | null;
  /** average P/L of winning trades (positive) and of losing trades (negative) */
  avgWin: number | null;
  avgLoss: number | null;
  byStrategy: { label: string; count: number; pl: number }[];
}

export function strategyLabel(t: Trade): string {
  if (t.side === "long") return "Buy shares";
  if (t.side === "short") return "Short";
  return `${t.sold ? "Sell" : "Buy"} ${t.side}`;
}

/** Stats over finished (non-open) trades with a P/L. */
export function closedStats(rows: PortfolioRow[]): ClosedStats {
  const wins: number[] = [];
  const losses: number[] = [];
  const by = new Map<string, { count: number; pl: number }>();
  let count = 0;
  for (const { trade, result } of rows) {
    if (!result || result.status === "open" || result.pl === null) continue;
    count++;
    (result.pl > 0 ? wins : result.pl < 0 ? losses : []).push(result.pl);
    const k = strategyLabel(trade);
    const cur = by.get(k) ?? { count: 0, pl: 0 };
    cur.count++;
    cur.pl += result.pl;
    by.set(k, cur);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    count,
    winRate: count ? (wins.length / count) * 100 : null,
    avgWin: avg(wins),
    avgLoss: avg(losses),
    byStrategy: [...by].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.pl - a.pl),
  };
}
