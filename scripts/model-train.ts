/**
 * Re-tunes the /model presets on 3 years of history, scored on the last 12 months and writes data/model-tuned.json.
 *
 *   npm run model:train              uses cached bars (.cache/research), fetches what is missing
 *   npm run model:train -- --refresh  re-download everything first
 *
 * Walk-forward only: each test month is traded with the setting that scored best on the months before it.
 * A preset is replaced only if its out-of-sample result beats the baseline and the default (see lib/model-tune.ts).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASX_50, BASE_HYPOTHESES, US_LIQUID, type MBar, type TunedFamily, type TunedFile, type TunedStats } from "../lib/model";
import { TRAIN_MS, tuneFamily, WINDOW_MS, type TuneStats } from "../lib/model-tune";
import { DAY_MS } from "../lib/trades";
import { fetchBars } from "./research-data";

const refresh = process.argv.includes("--refresh");
const WARMUP_MS = 420 * DAY_MS; // 200-day average + volatility + beta lookback
const OUT = join(process.cwd(), "data", "model-tuned.json");

const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0);
const pack = (s: TuneStats): TunedStats => ({ n: s.n, hit: r4(s.hit), hitLo: r4(s.hitLo), hitHi: r4(s.hitHi), mean: r4(s.mean), edge: r4(s.edge), t: r4(s.t), p: r4(s.p) });

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
  const end = Math.max(...syms.filter((s) => raw[s]).map((s) => raw[s][raw[s].length - 1].t)) + DAY_MS;
  const win = { startMs: end - WINDOW_MS - TRAIN_MS, endMs: end }; // 3 years of training history, then 12 months tested
  const cut = (bars: MBar[]) => bars.filter((b) => b.t >= win.startMs - WARMUP_MS);
  const data: Record<string, MBar[]> = {};
  for (const s of syms) if (raw[s]) data[s] = cut(raw[s]);
  const idx = { "^GSPC": raw["^GSPC"] && cut(raw["^GSPC"]), "^AXJO": raw["^AXJO"] && cut(raw["^AXJO"]) };
  const indexFor = (s: string) => (s.endsWith(".AX") ? idx["^AXJO"] : idx["^GSPC"]);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  console.log(`Universe ${Object.keys(data).length} stocks; trained from ${day(win.startMs)}, tested ${day(end - WINDOW_MS)} to ${day(win.endMs - DAY_MS)}\n`);

  const families: Record<string, TunedFamily> = {};
  for (const h of BASE_HYPOTHESES) {
    process.stdout.write(`${h.id}: tuning... `);
    const r = await tuneFamily(h, data, indexFor, win, { candidates: 400 });
    const eff = r.promoted && r.best ? r.best : r.default;
    families[h.id] = { promoted: r.promoted, reason: r.reason, rule: eff.rule, spec: eff.spec, oos: pack(r.oos), defaultOos: pack(r.defaultOos), inSample: r.inSample ? pack(r.inSample) : null, tested: r.tested, folds: r.folds };
    const o = r.oos;
    console.log(`${r.promoted ? "PROMOTED" : "kept default"}`);
    console.log(`  walk-forward OOS: n=${o.n} hit ${o.hit.toFixed(0)}% (${o.hitLo.toFixed(0)}-${o.hitHi.toFixed(0)}) mean ${o.mean.toFixed(2)} edge ${o.edge.toFixed(2)} t=${o.t.toFixed(1)} p=${o.p.toFixed(3)}`);
    const d = r.defaultOos;
    console.log(`  default OOS:      n=${d.n} hit ${d.hit.toFixed(0)}% mean ${d.mean.toFixed(2)} edge ${d.edge.toFixed(2)} p=${d.p.toFixed(3)}`);
    if (r.inSample) console.log(`  best in-sample (flattering): n=${r.inSample.n} mean ${r.inSample.mean.toFixed(2)} edge ${r.inSample.edge.toFixed(2)} p=${r.inSample.p.toFixed(3)}`);
    if (r.best) console.log(`  best setting: ${JSON.stringify(r.best.rule)} ${JSON.stringify(r.best.spec)}`);
    console.log(`  ${r.reason}\n`);
  }
  const file: TunedFile = { trainedAt: new Date().toISOString(), window: { from: day(end - WINDOW_MS), to: day(win.endMs - DAY_MS) }, universe: Object.keys(data).length, families };
  writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${OUT}`);
}

void main();
