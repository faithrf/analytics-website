import { CONTRACT_RE } from "@/lib/options";
import { isValidId } from "@/lib/symbols";

/**
 * Simulated ("test") trades. Everything here is pure so it can be unit tested;
 * lib/use-trades.ts wires it to storage and the page fetches the daily bars.
 *
 * Dates are day-resolution: startMs/endMs are UTC midnight of the calendar day
 * picked, and daily bars carry the same convention (UTC midnight of the exchange's
 * local trading date, see getDaily), so they compare directly.
 */
export const TRADES_KEY = "meridian-trades-v1";
export const MAX_TRADES = 50;
export const MAX_AMOUNT = 1_000_000_000;
export const MAX_TARGET_PCT = 1000;
export const MAX_STOP_PCT = 99;

export const DAY_MS = 86_400_000;

export type Side = "long" | "short" | "put" | "call";
export const isOption = (side: Side): boolean => side === "put" || side === "call";
export type PriceSource = "real" | "est";
/** Sold options: take profit is at most 100% of the premium; the stop can be well above it. */
export const MAX_SOLD_TARGET_PCT = 100;
export const MAX_SOLD_STOP_PCT = 1000;
export const RISK_FREE = 0.04;
export const DEFAULT_SIGMA = 0.3;
export const MIN_SIGMA = 0.05;
export const MAX_SIGMA = 3;
export const MAX_EXPIRY_MS = 2 * 365 * DAY_MS;
export const YEAR_MS = 365 * DAY_MS;
/** Calendar days of history to load before a put's start so volatility can be estimated. */
export const VOL_LOOKBACK_DAYS = 60;
const VOL_BARS = 30;
const MIN_VOL_RETURNS = 10;

export interface Trade {
  id: string;
  /** long (default), short, or a put/call option (bought, or sold when `sold` is set) */
  side: Side;
  /** put/call only: the trade writes (sells) the option; `amount` is the premium to collect */
  sold?: boolean;
  /** stock id, see lib/symbols.ts */
  symbol: string;
  /** money put in, in the stock's quote currency */
  amount: number;
  /** "Today" trades: UTC midnight of the viewer's calendar day. Backdated: the chosen date. */
  startMs: number;
  /** Entry price fixed at creation for "Today" trades; backdated trades take it from the bars. */
  entryPrice?: number;
  /** percent above entry that closes the trade */
  targetPct?: number;
  /** percent below entry that closes the trade */
  stopPct?: number;
  endMs?: number;
  /** option only: strike as a percent of the entry price (50-150, default 100) */
  strikePct?: number;
  /** option only: absolute strike of a real contract (wins over strikePct) */
  strike?: number;
  /** option only: expiry day (UTC midnight), 1 day to 2 years after the start; acts as the end date */
  expiryMs?: number;
  /** option only: annualised volatility fixed at entry (Yahoo implied vol for real contracts) */
  sigma?: number;
  /** option only: "real" = priced from a Yahoo contract (contractSymbol + premium set), else a Black-Scholes estimate */
  priceSource?: PriceSource;
  contractSymbol?: string;
  /** real option only: entry premium per share */
  premium?: number;
  /** Manual close: when (real time) and at what price. */
  closedMs?: number;
  closePrice?: number;
  /** real option only: the contract's value per share when closed manually */
  closeOptValue?: number;
  createdMs: number;
  /** Journal: why the trade was taken (required for new trades; absent on older saved ones). */
  reason?: string;
  /** Journal: review done after the trade finished. */
  review?: TradeReview;
}

export type Verdict = "yes" | "partly" | "no";
export const VERDICTS: Verdict[] = ["yes", "partly", "no"];
export interface TradeReview {
  /** "Was I right for the right reason?" */
  verdict: Verdict;
  note?: string;
}
export const MAX_REASON_LEN = 500;

export interface Bar {
  t: number;
  high: number;
  low: number;
  close: number;
}

export type TradeStatus = "open" | "target" | "stop" | "ended" | "closed" | "expired";

export interface TradeResult {
  status: TradeStatus;
  /** null until the first trading day on/after a backdated start has closed. For an option: the premium per share. */
  entry: number | null;
  /** null while open. For an option: the option value per share. */
  exit: number | null;
  /** Price the P/L is measured at: the exit, or the current price while open. For an option: option value per share. */
  mark: number | null;
  /** Shares (long/short) or option units. */
  shares: number | null;
  /** option only: strike price */
  strike?: number;
  /** option only: underlying price at entry */
  spot?: number;
  /** option only: volatility used */
  sigma?: number;
  /** option only: a written (sold) option, so no cash goes out */
  sold?: boolean;
  /** option only: worst-case loss; null = unlimited (sold call) */
  maxLoss?: number | null;
  value: number | null;
  pl: number | null;
  plPct: number | null;
  days: number;
}

