export interface Constituent {
  code: string;
  name: string;
  sector: string;
}

export interface MoverRow {
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
}

export interface SectorAverage {
  sector: string;
  avgPct: number;
  count: number;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Change and % change from a price and previous close. */
export function calcChange(price: number | null | undefined, prevClose: number | null | undefined) {
  if (!isNum(price) || !isNum(prevClose) || prevClose === 0) return { change: null, changePct: null };
  const change = price - prevClose;
  return { change, changePct: (change / prevClose) * 100 };
}

/** Average % change per sector (equal-weighted). Rows without a % change are skipped. */
export function sectorAverages(
  rows: { code: string; changePct: number | null }[],
  constituents: Constituent[],
): SectorAverage[] {
  const sectorOf = new Map(constituents.map((c) => [c.code, c.sector]));
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const sector = sectorOf.get(r.code);
    if (!sector || !isNum(r.changePct)) continue;
    const a = acc.get(sector) ?? { sum: 0, count: 0 };
    a.sum += r.changePct;
    a.count += 1;
    acc.set(sector, a);
  }
  return [...acc.entries()]
    .map(([sector, { sum, count }]) => ({ sector, avgPct: sum / count, count }))
    .sort((a, b) => b.avgPct - a.avgPct);
}

/**
 * Minimum shares traded for the "Most active" list. Dual-listed lines whose
 * main volume is elsewhere (e.g. MCY showing 96 shares) otherwise look odd.
 */
export const MIN_ACTIVE_VOLUME = 10_000;

export type MoverKind = "gainers" | "losers" | "active";

export function rankMovers(rows: MoverRow[], kind: MoverKind, limit = 10): MoverRow[] {
  if (kind === "gainers") {
    return rows
      .filter((r) => isNum(r.changePct) && r.changePct > 0)
      .sort((a, b) => b.changePct! - a.changePct!)
      .slice(0, limit);
  }
  if (kind === "losers") {
    return rows
      .filter((r) => isNum(r.changePct) && r.changePct < 0)
      .sort((a, b) => a.changePct! - b.changePct!)
      .slice(0, limit);
  }
  return rows
    .filter((r) => isNum(r.volume) && isNum(r.price) && r.volume >= MIN_ACTIVE_VOLUME)
    .sort((a, b) => b.price! * b.volume! - a.price! * a.volume!)
    .slice(0, limit);
}
