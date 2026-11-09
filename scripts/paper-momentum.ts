/**
 * Forward paper test of the 8% momentum rule. Recomputes the ledger from the paper start date and writes
 * data/paper-momentum.json.
 *
 *   npm run paper:update              re-download all bars first, then recompute
 *   npm run paper:update -- --cached  use the bars already cached by model:train
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASX_50, computeFeatures, US_LIQUID, type MBar } from "../lib/model";
import { computeLedger, type PaperStock } from "../lib/paper-momentum";
import { fetchBars } from "./research-data";

const refresh = !process.argv.includes("--cached");

async function main() {
  const syms = [...US_LIQUID, ...ASX_50.map((c) => `${c}.AX`)];
  const raw: Record<string, MBar[]> = {};
  const failed: string[] = [];
  for (const s of [...syms, "^GSPC", "^AXJO"]) {
    try {
      raw[s] = await fetchBars(s, refresh);
    } catch (e) {
      failed.push(`${s} (${(e as Error).message})`);
    }
  }
  if (failed.length) console.log(`Skipped (no data): ${failed.join(", ")}`);
  const stocks: PaperStock[] = [];
  for (const sym of syms) {
    const bars = raw[sym];
    if (!bars || bars.length < 400) continue;
    const mk = sym.endsWith(".AX") ? "ASX" : "US";
    const index = raw[mk === "ASX" ? "^AXJO" : "^GSPC"];
    stocks.push({ sym, mk, bars, bull: computeFeatures(bars, index).map((f) => f.bull) });
  }
  if (!raw["^GSPC"] || stocks.length < 50) throw new Error("not enough data to update the paper ledger");
  const ledger = computeLedger(stocks, raw["^GSPC"]);
  writeFileSync(
    join(process.cwd(), "data", "paper-momentum.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), universe: stocks.length, ...ledger }, null, 1) + "\n",
  );
  const s = ledger.summary;
  console.log(
    `Paper ledger from ${ledger.start}, bars to ${ledger.asOf}: ${stocks.length} stocks, ${s.open} open, ${s.closed} closed, ${s.pending} pending, ${s.skipped} skipped (full)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
