import { fmtNum, fmtPct, fmtSigned, isNum, priceDigits } from "@/lib/format";
import { clockIn } from "@/lib/market-hours";
import { region } from "@/lib/markets";
import { displayCode, fromYahoo, regionOf } from "@/lib/symbols";

/**
 * Push-alert decisions. Pure, so it can be unit tested; the Redis and web-push
 * plumbing lives in lib/alerts-store.ts and lib/push.ts.
 */
export interface AlertSettings {
  enabled: boolean;
  /** alert when the day move reaches this many percent, up or down */
  movePct: number;
  /** second alert at this larger move */
  bigMovePct: number;
  /** alert on a new 52-week high or low */
  hiLo: boolean;
}

export const DEFAULT_ALERTS: AlertSettings = { enabled: false, movePct: 5, bigMovePct: 10, hiLo: true };
export const MIN_MOVE = 0.5;
export const MAX_MOVE = 50;
/** A quote older than this (ms) is not acted on; Yahoo delays some exchanges by 15-20 minutes. */
export const MAX_QUOTE_AGE_MS = 45 * 60_000;
/** How long a sent alert is remembered; longer than a trading day so it can't repeat. */
export const DEDUPE_TTL_SECONDS = 36 * 3600;

const clampPct = (v: unknown, fallback: number) =>
  isNum(v) ? Math.min(Math.max(Math.round(v * 10) / 10, MIN_MOVE), MAX_MOVE) : fallback;

/** Validates saved or posted settings; unknown or bad fields fall back to defaults. Never throws. */
export function parseAlertSettings(raw: unknown): AlertSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const movePct = clampPct(o.movePct, DEFAULT_ALERTS.movePct);
  const bigMovePct = Math.max(clampPct(o.bigMovePct, DEFAULT_ALERTS.bigMovePct), movePct);
  return {
    enabled: o.enabled === true,
    movePct,
    bigMovePct,
    hiLo: typeof o.hiLo === "boolean" ? o.hiLo : DEFAULT_ALERTS.hiLo,
  };
}

/** The fields of a quote the decision needs (a subset of QuoteDTO). */
export interface AlertQuote {
  /** Yahoo symbol, e.g. "BHP.AX" */
  symbol: string;
  price: number | null;
  changePct: number | null;
  high52: number | null;
  low52: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  marketState: string | null;
  time: number | null;
  // optional extras that make the message more useful
  name?: string | null;
  change?: number | null;
  currency?: string | null;
  volume?: number | null;
  avgVolume?: number | null;
}

/** Where the user follows the stock, and a fresh headline, added to the message when known. */
export interface AlertContext {
  boards?: string[];
  inTrade?: boolean;
  headline?: { title: string; publisher: string } | null;
}

/** Message lines shared by every alert for a quote: price detail, volume, 52-week position, why you follow it, news. */
export function contextLines(q: AlertQuote, ctx: AlertContext = {}): string[] {
  const digits = priceDigits(q.price, q.symbol);
  const lines: string[] = [];
  const cur = q.currency ? ` ${q.currency}` : "";
  if (isNum(q.price)) {
    const chg = isNum(q.change) ? `, ${fmtSigned(q.change, digits).replace(/^([+−])/, "$1$")} today` : "";
    lines.push(`$${fmtNum(q.price, digits)}${cur}${chg}`);
  }
  const facts: string[] = [];
  if (isNum(q.volume) && isNum(q.avgVolume) && q.avgVolume > 0) {
    const x = q.volume / q.avgVolume;
    if (x >= 1.5) facts.push(`volume ${x.toFixed(1)}× normal`);
    else if (x < 0.5) facts.push("light volume so far");
  }
  if (isNum(q.price) && isNum(q.high52) && isNum(q.low52) && q.high52 > q.low52) {
    if (q.price < q.high52) {
      const off = ((q.high52 - q.price) / q.high52) * 100;
      facts.push(off < 1 ? "at its 52-wk high" : `${off.toFixed(0)}% below 52-wk high`);
    }
  }
  if (facts.length) lines.push(facts.join(" · ").replace(/^./, (c) => c.toUpperCase()));
  const where = [...(ctx.inTrade ? ["open trade"] : []), ...(ctx.boards ?? [])];
  if (where.length) lines.push(`In ${where.join(", ")}`);
  if (ctx.headline) lines.push(`News: ${ctx.headline.title} (${ctx.headline.publisher})`);
  return lines;
}

