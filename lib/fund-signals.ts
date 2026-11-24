/**
 * Fund-following model: types and pure helpers shared by scripts/fund-signals.ts, scripts/fund-snapshot.ts and the Funds
 * panel. 13F-HR information tables are parsed and diffed into position events; ARK-style daily holdings are diffed into trades.
 * Nothing here touches the network or the disk.
 */
import type { MBar, Summary } from "./model";
import { stats, type SplitStats } from "./ceo-sentiment";

export type { SplitStats };

// ---------- 13F ----------

export type Holding13F = { cusip: string; name: string; shares: number; value: number };

const tag = (block: string, name: string): string | null => new RegExp(`<(?:\\w+:)?${name}>\\s*([\\s\\S]*?)\\s*</(?:\\w+:)?${name}>`, "i").exec(block)?.[1] ?? null;

const unescapeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Title classes that are plain shares (not notes, warrants, preferred, units or rights). */
export function isCommonClass(cls: string): boolean {
  const c = cls.toUpperCase();
  if (/NOTE|DEBT|BOND|WARRANT|WTS|PFD|PREF|UNIT|RIGHT|\bETF\b|TRUST|FUND|SPONSORED ADR REP PFD|CONV|DEB/.test(c)) return false;
  return /COM|CL\s?[A-C]\b|CLASS|SHS|ORD|ADS|ADR|CAP STK|STOCK|SHARES|EQUITY/.test(c);
}

/**
 * Parse a 13F information table. Option lines (putCall) and principal-amount lines are dropped, non-common classes are dropped,
 * and lines of one CUSIP are summed.
 */
export function parseInfoTable(xml: string): Holding13F[] {
  const out = new Map<string, Holding13F>();
  const blocks = xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/gi) ?? [];
  for (const b of blocks) {
    if (tag(b, "putCall")) continue;
    const type = (tag(b, "sshPrnamtType") ?? "SH").toUpperCase();
    if (type !== "SH") continue;
    const cls = tag(b, "titleOfClass") ?? "";
    if (!isCommonClass(cls)) continue;
    const cusip = (tag(b, "cusip") ?? "").toUpperCase();
    const shares = Number(tag(b, "sshPrnamt")?.replace(/,/g, ""));
    const value = Number(tag(b, "value")?.replace(/,/g, ""));
    if (!cusip || !(shares > 0) || !Number.isFinite(value)) continue;
    const cur = out.get(cusip);
    if (cur) {
      cur.shares += shares;
      cur.value += value;
    } else out.set(cusip, { cusip, name: unescapeXml(tag(b, "nameOfIssuer") ?? ""), shares, value });
  }
  return [...out.values()];
}

/** 13F value is in dollars from the filings for periods after 2022-12-31 (filed from 2023-01-03) and in thousands before. */
export const valueUsd = (value: number, filed: string) => (filed < "2023-01-03" ? value * 1000 : value);

const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|LLC|LP|NV|SA|AG|SE|HOLDINGS?|HLDGS?|GROUP|GRP|THE|COM|CL|CLASS|A|B|C|NEW|DEL|ORD|ADR|ADS|SHS|STOCK|CAP|INTL|INTERNATIONAL)\b/g;

