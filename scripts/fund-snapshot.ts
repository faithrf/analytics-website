/**
 * Saves today's full holdings of the daily-transparent active ETFs (ARK) and diffs them against the previous snapshot
 * into daily trades.
 *
 *   npm run funds:snapshot
 *
 * Source: ARK's own holdings CSVs (assets.ark-funds.com). Snapshots go to data/fund-holdings/<FUND>/<YYYY-MM-DD>.json
 * (ticker, shares, weight). Trades accumulate in data/fund-trades.json (last 90 days). The first time a fund has no trades
 * on file, the last 30 days are backfilled from arkfunds.io, an unofficial mirror of ARK's published trades.
 * Other active ETFs (e.g. NANC/KRUZ) were checked and have no free daily holdings CSV, so they are not included.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffSnapshots, parseArkCsv, type DailyTrade, type FundTradesFile, type Snapshot } from "../lib/fund-signals";
import { ARK_FUNDS, arkCsvUrl, arkPage, arkTradesApi } from "./fund-sources";

const ROOT = join(process.cwd(), "data");
const OUT = join(ROOT, "fund-trades.json");
const KEEP_DAYS = 90;
const UA = "Mozilla/5.0 (compatible; MeridianResearch/1.0)";
const key = (t: DailyTrade) => `${t.date}|${t.fund}|${t.sym}`;

async function get(url: string): Promise<string> {
  let err: unknown;
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
  throw err;
}

function previous(dir: string, before: string): Snapshot | null {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) < before).sort().pop();
  return f ? (JSON.parse(readFileSync(join(dir, f), "utf8")) as Snapshot) : null;
}

async function backfill(fund: string, sinceIso: string): Promise<DailyTrade[]> {
  try {
    const j = JSON.parse(await get(arkTradesApi(fund, sinceIso))) as { trades?: { date: string; ticker: string; direction: string; shares: number; etf_percent: number }[] };
    return (j.trades ?? [])
      .filter((t) => t.ticker && t.shares > 0)
      .map((t) => ({ date: t.date, fund, sym: t.ticker.toUpperCase(), action: t.direction === "Sell" ? "sell" : "buy", shares: t.direction === "Sell" ? -t.shares : t.shares, pct: null, weight: t.etf_percent, src: "arkfunds.io" }) as DailyTrade);
  } catch (e) {
    console.log(`${fund}: backfill failed (${(e as Error).message})`);
    return [];
  }
}

async function main() {
  const old: FundTradesFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { updatedAt: null, funds: {}, trades: [] };
  const trades = new Map(old.trades.map((t) => [key(t), t]));
  const funds: FundTradesFile["funds"] = { ...old.funds };
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  for (const f of ARK_FUNDS) {
    let snap: Snapshot | null;
    try {
      snap = parseArkCsv(await get(arkCsvUrl(f)));
    } catch (e) {
      console.log(`${f.id}: download failed (${(e as Error).message})`);
      continue;
    }
    if (!snap) {
      console.log(`${f.id}: could not parse the CSV`);
      continue;
    }
    if (Date.now() - Date.parse(snap.date) > 10 * 86_400_000) {
      console.log(`${f.id}: CSV is stale (as of ${snap.date}), skipped`);
      continue;
    }
    const dir = join(ROOT, "fund-holdings", f.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${snap.date}.json`);
    const prev = previous(dir, snap.date);
    const saved = existsSync(file);
    if (!saved) writeFileSync(file, JSON.stringify(snap));
    let added = 0;
    if (prev && !saved) {
      for (const t of diffSnapshots(prev, snap)) {
        trades.set(key(t), t);
        added++;
      }
    }
    if (![...trades.values()].some((t) => t.fund === f.id)) {
      for (const t of await backfill(f.id, since)) if (!trades.has(key(t))) trades.set(key(t), t), added++;
    }
    funds[f.id] = { asOf: snap.date, prev: prev?.date ?? old.funds[f.id]?.prev ?? null, url: arkPage(f.id) };
    console.log(`${f.id}: ${snap.rows.length} holdings as of ${snap.date}${saved ? " (already saved)" : ""}, ${prev ? `previous ${prev.date}` : "no previous snapshot"}, ${added} trades added`);
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const list = [...trades.values()].filter((t) => t.date >= cutoff).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.fund.localeCompare(b.fund)));
  const out: FundTradesFile = { updatedAt: new Date().toISOString(), funds, trades: list };
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`${list.length} trades on file`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
