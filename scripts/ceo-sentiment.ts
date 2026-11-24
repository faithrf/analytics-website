/**
 * Backtests CEO-statement sentiment against the next 1/5/20 trading days.
 *
 *   npm run ceo:sentiment              cached SEC downloads and bars, fetches what is missing
 *   npm run ceo:sentiment -- --refresh  re-download bars (SEC files stay cached)
 *
 * Source: SEC EDGAR 8-K earnings releases (Item 2.02, EX-99.1) of the US_MEGA tickers. Quotes attributed to the
 * CEO are scored with the lexicon in lib/ceo-sentiment.ts, then compared with the move from the next open,
 * raw and in excess of ^GSPC. Writes data/ceo-sentiment.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractCeoQuotes, htmlToText, scoreText, splitOf, type CeoSentimentFile, type CeoStatement } from "../lib/ceo-sentiment";
import { US_MEGA, type MBar } from "../lib/model";
import { DAY_MS } from "../lib/trades";
import { DIR, fetchBars } from "./research-data";

const refresh = process.argv.includes("--refresh");
const CACHE = join(DIR, "ceo");
const OUT = join(process.cwd(), "data", "ceo-sentiment.json");
const UA = process.env.SEC_USER_AGENT || "Meridian/1.0 (+https://github.com/faithrf/analytics-website)";
const GAP_MS = 200; // about 5 requests a second, SEC allows 10
const HORIZONS = [1, 5, 20] as const;
const FROM = Date.now() - 10 * 365.25 * DAY_MS; // bars only go back ten years

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(CACHE, { recursive: true });

async function sec(url: string, name: string): Promise<string> {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  let err: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(30_000) });
      await sleep(GAP_MS);
      if (res.status === 404) throw Object.assign(new Error("404"), { final: true });
      if (!res.ok) throw new Error(`SEC ${res.status} ${url}`);
      const text = await res.text();
      writeFileSync(file, text);
      return text;
    } catch (e) {
      err = e;
      if ((e as { final?: boolean }).final) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw err;
}

type Filing = { acc: string; date: string; accepted: string; items: string };
type Recent = { accessionNumber: string[]; filingDate: string[]; acceptanceDateTime: string[]; form: string[]; items: string[] };

function pick8k(r: Recent): Filing[] {
  const out: Filing[] = [];
  r.form.forEach((f, i) => {
    if (f === "8-K" && /2\.02/.test(r.items[i] ?? "")) out.push({ acc: r.accessionNumber[i], date: r.filingDate[i], accepted: r.acceptanceDateTime[i], items: r.items[i] });
  });
  return out;
}

async function listFilings(cik: string): Promise<Filing[]> {
  const sub = JSON.parse(await sec(`https://data.sec.gov/submissions/CIK${cik}.json`, `sub-${cik}.json`));
  const all = pick8k(sub.filings.recent);
  for (const f of (sub.filings.files ?? []) as { name: string; filingTo: string }[]) {
    if (new Date(f.filingTo).getTime() < FROM) continue;
    all.push(...pick8k(JSON.parse(await sec(`https://data.sec.gov/submissions/${f.name}`, `sub-${f.name}`))));
  }
  return all.filter((f) => new Date(f.date).getTime() >= FROM);
}

/** Text of the EX-99.1 (or EX-99) exhibit of one filing, or null. */
async function pressRelease(cik: string, f: Filing): Promise<string | null> {
  const nodash = f.acc.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${nodash}`;
  const idx = await sec(`${base}/${f.acc}-index.htm`, `idx-${f.acc}.htm`);
  for (const row of idx.split(/<tr[ >]/i)) {
    if (!/>\s*EX-99(\.1)?\s*</i.test(row)) continue;
    const href = /href="([^"]+)"/i.exec(row)?.[1];
    if (!href) continue;
    const path = href.replace(/^\/ix\?doc=/, "");
    const url = path.startsWith("http") ? path : `https://www.sec.gov${path}`;
    return sec(url, `doc-${f.acc}-${path.split("/").pop()}`);
  }
  return null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Open of the entry day to the close h-1 trading days later, in percent. */
function ret(bars: MBar[], i: number, h: number): number | null {
  const j = i + h - 1;
  if (i < 0 || j >= bars.length) return null;
  const o = bars[i].open ?? bars[i - 1]?.close;
  return o ? (bars[j].close / o - 1) * 100 : null;
}