/** Market open (Yahoo's marketState) and the last trade recent enough to trust. */
export function isLive(q: AlertQuote, nowMs: number): boolean {
  if (q.marketState !== "REGULAR" || !isNum(q.time)) return false;
  const age = nowMs - q.time;
  return age >= -5 * 60_000 && age <= MAX_QUOTE_AGE_MS;
}

/** Exchange-local trading date, "YYYY-MM-DD", of the quote's last trade. */
export function tradingDay(symbol: string, timeMs: number): string {
  const c = clockIn(region(regionOf(fromYahoo(symbol))).tz, new Date(timeMs));
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

export type AlertLevel = "move" | "big" | "high52" | "low52";

export interface Alert {
  symbol: string;
  level: AlertLevel;
  dir: "up" | "down";
  title: string;
  body: string;
  /** dedupe keys to mark as sent; a big move also marks the smaller level */
  keys: string[];
}

const dedupeKey = (level: AlertLevel, dir: string) => `${level}:${dir}`;
/** Dedupe key for the nth movePct step in one direction, e.g. "move:up:2" for +10% at 5% steps. */
export const stepKey = (dir: "up" | "down", n: number) => `move:${dir}:${n}`;
/** Steps marked as used when one alert jumps several; enough for any realistic day. */
const MAX_STEP_KEYS = 200;

/** Alerts a quote warrants right now. `sent` holds the dedupe keys already used today. */
export function decideAlerts(
  q: AlertQuote,
  s: AlertSettings,
  nowMs: number,
  sent: ReadonlySet<string> = new Set(),
  ctx: AlertContext = {},
): Alert[] {
  if (!s.enabled || !isLive(q, nowMs) || !isNum(q.price)) return [];
  const out: Alert[] = [];
  const digits = priceDigits(q.price, q.symbol);
  const price = `$${fmtNum(q.price, digits)}`;
  const code = displayCode(fromYahoo(q.symbol));
  const who = q.name ? ` · ${q.name}` : "";
  const extra = contextLines(q, ctx);
  const make = (level: AlertLevel, dir: "up" | "down", title: string, lead: string, keys: string[]): void => {
    if (!sent.has(keys[0])) out.push({ symbol: q.symbol, level, dir, title, body: [lead, ...extra].join("\n"), keys });
  };

  if (isNum(q.changePct)) {
    const pct = q.changePct;
    const dir = pct >= 0 ? "up" : "down";
    const arrow = dir === "up" ? "▲" : "▼";
    const extreme = dir === "up" ? q.dayHigh : q.dayLow;
    const lead = `${dir === "up" ? "Up" : "Down"} ${fmtPct(Math.abs(pct), 1).replace(/^\+/, "")} today` +
      (isNum(extreme) ? ` (day ${dir === "up" ? "high" : "low"} $${fmtNum(extreme, digits)})` : "");
    const title = `${code} ${arrow} ${fmtPct(pct, 1)}${who}`;
    // One alert per step of movePct (5%, 10%, 15%...). Jumping several steps sends one alert and uses up
    // the steps below it, so falling back through a level already passed never repeats.
    const step = Math.floor(Math.abs(pct) / s.movePct + 1e-9);
    if (step >= 1) {
      const big = Math.abs(pct) >= s.bigMovePct;
      const keys = Array.from({ length: Math.min(step, MAX_STEP_KEYS) }, (_, i) => stepKey(dir, step - i));
      make(big ? "big" : "move", dir, title, big ? `Big move: ${lead[0].toLowerCase()}${lead.slice(1)}` : lead, keys);
    }
  }

  if (s.hiLo) {
    const day = isNum(q.changePct) ? `, ${fmtPct(q.changePct, 1)} today` : "";
    if (isNum(q.high52) && q.price >= q.high52) {
      make("high52", "up", `${code} new 52-week high${who}`, `Hit ${price}${day}, above the old high of $${fmtNum(q.high52, digits)}`, [dedupeKey("high52", "up")]);
    }
    if (isNum(q.low52) && q.price <= q.low52) {
      make("low52", "down", `${code} new 52-week low${who}`, `Fell to ${price}${day}, below the old low of $${fmtNum(q.low52, digits)}`, [dedupeKey("low52", "down")]);
    }
  }
  return out;
}

/** Redis key remembering that this alert went out today (exchange-local day). */
export const sentKey = (userId: string, symbol: string, key: string, day: string) => `alerts:sent:${userId}:${symbol}:${key}:${day}`;
