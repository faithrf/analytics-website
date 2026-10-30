/**
 * Runs every ticker in data/asx200.ts and data/markets.ts through Yahoo `quote`
 * and reports the ones that do not resolve (or only return a stale / empty quote).
 *
 *   npm run verify-tickers            report only
 *   npm run verify-tickers -- --prune  also delete failing rows from those files
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { CONSTITUENTS } from "../data/markets";
import { toYahoo } from "../lib/symbols";

const STALE_DAYS = 10;
const BATCH = 40;
const prune = process.argv.includes("--prune");
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

type Raw = Record<string, unknown>;

async function main() {
  const codes = Object.values(CONSTITUENTS).flatMap((list) => list.map((c) => c.code));
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  const ok = new Map<string, Raw>();
  const errors: string[] = [];

  for (let i = 0; i < codes.length; i += BATCH) {
    const symbols = codes.slice(i, i + BATCH).map(toYahoo);
    try {
      const res = (await yf.quote(symbols, {}, { validateResult: false })) as Raw[];
      for (const r of res) ok.set(String(r.symbol), r);
    } catch (e) {
      errors.push(`batch ${i / BATCH}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) {
    console.error("Upstream errors (results incomplete, not pruning):\n" + errors.join("\n"));
    process.exit(2);
  }

  const failures: { code: string; why: string }[] = [];
  const cutoff = Date.now() - STALE_DAYS * 864e5;
  for (const code of codes) {
    const r = ok.get(toYahoo(code));
    if (!r) failures.push({ code, why: "no result" });
    else if (typeof r.regularMarketPrice !== "number") failures.push({ code, why: "no price" });
    else {
      const t = r.regularMarketTime instanceof Date ? r.regularMarketTime.getTime() : Number(r.regularMarketTime) * 1000;
      if (Number.isFinite(t) && t < cutoff) failures.push({ code, why: `stale (last trade ${new Date(t).toISOString().slice(0, 10)})` });
    }
  }
  for (const d of new Set(dupes)) failures.push({ code: d, why: "duplicate code" });

  console.log(`Checked ${codes.length} tickers: ${codes.length - failures.length} ok, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAIL ${f.code.padEnd(9)} ${f.why}`);

  if (prune && failures.length) {
    const dropSet = new Set(failures.filter((f) => f.why !== "duplicate code").map((f) => f.code));
    for (const name of ["asx200.ts", "markets.ts"]) {
      const file = fileURLToPath(new URL(`../data/${name}`, import.meta.url));
      const lines = readFileSync(file, "utf8").split("\n");
      const kept = lines.filter((l) => {
        const m = l.match(/^\s*\["([A-Z0-9.-]+)",/);
        return !(m && dropSet.has(m[1]));
      });
      writeFileSync(file, kept.join("\n"));
      console.log(`Pruned ${lines.length - kept.length} rows from data/${name}`);
    }
  }
  process.exit(failures.length ? 1 : 0);
}

void main();
