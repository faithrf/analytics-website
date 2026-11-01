import "server-only";
import { inflateRawSync } from "node:zlib";
import { ApiError } from "@/lib/api";
import { TtlCache } from "@/lib/cache";
import { mergeRows, WEEK_DAYS } from "@/lib/leaders-shared";
import type { CongressData, HouseFiling, InsidersData, LeaderRow, StakesData } from "@/lib/leaders-shared";

/**
 * Public trade disclosures: SEC Form 4 (insiders), STOCK Act reports (Congress)
 * and Schedule 13D/13G (5% stakes). Every fetch is polite: a declared
 * User-Agent, spaced-out SEC requests, long caches, and stale copies on error.
 */

/** SEC fair access asks for a declared agent; set SEC_USER_AGENT to add your own contact. */
const UA = () => process.env.SEC_USER_AGENT || "Meridian/1.0 (+https://github.com/faithrf/analytics-website)";
const SEC_GAP_MS = 130; // about 7 requests a second, under the SEC's 10
const FORM4_PER_REFRESH = 40;
const STAKE_DETAIL_PER_REFRESH = 25;

const HOUR = 3_600_000;
const INSIDER_TTL = 10 * 60_000;
const STAKES_TTL = 10 * 60_000;
const HOUSE_TTL = 15 * 60_000;

/** Surface a failed source as a clear 502 instead of the Yahoo-worded default. */
const upstream = (what: string) => (): never => {
  throw new ApiError(502, "upstream", `Could not load ${what}. Data will retry shortly.`);
};

/* ---------- small helpers ---------- */

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unescapeXml = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    return entities[e.toLowerCase()] ?? m;
  });

/** Text of the first <tag>...</tag>, or "". */
function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? unescapeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : "";
}
/** <tag><value>X</value></tag> as used throughout ownership documents. */
const val = (xml: string, name: string) => tag(tag(xml, name), "value") || tag(xml, name);
const blocks = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s.'(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const g = globalThis as unknown as {
  __leaders2?: {
    store: { insiders: Map<string, LeaderRow>; congress: Map<string, LeaderRow>; stakes: Map<string, LeaderRow> };
    since: number;
    data: TtlCache<unknown>;
    filings: TtlCache<LeaderRow[]>;
    detail: TtlCache<string>;
    secChain: Promise<unknown>;
    bargo: { blockedUntil: number };
  };
};
const shared = (g.__leaders2 ??= {
  store: { insiders: new Map(), congress: new Map(), stakes: new Map() },
  since: Date.now(),
  data: new TtlCache<unknown>(20),
  filings: new TtlCache<LeaderRow[]>(3000),
  detail: new TtlCache<string>(1000),
  secChain: Promise.resolve(),
  bargo: { blockedUntil: 0 },
});

/** One SEC request at a time, spaced SEC_GAP_MS apart. */
function secFetch(url: string): Promise<string> {
  const run = shared.secChain.then(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": UA(), Accept: "application/xml,text/html,*/*" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    await new Promise((r) => setTimeout(r, SEC_GAP_MS));
    if (!res.ok) throw new Error(`SEC ${res.status}`);
    return res.text();
  });
  shared.secChain = run.catch(() => {});
  return run;
}

/* ---------- EDGAR "current filings" atom ---------- */

export interface AtomEntry {
  accession: string;
  /** form type, e.g. "4" or "SCHEDULE 13D/A" */
  form: string;
  name: string;
  /** role EDGAR gives the name: Issuer, Reporting, Subject, Filed by */
  role: string;
  link: string;
  updated: string;
}

export function parseEdgarAtom(xml: string): AtomEntry[] {
  const out: AtomEntry[] = [];
  for (const e of blocks(xml, "entry")) {
    const title = tag(e, "title");
    const m = /^(.+?) - (.+?) \((\d{6,10})\)(?: \(([^)]+)\))?$/.exec(title);
    const acc = /accession-number=(\d{10}-\d{2}-\d{6})/.exec(e)?.[1];
    const link = /<link[^>]*href="([^"]+)"/.exec(e)?.[1];
    const updated = tag(e, "updated");
    if (!m || !acc || !link || !updated) continue;
    out.push({ accession: acc, form: m[1], name: m[2], role: m[4] ?? "", link: unescapeXml(link), updated });
  }
  return out;
}

const filedDate = (updated: string) => updated.slice(0, 10);
const filedMs = (updated: string) => {
  const t = Date.parse(updated);
  return Number.isNaN(t) ? null : t;
};

/* ---------- Form 4 ---------- */

