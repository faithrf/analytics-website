/**
 * Runs every ticker in data/asx200.ts through Yahoo `quote` and reports the
 * ones that do not resolve (or only return a stale / empty quote).
 *
 *   npm run verify-tickers            report only
 *   npm run verify-tickers -- --prune  also delete failing rows from data/asx200.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { ASX200 } from "../data/asx200";

const STALE_DAYS = 10;
const BATCH = 40;
const prune = process.argv.includes("--prune");
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

type Raw = Record<string, unknown>;

async function main() {
  const codes = ASX200.map((c) => c.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  const ok = new Map<string, Raw>();
  const errors: string[] = [];

  for (let i = 0; i < codes.length; i += BATCH) {
    const symbols = codes.slice(i, i + BATCH).map((c) => `${c}.AX`);
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
    const r = ok.get(`${code}.AX`);
    if (!r) failures.push({ code, why: "no result" });
    else if (typeof r.regularMarketPrice !== "number") failures.push({ code, why: "no price" });
    else {
      const t = r.regularMarketTime instanceof Date ? r.regularMarketTime.getTime() : Number(r.regularMarketTime) * 1000;
      if (Number.isFinite(t) && t < cutoff) failures.push({ code, why: `stale (last trade ${new Date(t).toISOString().slice(0, 10)})` });
    }
  }
  for (const d of new Set(dupes)) failures.push({ code: d, why: "duplicate code" });

  console.log(`Checked ${codes.length} tickers: ${codes.length - failures.length} ok, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAIL ${f.code.padEnd(5)} ${f.why}`);

  if (prune && failures.length) {
    const file = fileURLToPath(new URL("../data/asx200.ts", import.meta.url));
    const dropSet = new Set(failures.filter((f) => f.why !== "duplicate code").map((f) => f.code));
    const lines = readFileSync(file, "utf8").split("\n");
    const kept = lines.filter((l) => {
      const m = l.match(/^\s*\["([A-Z0-9]+)",/);
      return !(m && dropSet.has(m[1]));
    });
    writeFileSync(file, kept.join("\n"));
    console.log(`Pruned ${lines.length - kept.length} rows from data/asx200.ts`);
  }
  process.exit(failures.length ? 1 : 0);
}

void main();
