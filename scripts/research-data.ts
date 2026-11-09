/** Shared by the research scripts: daily bars from Yahoo, cached on disk (.cache/research, gitignored) so reruns are offline. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YahooFinance from "yahoo-finance2";
import type { MBar } from "../lib/model";
import { DAY_MS } from "../lib/trades";

export const DIR = join(process.cwd(), ".cache", "research");
const THROTTLE_MS = 450;
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


export async function fetchBars(sym: string, refresh = false): Promise<MBar[]> {
  const file = join(DIR, `${sym.replace(/[^A-Z0-9.]/gi, "_")}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as MBar[];
  const from = new Date(Date.now() - 10 * 365.25 * DAY_MS + 3 * DAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = (await yf.chart(sym, { period1: from, interval: "1d" }, { validateResult: false })) as unknown as {
        meta?: { gmtoffset?: number };
        quotes?: Record<string, unknown>[];
      };
      const off = (res.meta?.gmtoffset ?? 0) * 1000;
      const bars: MBar[] = [];
      for (const q of res.quotes ?? []) {
        const d = q.date instanceof Date ? q.date.getTime() : NaN;
        const { high, low, close, open, volume } = q as Record<string, number | null>;
        if (!Number.isFinite(d) || !(high! > 0) || !(low! > 0) || !(close! > 0)) continue;
        bars.push({
          t: Math.floor((d + off) / DAY_MS) * DAY_MS,
          high: high!,
          low: low!,
          close: close!,
          ...(open! > 0 ? { open: open! } : {}),
          ...(Number.isFinite(volume) && volume! >= 0 ? { volume: volume! } : {}),
        });
      }
      if (bars.length < 300) throw new Error(`only ${bars.length} bars`);
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(bars));
      await sleep(THROTTLE_MS);
      return bars;
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