/** Issuer name with punctuation and corporate suffixes removed, for matching 13F names to exchange-listing names. */
export function normName(s: string): string {
  return s
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[.,'’"()\/\\-]/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ChangeType = "new" | "increase" | "exit" | "trim";
export const CHANGE_TYPES: ChangeType[] = ["new", "increase", "trim", "exit"];
export const BIG_UP = 1.5;
export const BIG_DOWN = 0.5;

/** Share-count change to event type: new (0 to something), exit (to 0), increase (>= +50%), trim (<= -50%), else null. */
export function classifyChange(prev: number, cur: number): ChangeType | null {
  if (!(prev > 0) && cur > 0) return "new";
  if (prev > 0 && !(cur > 0)) return "exit";
  if (!(prev > 0)) return null;
  const r = cur / prev;
  if (r >= BIG_UP) return "increase";
  if (r <= BIG_DOWN) return "trim";
  return null;
}

const SPLITS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 1.5, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10, 1 / 20];

/** A share-count jump that matches a stock split: a round ratio with the position value barely moved (price moved the other way). */
export function isLikelySplit(prev: { shares: number; value: number }, cur: { shares: number; value: number }): boolean {
  if (!(prev.shares > 0 && cur.shares > 0 && prev.value > 0 && cur.value > 0)) return false;
  const sr = cur.shares / prev.shares;
  const vr = cur.value / prev.value;
  const round = SPLITS.some((s) => Math.abs(sr / s - 1) < 0.03);
  return round && Math.abs(Math.log(vr)) < 0.15;
}

export type Change = { cusip: string; name: string; type: ChangeType; prev: number; cur: number; pct: number | null; value: number };

/** Position changes between two consecutive filings of one fund. `value` is the larger of the two position values (as filed). */
export function diff13F(prev: Holding13F[], cur: Holding13F[]): Change[] {
  const p = new Map(prev.map((h) => [h.cusip, h]));
  const c = new Map(cur.map((h) => [h.cusip, h]));
  const out: Change[] = [];
  for (const k of new Set([...p.keys(), ...c.keys()])) {
    const a = p.get(k);
    const b = c.get(k);
    const type = classifyChange(a?.shares ?? 0, b?.shares ?? 0);
    if (!type) continue;
    if (a && b && isLikelySplit(a, b)) continue;
    out.push({
      cusip: k,
      name: (b ?? a)!.name,
      type,
      prev: a?.shares ?? 0,
      cur: b?.shares ?? 0,
      pct: a && b ? (b.shares / a.shares - 1) * 100 : null,
      value: Math.max(a?.value ?? 0, b?.value ?? 0),
    });
  }
  return out;
}

// ---------- daily holdings (ARK and similar) ----------

export type SnapRow = { t: string; s: number; w: number };
export type Snapshot = { fund: string; date: string; rows: SnapRow[] };

/** `MM/DD/YYYY` to `YYYY-MM-DD`. */
export function usDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** One CSV line into fields, honouring double quotes. */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s: string) => Number(s.replace(/[$,%\s]/g, ""));

/** ARK holdings CSV (date,fund,company,ticker,cusip,shares,market value,weight). Rows without a ticker (cash, treasuries) are skipped. */
export function parseArkCsv(text: string): Snapshot | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift()?.toLowerCase() ?? "";
  if (!head.startsWith("date,fund")) return null;
  const rows: SnapRow[] = [];
  let date = "";
  let fund = "";
  for (const l of lines) {
    const f = csvLine(l);
    if (f.length < 8) continue;
    const d = usDate(f[0]);
    if (!d) continue;
    date = d;
    fund = f[1].trim().toUpperCase();
    const t = f[3].trim().toUpperCase();
    const s = num(f[5]);
    const w = num(f[7]);
    if (!t || !(s > 0)) continue;
    rows.push({ t, s, w });
  }
  return date && fund && rows.length ? { fund, date, rows } : null;
}

export type TradeAction = "buy" | "add" | "trim" | "sell";
export type DailyTrade = { date: string; fund: string; sym: string; action: TradeAction; shares: number; pct: number | null; weight: number; src?: string };

/**
 * Trades implied by two snapshots of one fund: buy (new), add, trim, sell (gone). Moves under 0.5% of the shares are rounding and
 * ignored, and a round share-ratio jump with the weight unchanged is a stock split, not a trade.
 */
export function diffSnapshots(prev: Snapshot, cur: Snapshot): DailyTrade[] {
  const p = new Map(prev.rows.map((r) => [r.t, r]));
  const c = new Map(cur.rows.map((r) => [r.t, r]));
  const out: DailyTrade[] = [];
  for (const k of new Set([...p.keys(), ...c.keys()])) {
    const a = p.get(k);
    const b = c.get(k);
    const base = { date: cur.date, fund: cur.fund, sym: k };
    if (!a && b) out.push({ ...base, action: "buy", shares: b.s, pct: null, weight: b.w });
    else if (a && !b) out.push({ ...base, action: "sell", shares: -a.s, pct: -100, weight: 0 });
    else if (a && b) {
      const r = b.s / a.s;
      if (Math.abs(r - 1) < 0.005) continue;
      const round = SPLITS.some((s) => Math.abs(r / s - 1) < 0.03);
      if (round && a.w > 0 && Math.abs(b.w / a.w - 1) < 0.15) continue;
      out.push({ ...base, action: r > 1 ? "add" : "trim", shares: b.s - a.s, pct: (r - 1) * 100, weight: b.w });
    }
  }
  return out.sort((x, y) => Math.abs(y.pct ?? 100) - Math.abs(x.pct ?? 100) || x.sym.localeCompare(y.sym));
}

// ---------- event study ----------

