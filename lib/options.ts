/**
 * Real option prices (Yahoo chains). Pure helpers shared by lib/yahoo.ts, /api/options,
 * the trades UI and the tests; nothing here touches the network.
 */

/** OCC-style contract symbol as Yahoo writes it: root, YYMMDD, C or P, strike x 1000 (8 digits). */
export const CONTRACT_RE = /^[A-Z0-9]{1,8}\d{6}[CP]\d{8}$/;
export const MAX_CONTRACTS = 50;
export const MAX_STRIKES = 30;
const DAY = 86_400_000;

export interface OptionLeg {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** implied volatility, annualised fraction (0.3 = 30%) */
  iv: number | null;
  volume?: number | null;
  openInterest?: number | null;
  /** time of the last trade, ms */
  lastTradeMs?: number | null;
}
export interface OptionRow {
  strike: number;
  call: OptionLeg | null;
  put: OptionLeg | null;
}
export interface OptionChain {
  symbol: string;
  spot: number | null;
  /** every expiry Yahoo lists, UTC midnight ms; empty when the stock has no options */
  expiries: number[];
  /** the expiry the strikes belong to */
  expiry: number | null;
  strikes: OptionRow[];
}
export interface ContractQuote {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** mid of bid/ask when both are above zero, else last */
  mark: number | null;
  /** daily closes of the contract, t = UTC midnight of the day (may be sparse) */
  bars: { t: number; close: number }[];
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const toMs = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : null);

/** Entry/mark premium: mid of bid and ask when both are above zero, otherwise the last trade. */
export function midPrice(bid: number | null | undefined, ask: number | null | undefined, last: number | null | undefined): number | null {
  if (typeof bid === "number" && typeof ask === "number" && bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  return typeof last === "number" && last > 0 ? last : null;
}

function mapLeg(r: unknown): OptionLeg | null {
  const o = rec(r);
  const contractSymbol = typeof o.contractSymbol === "string" ? o.contractSymbol : "";
  if (!CONTRACT_RE.test(contractSymbol)) return null;
  return { contractSymbol, bid: num(o.bid), ask: num(o.ask), last: num(o.lastPrice), iv: num(o.impliedVolatility), volume: num(o.volume), openInterest: num(o.openInterest), lastTradeMs: toMs(o.lastTradeDate) };
}

/** Keeps the `max` strikes closest to spot (centred on it), in ascending order. */
export function trimStrikes(rows: OptionRow[], spot: number | null, max = MAX_STRIKES): OptionRow[] {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  if (sorted.length <= max) return sorted;
  let at = Math.floor(sorted.length / 2);
  if (spot !== null) {
    let best = Infinity;
    sorted.forEach((r, i) => {
      const d = Math.abs(r.strike - spot);
      if (d < best) {
        best = d;
        at = i;
      }
    });
  }
  const start = Math.min(Math.max(at - Math.floor(max / 2), 0), sorted.length - max);
  return sorted.slice(start, start + max);
}

/** Maps a yf.options() result to the chain for one expiry. No options -> empty expiries. */
export function mapChain(symbol: string, raw: Raw): OptionChain {
  const expiries = (Array.isArray(raw.expirationDates) ? raw.expirationDates : []).map(toMs).filter((v): v is number => v !== null);
  const spot = num(rec(raw.quote).regularMarketPrice);
  const first = Array.isArray(raw.options) ? rec(raw.options[0]) : {};
  const byStrike = new Map<number, OptionRow>();
  const add = (list: unknown, key: "call" | "put") => {
    for (const item of Array.isArray(list) ? list : []) {
      const strike = num(rec(item).strike);
      const leg = mapLeg(item);
      if (strike === null || !leg) continue;
      const row = byStrike.get(strike) ?? { strike, call: null, put: null };
      row[key] = leg;
      byStrike.set(strike, row);
    }
  };
  add(first.calls, "call");
  add(first.puts, "put");
  return {
    symbol,
    spot,
    expiries,
    expiry: toMs(first.expirationDate),
    strikes: trimStrikes([...byStrike.values()], spot),
  };
}

export type OptionsParams = { kind: "chain"; symbol: string; date?: number } | { kind: "contracts"; contracts: string[]; from: number } | { error: string };

/** Validates GET /api/options query params. `symbolRe` is lib/api.ts SYMBOL_RE (kept out of here so this stays pure). */
export function parseOptionsParams(sp: URLSearchParams, symbolRe: RegExp, now: number): OptionsParams {
  const contractsRaw = sp.get("contracts");
  if (contractsRaw !== null) {
    const contracts = [...new Set(contractsRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (contracts.length === 0 || contracts.length > MAX_CONTRACTS) return { error: `Give 1 to ${MAX_CONTRACTS} contract symbols.` };
    if (!contracts.every((c) => CONTRACT_RE.test(c))) return { error: "Invalid contract symbol." };
    const fromRaw = sp.get("from");
    const from = fromRaw === null || fromRaw.trim() === "" ? now - 30 * DAY : Number(fromRaw);
    if (!Number.isFinite(from) || from > now || from < now - 800 * DAY) return { error: "Invalid start date." };
    return { kind: "contracts", contracts, from };
  }
  const symbol = (sp.get("symbol") ?? "").toUpperCase();
  if (!symbolRe.test(symbol)) return { error: "Invalid symbol." };
  const dateRaw = sp.get("date");
  if (dateRaw === null || dateRaw.trim() === "") return { kind: "chain", symbol };
  const date = Number(dateRaw);
  if (!Number.isFinite(date) || date < now - 2 * DAY || date > now + 1100 * DAY) return { error: "Invalid expiry date." };
  return { kind: "chain", symbol, date };
}