async function main() {
  const tickers = await (async () => JSON.parse(await sec("https://www.sec.gov/files/company_tickers.json", "company_tickers.json")) as Record<string, { cik_str: number; ticker: string }>)();
  const cikOf = new Map(Object.values(tickers).map((t) => [t.ticker, String(t.cik_str).padStart(10, "0")]));
  const mkt = await fetchBars("^GSPC", refresh);
  const rows: CeoStatement[] = [];
  let filings = 0;

  for (const sym of US_MEGA) {
    const cik = cikOf.get(sym);
    if (!cik) {
      console.log(`${sym}: no CIK`);
      continue;
    }
    let bars: MBar[];
    try {
      bars = await fetchBars(sym, refresh);
    } catch (e) {
      console.log(`${sym}: no bars (${(e as Error).message})`);
      continue;
    }
    let list: Filing[];
    try {
      list = await listFilings(cik);
    } catch (e) {
      console.log(`${sym}: filings failed (${(e as Error).message})`);
      continue;
    }
    let found = 0;
    for (const f of list) {
      let html: string | null;
      try {
        html = await pressRelease(cik, f);
      } catch {
        continue;
      }
      if (!html) continue;
      filings++;
      const quotes = extractCeoQuotes(htmlToText(html));
      if (!quotes.length) continue;
      // released before the US open: trade that day's open, otherwise the next session's
      const acc = new Date(f.accepted);
      const day = Date.UTC(+f.date.slice(0, 4), +f.date.slice(5, 7) - 1, +f.date.slice(8, 10));
      const early = acc.getUTCHours() * 60 + acc.getUTCMinutes() < 12 * 60 + 30; // before 8:30 ET at the latest
      const entryDay = early ? day : day + 1; // first bar on or after
      const i = bars.findIndex((b) => b.t >= entryDay);
      const k = mkt.findIndex((b) => b.t >= entryDay);
      if (i < 0 || bars[i].t - entryDay > 5 * DAY_MS) continue;
      for (const q of quotes) {
        const s = scoreText(q.text);
        const row: CeoStatement = { d: f.date, sym, ceo: q.speaker, s: r3(s.score), u: r3(s.uncertainty), q: q.text.length > 200 ? `${q.text.slice(0, 197)}...` : q.text, r1: null, r5: null, r20: null, e1: null, e5: null, e20: null };
        for (const h of HORIZONS) {
          const a = ret(bars, i, h);
          const m = k >= 0 ? ret(mkt, k, h) : null;
          if (a === null) continue;
          row[`r${h}`] = r2(a);
          if (m !== null && bars[i].t === mkt[k].t) row[`e${h}`] = r2(a - m);
        }
        rows.push(row);
        found++;
      }
    }
    console.log(`${sym}: ${list.length} earnings 8-Ks, ${found} CEO statements`);
  }

  rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.sym.localeCompare(b.sym)));
  const ex = (key: "e1" | "e5" | "e20", rs: CeoStatement[]) => splitOf(rs.map((x) => ({ score: x.s, ex: x[key] })));
  const groups = new Map<string, CeoStatement[]>();
  for (const r of rows) (groups.get(`${r.ceo}|${r.sym}`) ?? groups.set(`${r.ceo}|${r.sym}`, []).get(`${r.ceo}|${r.sym}`)!).push(r);
  const byCeo = [...groups]
    .filter(([, rs]) => rs.length >= 6)
    .map(([k, rs]) => ({ ceo: k.split("|")[0], sym: k.split("|")[1], e5: ex("e5", rs), e20: ex("e20", rs) }))
    .sort((a, b) => b.e20.n - a.e20.n);

  const out: CeoSentimentFile = {
    updatedAt: new Date().toISOString(),
    note: "Sentiment of CEO quotes in 8-K earnings releases, then return from the next open (excess is versus ^GSPC, percent). Terciles are by sentiment score.",
    statements: rows,
    overall: rows.length ? { e1: ex("e1", rows), e5: ex("e5", rows), e20: ex("e20", rows) } : null,
    byCeo,
  };
  const round = (_: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  writeFileSync(OUT, JSON.stringify(out, round));

  console.log(`\n${filings} releases read, ${rows.length} statements, ${new Set(rows.map((r) => r.ceo)).size} CEOs`);
  if (out.overall) {
    for (const h of ["e1", "e5", "e20"] as const) {
      const o = out.overall[h];
      const f = (s: { n: number; mean: number; hit: number; t: number }) => `n=${s.n} mean ${s.mean.toFixed(2)}% hit ${s.hit.toFixed(0)}% t=${s.t.toFixed(1)}`;
      console.log(`${h} excess  low: ${f(o.low)} | mid: ${f(o.mid)} | high: ${f(o.high)} | corr ${o.corr.toFixed(3)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
