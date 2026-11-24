import { fmtNum, fmtPct, isNum, priceDigits } from "@/lib/format";
import { clockIn } from "@/lib/market-hours";
import { region } from "@/lib/markets";
import { fromYahoo, regionOf } from "@/lib/symbols";

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

/** Alerts a quote warrants right now. `sent` holds the dedupe keys already used today. */
export function decideAlerts(q: AlertQuote, s: AlertSettings, nowMs: number, sent: ReadonlySet<string> = new Set()): Alert[] {
  if (!s.enabled || !isLive(q, nowMs) || !isNum(q.price)) return [];
  const out: Alert[] = [];
  const digits = priceDigits(q.price, q.symbol);
  const price = `$${fmtNum(q.price, digits)}`;
  const make = (level: AlertLevel, dir: "up" | "down", title: string, body: string, keys: string[]): void => {
    if (!sent.has(keys[0])) out.push({ symbol: q.symbol, level, dir, title, body, keys });
  };

  if (isNum(q.changePct)) {
    const pct = q.changePct;
    const dir = pct >= 0 ? "up" : "down";
    const extreme = dir === "up" ? q.dayHigh : q.dayLow;
    const tail = isNum(extreme) ? ` (day ${dir === "up" ? "high" : "low"} $${fmtNum(extreme, digits)})` : "";
    const body = `${q.symbol} ${fmtPct(pct, 1)} to ${price}${tail}`;
    const moveKey = dedupeKey("move", dir);
    const bigKey = dedupeKey("big", dir);
    if (Math.abs(pct) >= s.bigMovePct) {
      // jumping straight past both levels sends only the bigger alert and uses up the smaller one
      make("big", dir, `${q.symbol} big move`, body, [bigKey, moveKey]);
    } else if (Math.abs(pct) >= s.movePct && !sent.has(bigKey)) {
      make("move", dir, `${q.symbol} moving`, body, [moveKey]);
    }
  }

  if (s.hiLo) {
    if (isNum(q.high52) && q.price >= q.high52) {
      make("high52", "up", `${q.symbol} 52-week high`, `${q.symbol} hit a new 52-week high of ${price}`, [dedupeKey("high52", "up")]);
    }
    if (isNum(q.low52) && q.price <= q.low52) {
      make("low52", "down", `${q.symbol} 52-week low`, `${q.symbol} hit a new 52-week low of ${price}`, [dedupeKey("low52", "down")]);
    }
  }
  return out;
}

/** Redis key remembering that this alert went out today (exchange-local day). */
export const sentKey = (userId: string, symbol: string, key: string, day: string) => `alerts:sent:${userId}:${symbol}:${key}:${day}`;