/** Extra live data for real-priced options: the contract's current mark and its daily closes. */
export interface OptionMarks {
  quote?: number | null;
  bars?: { t: number; close: number }[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const ID_RE = /^[A-Za-z0-9-]{1,32}$/;
const MAX_MS = 4_102_444_800_000; // year 2100

/* ---- Black-Scholes (put prices are estimates, not market quotes) ---- */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, abs error < 1e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function d1d2(s: number, k: number, t: number, r: number, sigma: number): [number, number] {
  const v = sigma * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + (sigma * sigma) / 2) * t) / v;
  return [d1, d1 - v];
}

/** European put value per share. t in years; at t<=0 (or sigma<=0) it is the intrinsic value. */
export function bsPut(s: number, k: number, t: number, r: number, sigma: number): number {
  if (!(s > 0) || !(k > 0)) return 0;
  if (!(t > 0) || !(sigma > 0)) return Math.max(k - s, 0);
  const [d1, d2] = d1d2(s, k, t, r, sigma);
  return Math.max(k * Math.exp(-r * t) * normCdf(-d2) - s * normCdf(-d1), 0);
}

/** European call value per share (used for put-call parity checks). */
export function bsCall(s: number, k: number, t: number, r: number, sigma: number): number {
  if (!(s > 0) || !(k > 0)) return 0;
  if (!(t > 0) || !(sigma > 0)) return Math.max(s - k, 0);
  const [d1, d2] = d1d2(s, k, t, r, sigma);
  return Math.max(s * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2), 0);
}

/** Put or call value per share (bought or sold, the model is the same). */
export function bsOption(call: boolean, s: number, k: number, t: number, r: number, sigma: number): number {
  return call ? bsCall(s, k, t, r, sigma) : bsPut(s, k, t, r, sigma);
}

/**
 * Annualised stdev of daily log returns over the last 30 bars strictly before `beforeMs`.
 * Null when there are too few bars; clamped to 0.05-3.
 */
export function histVol(bars: Bar[], beforeMs: number): number | null {
  const closes = bars
    .filter((b) => finite(b.t) && finite(b.close) && b.close > 0 && b.t < beforeMs)
    .sort((a, b) => a.t - b.t)
    .slice(-VOL_BARS)
    .map((b) => b.close);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  if (rets.length < MIN_VOL_RETURNS) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.min(Math.max(Math.sqrt(variance * 252), MIN_SIGMA), MAX_SIGMA);
}

/** Validates and clamps stored trades. Accepts a parsed array or a JSON string; never throws. */
export function parseTrades(raw: unknown): Trade[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: Trade[] = [];
  for (const item of list) {
    if (out.length >= MAX_TRADES) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const symbol = typeof r.symbol === "string" ? r.symbol.toUpperCase() : "";
    if (typeof r.id !== "string" || !ID_RE.test(r.id) || out.some((t) => t.id === r.id)) continue;
    if (!isValidId(symbol) || !positive(r.amount) || !finite(r.startMs) || r.startMs < 0 || r.startMs > MAX_MS) continue;
    const startMs = r.startMs;
    const side: Side = r.side === "short" || r.side === "put" || r.side === "call" ? r.side : "long";
    const sold = isOption(side) && r.sold === true;
    const trade: Trade = {
      id: r.id,
      side,
      symbol,
      amount: Math.min(r.amount, MAX_AMOUNT),
      startMs,
      createdMs: finite(r.createdMs) && r.createdMs >= 0 && r.createdMs <= MAX_MS ? r.createdMs : startMs,
    };
    if (sold) trade.sold = true;
    if (positive(r.entryPrice)) trade.entryPrice = r.entryPrice;
    if (positive(r.targetPct)) trade.targetPct = Math.min(r.targetPct, sold ? MAX_SOLD_TARGET_PCT : MAX_TARGET_PCT);
    if (positive(r.stopPct)) trade.stopPct = Math.min(r.stopPct, sold ? MAX_SOLD_STOP_PCT : MAX_STOP_PCT);
    if (isOption(side)) {
      if (!finite(r.expiryMs) || r.expiryMs < startMs + DAY_MS || r.expiryMs > startMs + MAX_EXPIRY_MS) continue;
      trade.expiryMs = r.expiryMs;
      trade.strikePct = finite(r.strikePct) && r.strikePct >= 50 && r.strikePct <= 150 ? r.strikePct : 100;
      if (positive(r.sigma)) trade.sigma = Math.min(Math.max(r.sigma, MIN_SIGMA), MAX_SIGMA);
      if (r.priceSource === "real" && typeof r.contractSymbol === "string" && CONTRACT_RE.test(r.contractSymbol) && positive(r.premium) && positive(r.strike) && positive(r.entryPrice)) {
        trade.priceSource = "real";
        trade.contractSymbol = r.contractSymbol;
        trade.premium = r.premium;
        trade.strike = r.strike;
        if (positive(r.closeOptValue)) trade.closeOptValue = r.closeOptValue;
      } else {
        trade.priceSource = "est";
      }
    } else if (finite(r.endMs) && r.endMs > startMs && r.endMs <= MAX_MS) {
      trade.endMs = r.endMs;
    }
    if (finite(r.closedMs) && r.closedMs >= 0 && r.closedMs <= MAX_MS && positive(r.closePrice)) {
      trade.closedMs = r.closedMs;
      trade.closePrice = r.closePrice;
    }
    if (typeof r.reason === "string" && r.reason.trim()) trade.reason = r.reason.trim().slice(0, MAX_REASON_LEN);
    const rv = r.review as Record<string, unknown> | undefined;
    if (rv && typeof rv === "object" && VERDICTS.includes(rv.verdict as Verdict)) {
      trade.review = { verdict: rv.verdict as Verdict };
      if (typeof rv.note === "string" && rv.note.trim()) trade.review.note = rv.note.trim().slice(0, MAX_REASON_LEN);
    }
    out.push(trade);
  }
  return out;
}