/** Index of the last bar on or before `ms` (UTC midnight of a date), or -1. */
export function lastBarOnOrBefore(bars: MBar[], ms: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const dateMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/**
 * Percent return from the open of bar `i` to the close of bar `i + h - 1` (h = 1 is the entry day itself).
 * Null when the bars end first.
 */
export function fwdReturn(bars: MBar[], i: number, h: number): number | null {
  const j = i + h - 1;
  if (i < 0 || j >= bars.length) return null;
  const o = bars[i].open ?? bars[i - 1]?.close;
  return o ? (bars[j].close / o - 1) * 100 : null;
}

export const HORIZONS = [1, 5, 20, 60] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Excess return versus the market over the same window; null when either side is missing or the entry bars are different days. */
export function excessReturn(bars: MBar[], mkt: MBar[], signalMs: number, h: number): { ret: number; ex: number } | null {
  const i = lastBarOnOrBefore(bars, signalMs) + 1; // enter at the next open
  const k = lastBarOnOrBefore(mkt, signalMs) + 1;
  if (i < 1 || k < 1 || i >= bars.length || k >= mkt.length || bars[i].t !== mkt[k].t) return null;
  const a = fwdReturn(bars, i, h);
  const m = fwdReturn(mkt, k, h);
  return a === null || m === null ? null : { ret: a, ex: a - m };
}

/** One cell of the event-study grid: fund ("ALL" = pooled), event kind, horizon, then n / mean excess % / hit % / t. */
export type Cell = { f: string; k: string; h: Horizon; n: number; m: number; hit: number; t: number };

export const MIN_N = 30;
export const MIN_T = 2;
/** Flag a cell as significant: enough events and |t| >= 2. With many cells tested some will pass by chance. */
export const isSignificant = (c: { n: number; t: number }) => c.n >= MIN_N && Math.abs(c.t) >= MIN_T;

export function cellOf(f: string, k: string, h: Horizon, xs: number[]): Cell {
  const s = stats(xs);
  return { f, k, h, n: s.n, m: s.mean, hit: s.hit, t: s.t };
}

/** Counts for the multiple-testing caveat: cells with enough events to be flagged, how many were, and how many pass by chance alone (~4.6% at |t| >= 2). */
export function testedSummary(cells: Cell[]): { cells: number; testable: number; flagged: number; expectedByChance: number } {
  const testable = cells.filter((c) => c.n >= MIN_N);
  return { cells: cells.length, testable: testable.length, flagged: testable.filter(isSignificant).length, expectedByChance: Math.round(testable.length * 0.046 * 10) / 10 };
}

// ---------- rule backtest ----------

export type CurvePt = { d: string; rule: number; mkt: number };
export type RuleTrade = { exitMs: number; ret: number; mkt: number };

/** Cumulative profit with $100 into every trade (the same measure as the Model tab curve), one point per month, trades ordered by exit date. */
export function monthlyCurve(trades: RuleTrade[]): CurvePt[] {
  const sorted = [...trades].sort((a, b) => a.exitMs - b.exitMs);
  const out: CurvePt[] = [];
  let rule = 0;
  let mkt = 0;
  for (const t of sorted) {
    rule += t.ret;
    mkt += t.mkt;
    const d = new Date(t.exitMs).toISOString().slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.d === d) {
      last.rule = Math.round(rule * 10) / 10;
      last.mkt = Math.round(mkt * 10) / 10;
    } else out.push({ d, rule: Math.round(rule * 10) / 10, mkt: Math.round(mkt * 10) / 10 });
  }
  return out;
}

// ---------- file shapes ----------

export type FundInfo = { id: string; name: string; cik: string; filings: number; first: string; last: string; events: Record<ChangeType, number> };
export type LatestChange = { sym: string | null; name: string; type: ChangeType; prev: number; cur: number; pct: number | null; usd: number };
export type LatestFiling = { fund: string; filed: string; period: string; url: string; changes: LatestChange[] };
export type RuleResult = { id: string; label: string; desc: string; trades: number; stats: Summary; bench: Summary; excess: number; curve: CurvePt[] };

export type FundSignalsFile = {
  updatedAt: string | null;
  note: string;
  /** CUSIP-to-ticker mapping quality across all 13F lines read (value-weighted too) */
  match: { lines: number; mapped: number; pct: number; valuePct: number };
  funds: FundInfo[];
  /** 13F events, dated at the filing date */
  study: Cell[];
  /** ARK daily trades (arkfunds.io history), fresh buys and sells */
  ark: Cell[];
  tested: ReturnType<typeof testedSummary>;
  rules: RuleResult[];
  latest: LatestFiling[];
  sources: { label: string; url: string }[];
};

/** Shape of data/fund-trades.json written by scripts/fund-snapshot.ts. */
export type FundTradesFile = {
  updatedAt: string | null;
  funds: Record<string, { asOf: string; prev: string | null; url: string }>;
  trades: DailyTrade[];
};

export const KIND_LABEL: Record<string, string> = {
  new: "New position",
  increase: "Increase 50%+",
  trim: "Trim 50%+",
  exit: "Full exit",
  "ark-buy": "ARK fresh buy",
  "ark-sell": "ARK fresh sell",
};
