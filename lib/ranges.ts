export const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"] as const;
export type Range = (typeof RANGES)[number];

export const isRange = (v: string): v is Range => (RANGES as readonly string[]).includes(v);

export interface ChartParams {
  period1: Date;
  interval: "5m" | "15m" | "1d" | "1wk";
  /** Keep only the last N distinct trading days (intraday ranges). */
  sessions?: number;
}

const DAY = 864e5;

export function rangeParams(range: Range, now: Date = new Date()): ChartParams {
  const back = (days: number) => new Date(now.getTime() - days * DAY);
  switch (range) {
    case "1D":
      return { period1: back(6), interval: "5m", sessions: 1 };
    case "5D":
      return { period1: back(9), interval: "15m", sessions: 5 };
    case "1M":
      return { period1: back(31), interval: "1d" };
    case "6M":
      return { period1: back(183), interval: "1d" };
    case "YTD":
      return { period1: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), interval: "1d" };
    case "1Y":
      return { period1: back(366), interval: "1d" };
    case "5Y":
      return { period1: back(366 * 5), interval: "1wk" };
  }
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" });

/** Keep only points belonging to the last `n` distinct Sydney calendar days. */
export function keepLastSessions<T extends { t: number }>(points: T[], n: number): T[] {
  const days: string[] = [];
  for (const p of points) {
    const d = dayFmt.format(new Date(p.t));
    if (days[days.length - 1] !== d) days.push(d);
  }
  const keep = new Set(days.slice(-n));
  return points.filter((p) => keep.has(dayFmt.format(new Date(p.t))));
}

/** Cache lifetime: intraday ranges refresh fast, long ranges slowly. */
export function rangeTtlMs(range: Range, historySeconds: number): number {
  return range === "1D" || range === "5D" ? 60_000 : historySeconds * 1000;
}