const CODE_LABEL: Record<string, string> = {
  P: "Buy",
  S: "Sale",
  A: "Award",
  M: "Option exercise",
  F: "Tax withheld",
  G: "Gift",
  D: "To issuer",
  C: "Conversion",
  X: "Option exercise",
  J: "Other",
  W: "Will/inheritance",
  I: "Discretionary",
};

/** Rows for one Form 4 ownership document (open-market and other non-derivative lines). */
export function parseForm4(
  xml: string,
  meta: { accession: string; url: string; filed: string; filedAt: number | null },
): LeaderRow[] {
  const doc = blocks(xml, "ownershipDocument")[0] ?? xml;
  const issuer = tag(doc, "issuer");
  const company = tag(issuer, "issuerName");
  const ticker = tag(issuer, "issuerTradingSymbol").toUpperCase();
  const owners = blocks(doc, "reportingOwner");
  const who = owners.map((o) => titleCase(tag(tag(o, "reportingOwnerId"), "rptOwnerName"))).filter(Boolean);
  const rel = tag(owners[0] ?? "", "reportingOwnerRelationship");
  const flag = (n: string) => /^(1|true)$/i.test(tag(rel, n));
  const role =
    tag(rel, "officerTitle") ||
    (flag("isDirector") ? "Director" : flag("isTenPercentOwner") ? "10% owner" : flag("isOfficer") ? "Officer" : tag(rel, "otherText"));
  if (!who.length || !company) return [];

  const merged = new Map<string, { code: string; date: string; price: number | null; shares: number }>();
  for (const t of blocks(doc, "nonDerivativeTransaction")) {
    const code = tag(tag(t, "transactionCoding"), "transactionCode").toUpperCase();
    const date = val(t, "transactionDate").slice(0, 10);
    const shares = parseFloat(val(t, "transactionShares"));
    const price = parseFloat(val(t, "transactionPricePerShare"));
    if (!code || !date || !Number.isFinite(shares)) continue;
    const p = Number.isFinite(price) ? price : null;
    const key = `${code}|${date}|${p}`;
    const cur = merged.get(key);
    if (cur) cur.shares += shares;
    else merged.set(key, { code, date, price: p, shares });
  }
  return [...merged.values()].map((t, i) => {
    const value = t.price !== null && t.price > 0 ? t.shares * t.price : null;
    const size =
      `${Math.round(t.shares).toLocaleString("en-US")} sh` +
      (t.price ? ` @ $${t.price.toFixed(2)}` : "") +
      (value ? ` = ${money(value)}` : "");
    return {
      id: `${meta.accession}:${i}`,
      who: who.join(", "),
      sub: role || undefined,
      ticker: ticker || undefined,
      company,
      action: CODE_LABEL[t.code] ?? t.code,
      side: t.code === "P" ? "buy" : t.code === "S" ? "sell" : "other",
      code: t.code,
      size,
      traded: t.date,
      filed: meta.filed,
      filedAt: meta.filedAt,
      url: meta.url,
    } satisfies LeaderRow;
  });
}

async function loadInsiders(): Promise<InsidersData> {
  const atom = await secFetch("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&output=atom&count=100");
  // each filing is listed twice (issuer and reporting owner): keep one entry per accession
  const seen = new Map<string, AtomEntry>();
  for (const e of parseEdgarAtom(atom)) if (/^4(\/A)?$/.test(e.form) && !seen.has(e.accession)) seen.set(e.accession, e);
  const listed = [...seen.values()].sort((a, b) => b.updated.localeCompare(a.updated));

  let budget = FORM4_PER_REFRESH;
  let scanned = 0;
  const rows: LeaderRow[] = [];
  for (const e of listed) {
    let got = shared.filings.get(e.accession);
    if (!got && budget > 0) {
      budget--;
      try {
        // the complete submission text holds the ownership XML, so one request per filing
        const txt = await secFetch(e.link.replace(/-index\.html?$/, ".txt"));
        got = parseForm4(txt, { accession: e.accession, url: e.link, filed: filedDate(e.updated), filedAt: filedMs(e.updated) });
        shared.filings.set(e.accession, got, 24 * HOUR);
        scanned++;
      } catch {
        shared.filings.set(e.accession, [], INSIDER_TTL); // retry on a later refresh
      }
    }
    if (got) rows.push(...got);
  }
  const now = Date.now();
  return { rows: mergeRows(shared.store.insiders, rows, now), scanned, listed: listed.length, fetchedAt: now, since: shared.since };
}

export const getInsiders = () =>
  shared.data.getOrLoad("insiders", INSIDER_TTL, loadInsiders, { staleOnError: true, swrMs: HOUR }).catch(upstream("SEC Form 4 filings")) as Promise<InsidersData>;

