/**
 * Event study of what big funds buy and sell, from their SEC 13F-HR filings (about ten years) and ARK's published daily trades.
 *
 *   npm run funds:signals                     cached SEC downloads and bars, fetches what is missing
 *   npm run funds:signals -- --refresh        re-download bars (SEC files stay cached)
 *   npm run funds:signals -- --funds=BRK,ARK  only these filers (ids from scripts/fund-sources.ts)
 *
 * Events: new position, increase of 50%+, trim of 50%+, full exit, dated at the FILING date (when it is public), never the
 * quarter end. Return is measured from the next open after that date, raw and in excess of ^GSPC, at 1/5/20/60 trading days.
 * ARK daily trades come from arkfunds.io (unofficial mirror of ARK's published trades, 2020-09 on). CUSIPs are mapped to
 * tickers by issuer name against the SEC ticker list plus ARK's own CUSIP/ticker pairs; unmapped lines are skipped and the
 * match rate is reported. Writes data/fund-signals.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHANGE_TYPES,
  HORIZONS,
  KIND_LABEL,
  cellOf,
  dateMs,
  diff13F,
  excessReturn,
  lastBarOnOrBefore,
  monthlyCurve,
  normName,
  parseInfoTable,
  testedSummary,
  valueUsd,
  type Cell,
  type ChangeType,
  type FundInfo,
  type FundSignalsFile,
  type Holding13F,
  type LatestFiling,
  type RuleResult,
  type RuleTrade,
} from "../lib/fund-signals";
import { simulateTrade, summarise, type MBar, type TradeSpec } from "../lib/model";
import { DAY_MS } from "../lib/trades";
import { ARK_FUNDS, FILERS, arkTradesApi, edgarFilerUrl } from "./fund-sources";
import { DIR, fetchBars } from "./research-data";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const only = args.find((a) => a.startsWith("--funds="))?.slice(8).split(",");
const CACHE = join(DIR, "f13");
const OUT = join(process.cwd(), "data", "fund-signals.json");
const UA = process.env.SEC_USER_AGENT || "Meridian/1.0 (+https://github.com/faithrf/analytics-website)";
const GAP_MS = 220; // under 5 requests a second, SEC allows 10
const FROM = Date.now() - 10.3 * 365.25 * DAY_MS;
const MIN_USD = 50e6; // an event needs a position of at least this size (larger of before and after)
const MIN_WEIGHT = 1; // ... or this share of the fund's 13F portfolio, percent

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(CACHE, { recursive: true });

async function sec(url: string, name: string, keep = true): Promise<string> {
  const file = join(CACHE, name);
  if (keep && existsSync(file)) return readFileSync(file, "utf8");
  let err: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
      await sleep(GAP_MS);
      if (res.status === 404) throw Object.assign(new Error("404"), { final: true });
      if (!res.ok) throw new Error(`SEC ${res.status} ${url}`);
      const text = await res.text();
      if (keep) writeFileSync(file, text);
      return text;
    } catch (e) {
      err = e;
      if ((e as { final?: boolean }).final) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw err;
}

type Filing = { acc: string; filed: string; period: string };
type Recent = { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[] };

const pick = (r: Recent): Filing[] => r.form.map((f, i) => (f === "13F-HR" ? { acc: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate[i] } : null)).filter((x): x is Filing => !!x);

async function listFilings(cik: string): Promise<Filing[]> {
  const sub = JSON.parse(await sec(`https://data.sec.gov/submissions/CIK${cik}.json`, `sub-${cik}.json`, false));
  const all = pick(sub.filings.recent);
  for (const f of (sub.filings.files ?? []) as { name: string; filingTo: string }[]) {
    if (new Date(f.filingTo).getTime() < FROM) continue;
    all.push(...pick(JSON.parse(await sec(`https://data.sec.gov/submissions/${f.name}`, `sub-${f.name}`, false))));
  }
  return all.filter((f) => dateMs(f.filed) >= FROM).sort((a, b) => (a.filed < b.filed ? -1 : 1));
}

/** Parsed holdings of one filing (cached as compact JSON), or null when it has no XML information table. */
async function holdings(cik: string, f: Filing): Promise<Holding13F[] | null> {
  const cache = join(CACHE, `h-${f.acc}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.acc.replace(/-/g, "")}`;
  const idx = JSON.parse(await sec(`${base}/index.json`, `i-${f.acc}.json`)) as { directory: { item: { name: string; size?: string }[] } };
  const xml = idx.directory.item.filter((i) => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name));
  const table = xml.find((i) => /info|table/i.test(i.name)) ?? xml.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  if (!table) return null;
  const h = parseInfoTable(await sec(`${base}/${table.name}`, "", false));
  writeFileSync(cache, JSON.stringify(h));
  return h;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

type Ev = { fund: string; kind: string; sym: string; filed: string };

async function main() {
  const filers = FILERS.filter((f) => !only || only.includes(f.id));
  const tick = JSON.parse(await sec("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", false)) as Record<string, { ticker: string; title: string }>;
  const byName = new Map<string, string>();
  for (const t of Object.values(tick)) {
    const k = normName(t.title);
    if (k && !byName.has(k)) byName.set(k, t.ticker);
  }

  // ARK daily trades, which also give CUSIP and ticker pairs for the mapping
  type ArkTrade = { fund: string; date: string; ticker: string; direction: string; cusip: string; etf_percent: number };
  const ark: ArkTrade[] = [];
  const seed = new Map<string, string>();
  for (const f of ARK_FUNDS) {
    const file = join(CACHE, `ark-${f.id}.json`);
    let raw: string;
    // the trade history only grows, so re-download after a day
    if (existsSync(file) && Date.now() - Date.parse(JSON.parse(readFileSync(file, "utf8")).fetched ?? 0) < DAY_MS) raw = readFileSync(file, "utf8");
    else {
      try {
        const res = await fetch(arkTradesApi(f.id, "2020-01-01"), { signal: AbortSignal.timeout(90_000) });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        raw = JSON.stringify({ fetched: new Date().toISOString(), trades: j.trades });
        writeFileSync(file, raw);
      } catch (e) {
        console.log(`${f.id}: arkfunds.io failed (${(e as Error).message})`);
        continue;
      }
    }
    for (const t of JSON.parse(raw).trades as ArkTrade[]) {
      ark.push(t);
      if (t.cusip && t.ticker) seed.set(t.cusip.length === 12 ? t.cusip.slice(2, 11) : t.cusip, t.ticker.toUpperCase());
    }
  }
  console.log(`ARK daily trades: ${ark.length} from ${ark.reduce((a, t) => (t.date < a ? t.date : a), "9999")}`);

  const mapCache = new Map<string, string | null>();
  const toTicker = (cusip: string, name: string) => {
    const k = `${cusip}`;
    if (!mapCache.has(k)) mapCache.set(k, seed.get(cusip) ?? byName.get(normName(name)) ?? null);
    return mapCache.get(k)!;
  };

  const funds: FundInfo[] = [];
  const events: Ev[] = [];
  const latest: LatestFiling[] = [];
  let lines = 0,
    mappedLines = 0,
    valueAll = 0,
    valueMapped = 0;

  for (const fd of filers) {
    let list: Filing[];
    try {
      list = await listFilings(fd.cik);
    } catch (e) {
      console.log(`${fd.id}: filings failed (${(e as Error).message})`);
      continue;
    }
    const info: FundInfo = { id: fd.id, name: fd.name, cik: fd.cik, filings: 0, first: "", last: "", events: { new: 0, increase: 0, trim: 0, exit: 0 } };
    let prev: { f: Filing; h: Holding13F[] } | null = null;
    for (const f of list) {
      let h: Holding13F[] | null;
      try {
        h = await holdings(fd.cik, f);
      } catch (e) {
        console.log(`${fd.id} ${f.filed}: ${(e as Error).message}`);
        h = null;
      }
      if (!h || !h.length) continue;
      info.filings++;
      info.first ||= f.filed;
      info.last = f.filed;
      const total = h.reduce((a, x) => a + valueUsd(x.value, f.filed), 0);
      for (const x of h) {
        lines++;
        valueAll += valueUsd(x.value, f.filed);
        if (toTicker(x.cusip, x.name)) {
          mappedLines++;
          valueMapped += valueUsd(x.value, f.filed);
        }
      }
      // diff only against the immediately preceding quarter's filing
      if (prev && dateMs(f.period) - dateMs(prev.f.period) < 130 * DAY_MS) {
        const keep = diff13F(prev.h, h)
          .map((c) => ({ ...c, usd: valueUsd(c.value, f.filed) }))
          .filter((c) => c.usd >= MIN_USD || (total > 0 && (c.usd / total) * 100 >= MIN_WEIGHT));
        for (const c of keep) {
          const sym = toTicker(c.cusip, c.name);
          info.events[c.type]++;
          if (sym) events.push({ fund: fd.id, kind: c.type, sym, filed: f.filed });
        }
        {
          const sorted = keep.sort((a, b) => b.usd - a.usd).slice(0, 25);
          const url = `https://www.sec.gov/Archives/edgar/data/${Number(fd.cik)}/${f.acc.replace(/-/g, "")}/`;
          const rec: LatestFiling = { fund: fd.id, filed: f.filed, period: f.period, url, changes: sorted.map((c) => ({ sym: toTicker(c.cusip, c.name), name: c.name, type: c.type, prev: c.prev, cur: c.cur, pct: c.pct === null ? null : r2(c.pct), usd: Math.round(c.usd) })) };
          const at = latest.findIndex((l) => l.fund === fd.id);
          if (at >= 0) latest[at] = rec;
          else latest.push(rec);
        }
      }
      prev = { f, h };
    }
    funds.push(info);
    console.log(`${fd.id}: ${info.filings} filings ${info.first}..${info.last}, events ${JSON.stringify(info.events)}`);
  }

  // ARK: fresh buys and sells, no earlier ARK trade in that ticker in the previous 20 days, trade of at least 0.1% of the fund
  const arkSorted = ark.filter((t) => t.ticker).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lastSeen = new Map<string, number>();
  for (const t of arkSorted) {
    const sym = t.ticker.toUpperCase();
    const ms = dateMs(t.date);
    const prevMs = lastSeen.get(sym) ?? -Infinity;
    lastSeen.set(sym, ms);
    if (ms - prevMs < 20 * DAY_MS || !(t.etf_percent >= 0.1)) continue;
    events.push({ fund: t.fund, kind: t.direction === "Sell" ? "ark-sell" : "ark-buy", sym, filed: t.date });
  }

  // bars
  const mkt = await fetchBars("^GSPC", refresh);
  const syms = [...new Set(events.map((e) => e.sym))];
  const bars = new Map<string, MBar[]>();
  const missing: string[] = [];
  let n = 0;
  for (const s of syms) {
    n++;
    try {
      bars.set(s, await fetchBars(s, refresh));
    } catch {
      missing.push(s);
    }
    if (n % 100 === 0) console.log(`bars ${n}/${syms.length}`);
  }
  console.log(`bars: ${bars.size} of ${syms.length} tickers, ${missing.length} without data (delisted or renamed)`);

  // event study
  const pool = new Map<string, number[]>(); // fund|kind|h -> excess returns
  const push = (k: string, v: number) => (pool.get(k) ?? pool.set(k, []).get(k)!).push(v);
  const used: Ev[] = [];
  for (const e of events) {
    const b = bars.get(e.sym);
    if (!b) continue;
    const ms = dateMs(e.filed);
    let any = false;
    for (const h of HORIZONS) {
      const r = excessReturn(b, mkt, ms, h);
      if (!r) continue;
      any = true;
      push(`${e.fund}|${e.kind}|${h}`, r.ex);
      push(`ALL|${e.kind}|${h}`, r.ex);
    }
    if (any) used.push(e);
  }
  const cells: Cell[] = [...pool].map(([k, xs]) => {
    const [f, kind, h] = k.split("|");
    return cellOf(f, kind, Number(h) as (typeof HORIZONS)[number], xs.map(r2));
  });
  const isArk = (k: string) => k.startsWith("ark-");
  const study = cells.filter((c) => !isArk(c.k));
  const arkCells = cells.filter((c) => isArk(c.k));
  const roundCell = (c: Cell): Cell => ({ ...c, m: r2(c.m), hit: Math.round(c.hit), t: r2(c.t) });

  // tradeable rules: buy at the next open after the filing/trade date, hold N trading days
  const spec = (hold: number): TradeSpec => ({ instrument: "long", entry: "next-open", holdDays: hold, otmPct: 0, dte: 0, ivBump: 1, costBps: 10 });
  function rule(id: string, label: string, desc: string, pred: (e: Ev) => boolean, hold: number): RuleResult {
    const trades: RuleTrade[] = [];
    for (const e of used) {
      if (!pred(e)) continue;
      const b = bars.get(e.sym)!;
      const ms = dateMs(e.filed);
      const o = simulateTrade(b, lastBarOnOrBefore(b, ms), spec(hold));
      const m = simulateTrade(mkt, lastBarOnOrBefore(mkt, ms), spec(hold));
      if (!o || !m || o.entryT !== m.entryT) continue;
      trades.push({ exitMs: o.exitT, ret: o.ret, mkt: m.ret });
    }
    const rs = summarise(trades.map((t) => t.ret));
    const bs = summarise(trades.map((t) => t.mkt));
    const excess = trades.length ? trades.reduce((a, t) => a + t.ret - t.mkt, 0) / trades.length : 0;
    const rd = (s: typeof rs) => ({ ...s, winRate: r2(s.winRate), avg: r2(s.avg), median: r2(s.median), best: r2(s.best), worst: r2(s.worst), compounded: 0 });
    return { id, label, desc, trades: trades.length, stats: rd(rs), bench: rd(bs), excess: r2(excess), curve: monthlyCurve(trades) };
  }
  const rules = [
    rule("f13-up60", "13F new or increased, hold 60 days", "Buy the next open after any tracked fund files a new position or a 50%+ increase; sell after 60 trading days. 10 bps round-trip cost.", (e) => e.kind === "new" || e.kind === "increase", 60),
    rule("f13-new60", "13F new positions only, hold 60 days", "As above, new positions only.", (e) => e.kind === "new", 60),
    rule("ark-buy20", "ARK fresh buy, hold 20 days", "Buy the next open after ARK first buys a ticker in 20+ days (0.1%+ of a fund); sell after 20 trading days.", (e) => e.kind === "ark-buy", 20),
  ];

  const tested = testedSummary([...study, ...arkCells]);
  const out: FundSignalsFile = {
    updatedAt: new Date().toISOString(),
    note: "13F events are dated at the filing date (up to 45 days after quarter end) and entered at the next open. Excess is versus ^GSPC over the same window, percent.",
    match: { lines, mapped: mappedLines, pct: r2((100 * mappedLines) / Math.max(1, lines)), valuePct: r2((100 * valueMapped) / Math.max(1, valueAll)) },
    funds,
    study: study.map(roundCell),
    ark: arkCells.map(roundCell),
    tested,
    rules,
    latest,
    sources: [
      ...filers.map((f) => ({ label: `${f.name} 13F filings`, url: edgarFilerUrl(f.cik) })),
      { label: "ARK daily trades (arkfunds.io mirror)", url: "https://arkfunds.io/" },
    ],
  };
  writeFileSync(OUT, JSON.stringify(out));

  console.log(`\nMapped ${out.match.pct}% of 13F lines (${out.match.valuePct}% of value). Events used ${used.length} of ${events.length}.`);
  console.log(`Cells: ${tested.cells}, with n>=30: ${tested.testable}, significant (|t|>=2): ${tested.flagged}, expected by chance ~${tested.expectedByChance}`);
  for (const c of [...cells].filter((c) => c.n >= 30 && Math.abs(c.t) >= 2).sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 25)) console.log(`  ${c.f} ${KIND_LABEL[c.k] ?? c.k} ${c.h}d n=${c.n} mean ${c.m.toFixed(2)}% hit ${c.hit.toFixed(0)}% t=${c.t.toFixed(2)}`);
  for (const k of CHANGE_TYPES as ChangeType[]) {
    const row = HORIZONS.map((h) => cells.find((c) => c.f === "ALL" && c.k === k && c.h === h)).map((c) => (c ? `${c.h}d ${c.m.toFixed(2)}% t=${c.t.toFixed(1)} n=${c.n}` : "-"));
    console.log(`ALL ${k}: ${row.join(" | ")}`);
  }
  for (const r of rules) console.log(`rule ${r.id}: ${r.trades} trades, avg ${r.stats.avg}% vs market ${r.bench.avg}% (excess ${r.excess}), win ${r.stats.winRate}%`);
  console.log(`wrote ${OUT} (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
