/**
 * Types and delay maths shared by the Leaders API routes and view. Pure, no
 * server-only imports, so the client bundle and the unit tests can use it.
 */

export type DelayTone = "good" | "warn" | "bad";

/** One public disclosure, whatever the source. Dates are YYYY-MM-DD. */
export interface LeaderRow {
  id: string;
  /** person or filer */
  who: string;
  /** role or chamber, shown under the name */
  sub?: string;
  /** US ticker when the filing gives one */
  ticker?: string;
  /** company or asset name */
  company?: string;
  /** short action label ("Buy", "Sale", "SCHEDULE 13D") */
  action: string;
  side: "buy" | "sell" | "other";
  /** SEC transaction code for Form 4 rows */
  code?: string;
  /** shares / value / amount band, ready to show */
  size?: string;
  /** date of the trade or event; null when the source does not say */
  traded: string | null;
  /** date filed */
  filed: string;
  /** exact filing time (ms) when the source gives one */
  filedAt?: number | null;
  /** link to the original filing */
  url: string;
}

export interface HouseFiling {
  id: string;
  name: string;
  state: string;
  /** YYYY-MM-DD */
  filed: string;
  url: string;
}

export interface LeadersMeta {
  /** when this server instance began collecting rows (ms); the week view is only complete after 7 days */
  since: number;
  /** when the server last pulled this from the source (ms) */
  fetchedAt: number;
}
export interface InsidersData extends LeadersMeta {
  rows: LeaderRow[];
  /** filings read this time / filings listed by EDGAR */
  scanned: number;
  listed: number;
}
export interface CongressData extends LeadersMeta {
  rows: LeaderRow[];
  house: HouseFiling[];
  houseFetchedAt: number | null;
  /** minutes between Bargo pulls */
  refreshMin: number;
  keyed: boolean;
}
export interface StakesData extends LeadersMeta {
  rows: LeaderRow[];
}

/** A trade filed within this many days counts as "fresh". */
export const FRESH_DAYS = 3;

const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function dayNumber(date: string): number | null {
  const m = DATE_RE.exec(date);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null;
}

/** Whole calendar days from trade to filing; null if either date is unusable. */
export function delayDays(traded: string | null | undefined, filed: string | null | undefined): number | null {
  if (!traded || !filed) return null;
  const a = dayNumber(traded);
  const b = dayNumber(filed);
  if (a === null || b === null) return null;
  return Math.max(0, Math.round(b - a));
}

export function delayLabel(days: number | null): string {
  if (days === null) return "unknown";
  if (days === 0) return "same day";
  return days === 1 ? "1 day" : `${days} days`;
}

/** Green up to 2 days, amber 3-10, red beyond. */
export function delayTone(days: number | null): DelayTone | null {
  if (days === null) return null;
  return days <= 2 ? "good" : days <= 10 ? "warn" : "bad";
}

export const isFresh = (days: number | null) => days !== null && days <= FRESH_DAYS;

/* ---------- rolling window ---------- */

/** How long the server keeps rows, in days since filing. */
export const KEEP_DAYS = 8;
/** "Last 7 days" view. */
export const WEEK_DAYS = 7;
/** House filings strip in Latest mode. */
export const HOUSE_LATEST_DAYS = 3;
/** "Latest" view shows this many newest rows per source. */
export const LATEST_COUNT = { insiders: 60, congress: 20, stakes: 40 } as const;

/** When a row was filed, in ms: exact time if known, else midnight UTC of the filed date. */
export function filedTime(r: Pick<LeaderRow, "filed" | "filedAt">): number | null {
  if (typeof r.filedAt === "number") return r.filedAt;
  const d = dayNumber(r.filed);
  return d === null ? null : d * DAY;
}

/** Newest filed first; rows without a usable date last. */
export const byFiledDesc = (a: LeaderRow, b: LeaderRow) => (filedTime(b) ?? -Infinity) - (filedTime(a) ?? -Infinity);

/** Rows filed within the last `days` days (whole-day rows count from the start of their day). */
export function withinDays(rows: LeaderRow[], days: number, now: number): LeaderRow[] {
  const cut = now - days * DAY;
  return rows.filter((r) => {
    const t = filedTime(r);
    return t !== null && t >= cut;
  });
}

/** Add `incoming` to `store` (keyed by row id, newest copy wins) and drop rows filed over KEEP_DAYS ago. */
export function mergeRows(store: Map<string, LeaderRow>, incoming: LeaderRow[], now: number): LeaderRow[] {
  for (const r of incoming) store.set(r.id, r);
  const cut = now - KEEP_DAYS * DAY;
  for (const [id, r] of store) {
    const t = filedTime(r);
    if (t === null || t < cut) store.delete(id);
  }
  return [...store.values()].sort(byFiledDesc);
}

export type Range = "latest" | "week";

/** Latest: the newest N rows. Week: everything filed in the last 7 days. Both newest first. */
export function applyRange(rows: LeaderRow[], range: Range, kind: keyof typeof LATEST_COUNT, now: number): LeaderRow[] {
  if (range === "week") return withinDays(rows, WEEK_DAYS, now).sort(byFiledDesc);
  return [...rows].sort(byFiledDesc).slice(0, LATEST_COUNT[kind]);
}

/** True when the server has not been collecting for a full week yet. */
export const weekIncomplete = (since: number | undefined, now: number) => since !== undefined && since > now - WEEK_DAYS * DAY;