/** UTC midnight of the viewer's local calendar day. */
export const todayStartMs = (now: number): number => {
  const d = new Date(now);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Plays a trade against daily bars. Status is derived, never stored, except a manual close.
 * - entry: the stored price ("Today"), else the close of the first bar on/after the start date.
 * - bars after the entry day are scanned in order; the stop is checked before the target, so a
 *   day that touches both counts as the stop (conservative). Exit is the level, not the bar price.
 * - the end date closes at the close of the first bar on/after it.
 * - otherwise the trade stays open, marked at the live price (or the latest close).
 * A "Today" trade ignores its entry day's bar, which holds moves from before it was placed.
 */
export function evaluate(trade: Trade, bars: Bar[], livePrice: number | null | undefined, now: number, opt?: OptionMarks): TradeResult {
  const sorted = bars.filter((b) => finite(b.t) && finite(b.high) && finite(b.low) && finite(b.close)).sort((a, b) => a.t - b.t);
  let entry: number | null = null;
  let entryMs = trade.startMs;
  let scanAfter = trade.startMs;
  if (positive(trade.entryPrice)) {
    entry = trade.entryPrice;
  } else {
    const first = sorted.find((b) => b.t >= trade.startMs);
    if (first) {
      entry = first.close;
      entryMs = first.t;
      scanAfter = first.t;
    }
  }
  const empty = (status: TradeStatus): TradeResult => ({ status, entry, exit: null, mark: null, shares: null, value: null, pl: null, plPct: null, days: 0 });
  if (entry === null || !(entry > 0)) return empty("open");

  const closed = finite(trade.closedMs) && positive(trade.closePrice);
  const current = positive(livePrice) ? livePrice : sorted.length ? sorted[sorted.length - 1].close : entry;
  const daysTo = (exitMs: number | null) => Math.max(0, Math.floor(((exitMs ?? now) - entryMs) / DAY_MS));

  if (isOption(trade.side) && trade.expiryMs !== undefined) {
    // Put or call, bought or sold. Priced from the stored Yahoo premium (real) or Black-Scholes (est.).
    // Take profit / stop loss apply to the option value vs the premium, on daily closes. For a sold
    // option "profit" is the value falling, so the directions flip.
    const call = trade.side === "call";
    const sold = trade.sold === true;
    const real = trade.priceSource === "real" && positive(trade.premium);
    const expiry = trade.expiryMs;
    const strike = positive(trade.strike) ? trade.strike : (entry * (trade.strikePct ?? 100)) / 100;
    const sigma = trade.sigma ?? histVol(sorted, trade.startMs) ?? DEFAULT_SIGMA;
    const valueAt = (price: number, atMs: number) => bsOption(call, price, strike, (expiry - atMs) / YEAR_MS, RISK_FREE, sigma);
    const intrinsic = (price: number) => Math.max(call ? price - strike : strike - price, 0);
    const premium = real ? trade.premium! : valueAt(entry, entryMs);
    if (!(premium > 0)) return empty("open");
    const units = trade.amount / premium;
    const contractClose = new Map<number, number>();
    if (real) for (const b of opt?.bars ?? []) if (finite(b.t) && positive(b.close)) contractClose.set(b.t, b.close);
    const stopLevel = trade.stopPct ? premium * (sold ? 1 + trade.stopPct / 100 : 1 - trade.stopPct / 100) : null;
    const targetLevel = trade.targetPct ? premium * (sold ? 1 - trade.targetPct / 100 : 1 + trade.targetPct / 100) : null;
    const hitStop = (v: number) => stopLevel !== null && (sold ? v >= stopLevel : v <= stopLevel);
    const hitTarget = (v: number) => targetLevel !== null && (sold ? v <= targetLevel : v >= targetLevel);

    let status: TradeStatus = "open";
    let exit: number | null = null;
    let exitMs: number | null = null;
    for (const b of sorted) {
      if (b.t <= scanAfter) continue;
      if (closed && b.t > trade.closedMs!) break;
      const v = contractClose.get(b.t) ?? valueAt(b.close, b.t);
      if (b.t >= expiry) {
        status = "expired";
        exit = intrinsic(b.close);
      } else if (hitStop(v)) {
        status = "stop";
        exit = v;
      } else if (hitTarget(v)) {
        status = "target";
        exit = v;
      }
      if (exit !== null) {
        exitMs = b.t;
        break;
      }
    }
    if (exit === null && closed) {
      status = "closed";
      exit = real && positive(trade.closeOptValue) ? trade.closeOptValue : valueAt(trade.closePrice!, trade.closedMs!);
      exitMs = trade.closedMs!;
    }
    const mark = exit ?? (real && positive(opt?.quote) ? opt.quote : valueAt(current, Math.min(now, expiry)));
    const pl = (sold ? premium - mark : mark - premium) * units;
    const maxLoss = sold ? (call ? null : Math.max(strike - premium, 0) * units) : trade.amount;
    return {
      status,
      entry: premium,
      exit,
      mark,
      shares: units,
      strike,
      spot: entry,
      sigma,
      sold,
      maxLoss,
      value: sold ? trade.amount + pl : units * mark,
      pl,
      plPct: (pl / trade.amount) * 100,
      days: daysTo(exitMs),
    };
  }

  const short = trade.side === "short";
  const stopLevel = trade.stopPct ? entry * (short ? 1 + trade.stopPct / 100 : 1 - trade.stopPct / 100) : null;
  const targetLevel = trade.targetPct ? entry * (short ? 1 - trade.targetPct / 100 : 1 + trade.targetPct / 100) : null;

  let status: TradeStatus = "open";
  let exit: number | null = null;
  let exitMs: number | null = null;
  for (const b of sorted) {
    if (b.t <= scanAfter) continue;
    if (closed && b.t > trade.closedMs!) break;
    if (stopLevel !== null && (short ? b.high >= stopLevel : b.low <= stopLevel)) {
      status = "stop";
      exit = stopLevel;
    } else if (targetLevel !== null && (short ? b.low <= targetLevel : b.high >= targetLevel)) {
      status = "target";
      exit = targetLevel;
    } else if (trade.endMs !== undefined && b.t >= trade.endMs) {
      status = "ended";
      exit = b.close;
    }
    if (exit !== null) {
      exitMs = b.t;
      break;
    }
  }
  if (exit === null && closed) {
    status = "closed";
    exit = trade.closePrice!;
    exitMs = trade.closedMs!;
  }

  const mark = exit ?? current;
  const shares = trade.amount / entry;
  const pl = (short ? entry - mark : mark - entry) * shares;
  return { status, entry, exit, mark, shares, value: trade.amount + pl, pl, plPct: (pl / trade.amount) * 100, days: daysTo(exitMs) };
}

export interface TradeSummary {
  count: number;
  invested: number;
  pl: number;
  winRate: number | null;
}

/** Totals over trades that have a result. Win rate = share of them with P/L above zero. */
export function summarise(results: (TradeResult | null)[]): TradeSummary {
  let count = 0;
  let invested = 0;
  let pl = 0;
  let wins = 0;
  let scored = 0;
  for (const r of results) {
    if (!r || r.pl === null || r.shares === null || r.entry === null) continue;
    scored++;
    if (!r.sold) invested += r.shares * r.entry; // a sold option takes in premium; no cash goes out
    pl += r.pl;
    if (r.pl > 0) wins++;
  }
  count = results.length;
  return { count, invested, pl, winRate: scored ? (wins / scored) * 100 : null };
}