/* ---------- Schedule 13D / 13G ---------- */

/** "Period of Report" (the event date) from a filing index page, if it lists one. */
export function parsePeriod(html: string): string | null {
  const m = /Period of Report<\/div>\s*<div[^>]*>\s*(\d{4}-\d{2}-\d{2})/i.exec(html);
  return m ? m[1] : null;
}

async function loadStakes(): Promise<StakesData> {
  const feeds = await Promise.allSettled(
    ["SCHEDULE%2013D", "SCHEDULE%2013G"].map((t) =>
      secFetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${t}&output=atom&count=40`),
    ),
  );
  if (feeds.every((f) => f.status === "rejected")) throw (feeds[0] as PromiseRejectedResult).reason;
  const byAcc = new Map<string, { form: string; link: string; updated: string; subject?: string; filer?: string; any: string }>();
  for (const f of feeds) {
    if (f.status !== "fulfilled") continue;
    for (const e of parseEdgarAtom(f.value)) {
      if (!/13[DG]/i.test(e.form)) continue;
      const cur = byAcc.get(e.accession) ?? { form: e.form, link: e.link, updated: e.updated, any: e.name };
      if (/subject/i.test(e.role)) cur.subject = e.name;
      else if (/filed by/i.test(e.role)) cur.filer = e.name;
      byAcc.set(e.accession, cur);
    }
  }
  const listed = [...byAcc.entries()].sort((a, b) => b[1].updated.localeCompare(a[1].updated));
  let budget = STAKE_DETAIL_PER_REFRESH;
  const rows: LeaderRow[] = [];
  for (const [acc, e] of listed) {
    let period = shared.detail.get(acc);
    if (period === undefined && budget > 0) {
      budget--;
      try {
        period = parsePeriod(await secFetch(e.link)) ?? "";
        shared.detail.set(acc, period, 24 * HOUR);
      } catch {
        period = undefined;
      }
    }
    rows.push({
      id: acc,
      who: titleCase(e.filer ?? e.any),
      company: titleCase(e.subject ?? e.any),
      action: e.form.replace(/^SCHEDULE /i, ""),
      side: "other",
      traded: period || null,
      filed: filedDate(e.updated),
      filedAt: filedMs(e.updated),
      url: e.link,
    });
  }
  const now = Date.now();
  return { rows: mergeRows(shared.store.stakes, rows, now), fetchedAt: now, since: shared.since };
}

export const getStakes = () =>
  shared.data.getOrLoad("stakes", STAKES_TTL, loadStakes, { staleOnError: true, swrMs: HOUR }).catch(upstream("SEC Schedule 13D/13G filings")) as Promise<StakesData>;

/* ---------- House Clerk filing index ---------- */

/** Contents of the entry whose name ends with `suffix` in a zip, via the central directory. */
export function unzipEntry(zip: Buffer, suffix: string): string | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_600); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && zip.readUInt32LE(p) === 0x02014b50; n++) {
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28);
    const xlen = zip.readUInt16LE(p + 30);
    const clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nlen);
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + csize);
      const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
      return raw ? raw.toString("utf8").replace(/^﻿/, "") : null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

/** M/D/YYYY to YYYY-MM-DD. */
function usDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** Periodic transaction reports (type P) filed on or after `since` (YYYY-MM-DD), newest first. */
export function parseHouseIndex(xml: string, since: string): HouseFiling[] {
  const out: HouseFiling[] = [];
  for (const m of blocks(xml, "Member")) {
    if (tag(m, "FilingType") !== "P") continue;
    const filed = usDate(tag(m, "FilingDate"));
    const year = tag(m, "Year");
    const doc = tag(m, "DocID");
    if (!filed || filed < since || !/^\d{4}$/.test(year) || !/^\d+$/.test(doc)) continue;
    const name = [tag(m, "Prefix"), tag(m, "First"), tag(m, "Last"), tag(m, "Suffix")].filter(Boolean).join(" ");
    out.push({
      id: doc,
      name,
      state: tag(m, "StateDst"),
      filed,
      url: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${doc}.pdf`,
    });
  }
  return out.sort((a, b) => b.filed.localeCompare(a.filed) || b.id.localeCompare(a.id));
}

async function loadHouse(): Promise<{ filings: HouseFiling[]; at: number }> {
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const res = await fetch(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`, {
    headers: { "User-Agent": UA() },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`House Clerk ${res.status}`);
  const xml = unzipEntry(Buffer.from(await res.arrayBuffer()), `${year}FD.xml`);
  if (!xml) throw new Error("House index unreadable");
  return { filings: parseHouseIndex(xml, new Date(now - WEEK_DAYS * 86_400_000).toISOString().slice(0, 10)), at: now };
}

/* ---------- Congress (Bargo) ---------- */

interface BargoTrade {
  member?: string;
  member_slug?: string;
  chamber?: string;
  state?: string;
  ticker?: string | null;
  asset?: string;
  type?: string;
  amount_range?: string;
  transaction_date?: string;
  disclosure_date?: string;
  filing_portal?: string;
}

export function mapBargo(json: unknown): LeaderRow[] {
  const trades = (json as { trades?: BargoTrade[] } | null)?.trades;
  if (!Array.isArray(trades)) return [];
  const rows: LeaderRow[] = [];
  for (const t of trades) {
    if (!t.member || !t.disclosure_date) continue;
    const type = (t.type ?? "").toLowerCase();
    const side = /purchase|buy/.test(type) ? "buy" : /sale|sell/.test(type) ? "sell" : "other";
    const portal =
      t.filing_portal && /^https?:\/\//.test(t.filing_portal) ? t.filing_portal : "https://disclosures-clerk.house.gov/FinancialDisclosure";
    const ticker = t.ticker && /^[A-Z0-9.-]{1,8}$/i.test(t.ticker) ? t.ticker.toUpperCase() : undefined;
    rows.push({
      id: [t.member_slug ?? t.member, ticker ?? t.asset, t.transaction_date, t.disclosure_date, type, t.amount_range].join("|"),
      who: t.member,
      sub: [t.chamber ? t.chamber[0].toUpperCase() + t.chamber.slice(1) : "", t.state].filter(Boolean).join(" · "),
      ticker,
      company: t.asset,
      action: type ? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Trade",
      side,
      size: t.amount_range,
      traded: t.transaction_date ?? null,
      filed: t.disclosure_date,
      url: portal,
    });
  }
  return rows;
}

/**
 * Keyless use is capped at 30 calls and 100 rows a day; a free key allows 1000 rows.
 * Pull 20 rows every 6 h keyless (80 a day) or 40 every hour with a key (960 a day).
 */
const bargoPlan = () => {
  const key = process.env.BARGO_API_KEY;
  return key ? { key, limit: 40, ttl: HOUR } : { key: undefined, limit: 20, ttl: 6 * HOUR };
};

async function loadBargo(): Promise<LeaderRow[]> {
  const plan = bargoPlan();
  if (Date.now() < shared.bargo.blockedUntil) throw new Error("Bargo daily budget used");
  const res = await fetch(`https://www.bargo.ai/free-apis/congress/v1/trades?limit=${plan.limit}&page=1`, {
    headers: { Accept: "application/json", ...(plan.key ? { Authorization: `Bearer ${plan.key}` } : {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  // back off for a while when the day's rows or calls are nearly gone
  const rowsLeft = res.headers.get("x-ratelimit-rows-remaining");
  const callsLeft = res.headers.get("x-ratelimit-remaining");
  if (res.status === 429 || (rowsLeft !== null && Number(rowsLeft) < plan.limit) || (callsLeft !== null && Number(callsLeft) < 2)) {
    shared.bargo.blockedUntil = Date.now() + 6 * HOUR;
  }
  if (!res.ok) throw new Error(`Bargo ${res.status}`);
  return mapBargo(await res.json());
}

export async function getCongress(): Promise<CongressData> {
  const plan = bargoPlan();
  const [trades, house] = await Promise.allSettled([
    shared.data.getOrLoad("bargo", plan.ttl, async () => {
      const now = Date.now();
      return { rows: mergeRows(shared.store.congress, await loadBargo(), now), at: now };
    }, {
      staleOnError: true,
      swrMs: 24 * HOUR,
    }) as Promise<{ rows: LeaderRow[]; at: number }>,
    shared.data.getOrLoad("house", HOUSE_TTL, loadHouse, { staleOnError: true, swrMs: HOUR }) as Promise<{
      filings: HouseFiling[];
      at: number;
    }>,
  ]);
  if (trades.status === "rejected" && house.status === "rejected") upstream("congressional trades")();
  return {
    rows: trades.status === "fulfilled" ? trades.value.rows : mergeRows(shared.store.congress, [], Date.now()),
    since: shared.since,
    fetchedAt: trades.status === "fulfilled" ? trades.value.at : Date.now(),
    house: house.status === "fulfilled" ? house.value.filings : [],
    houseFetchedAt: house.status === "fulfilled" ? house.value.at : null,
    refreshMin: plan.ttl / 60_000,
    keyed: !!plan.key,
  };
}
