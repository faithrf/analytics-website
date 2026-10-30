import "server-only";
import { TtlCache } from "@/lib/cache";
import type { RegionId } from "@/lib/markets";

/**
 * Headlines from public RSS / Atom / RDF feeds, kept to title, link, publisher
 * and time (no article text or images). Failures return [] and never throw.
 */

export interface FeedItem {
  title: string;
  link: string;
  publisher: string;
  /** epoch ms, null when the feed gives no usable date */
  time: number | null;
  /** feed this came from, for the "Sources" label */
  source?: string;
}

export interface MarketFeed {
  id: string;
  /** short name shown in the Sources label */
  name: string;
  url: string;
  /** markets the feed speaks to; empty = relevant to every market */
  regions: RegionId[];
}

export const MARKET_FEEDS: MarketFeed[] = [
  { id: "abc", name: "ABC", url: "https://www.abc.net.au/news/feed/104217374/rss.xml", regions: ["au"] },
  { id: "guardian", name: "Guardian", url: "https://www.theguardian.com/business/rss", regions: [] },
  {
    id: "cnbc",
    name: "CNBC",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
    regions: ["us"],
  },
  { id: "nasdaq", name: "Nasdaq", url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets", regions: ["us"] },
  { id: "scmp", name: "SCMP", url: "https://www.scmp.com/rss/92/feed", regions: ["hk"] },
  { id: "nikkei", name: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar", regions: ["jp", "hk"] },
];

const TIMEOUT_MS = 6000;
const MAX_CHARS = 3_000_000;
const PER_FEED = 30;
const FEED_TTL = 12 * 60_000;
const FEED_SWR = 60 * 60_000;
const FAIL_TTL = 60_000;
const USER_AGENT = "Mozilla/5.0 (compatible; MeridianDashboard/1.0; headline reader, links only)";

/* ---------- parsing ---------- */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  pound: "£",
  euro: "€",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** Plain text of a feed field: CDATA unwrapped, entities decoded, tags stripped. */
export function cleanText(raw: string): string {
  const t = decodeEntities(unCdata(raw)).replace(/<[^>]*>/g, " ");
  return decodeEntities(t).replace(/\s+/g, " ").trim();
}

function tagText(block: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i");
    const m = re.exec(block);
    if (m) {
      const v = cleanText(m[1]);
      if (v) return v;
    }
  }
  return null;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? "").trim() : null;
}

function entryLink(block: string): string | null {
  // Atom: <link href="..." rel="alternate"/>; prefer alternate / unspecified rel.
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const t of tags) {
    const href = attr(t, "href");
    if (!href) continue;
    const rel = attr(t, "rel");
    if (!rel || rel === "alternate") return href;
    fallback ??= href;
  }
  // RSS / RDF: <link>url</link>
  const text = tagText(block, ["link"]);
  if (text) return text;
  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
  if (guid && !/isPermaLink\s*=\s*["']false/i.test(guid[1])) {
    const g = cleanText(guid[2]);
    if (/^https?:\/\//i.test(g)) return g;
  }
  return fallback;
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Parse RSS 2.0, Atom or RDF text. Never throws. */
export function parseFeed(xml: string, fallbackPublisher = ""): FeedItem[] {
  if (typeof xml !== "string" || !xml) return [];
  const out: FeedItem[] = [];
  try {
    const blocks = xml.match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
    for (const b of blocks) {
      let title = tagText(b, ["title"]);
      const link = entryLink(b);
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
      let publisher = tagText(b, ["source"]) ?? fallbackPublisher;
      // Google News titles end in " - Publisher".
      if (/<source\b/i.test(b) || /news\.google\./i.test(link)) {
        const i = title.lastIndexOf(" - ");
        if (i > 0) {
          const tail = title.slice(i + 3).trim();
          if (tail && tail.length <= 60) {
            publisher = publisher && publisher !== fallbackPublisher ? publisher : tail;
            title = title.slice(0, i).trim();
          }
        }
      }
      const time = parseDate(tagText(b, ["pubDate", "dc:date", "published", "updated", "date"]));
      if (title) out.push({ title, link, publisher, time });
    }
  } catch {
    return [];
  }
  return out;
}

/* ---------- fetching ---------- */

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const text = await res.text();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

/** Fetch and parse one feed. Failure of any kind gives []. */
export async function fetchFeed(url: string, publisher = ""): Promise<FeedItem[]> {
  try {
    return parseFeed(await fetchText(url), publisher);
  } catch {
    return [];
  }
}

interface FeedShared {
  cache: TtlCache<FeedItem[]>;
}
const g = globalThis as unknown as { __feeds1?: FeedShared };
const shared: FeedShared = (g.__feeds1 ??= { cache: new TtlCache<FeedItem[]>(400) });

/** Cached fetch: stale copies are served on error / while refreshing; a dead feed is retried after a minute. */
async function cachedFeed(key: string, url: string, publisher: string, source: string): Promise<FeedItem[]> {
  try {
    return await shared.cache.getOrLoad(
      key,
      FEED_TTL,
      async () => {
        const items = parseFeed(await fetchText(url), publisher);
        return items.slice(0, PER_FEED).map((i) => ({ ...i, source }));
      },
      { staleOnError: true, swrMs: FEED_SWR },
    );
  } catch {
    shared.cache.set(key, [], FAIL_TTL);
    return [];
  }
}

/** Items of the market feeds that speak to the given markets (all feeds when null). */
export async function getMarketFeedItems(
  regions: RegionId[] | null,
): Promise<(FeedItem & { regions: RegionId[] })[]> {
  const feeds = MARKET_FEEDS.filter(
    (f) => !regions || f.regions.length === 0 || f.regions.some((r) => regions.includes(r)),
  );
  const lists = await Promise.all(feeds.map((f) => cachedFeed(`m:${f.id}`, f.url, f.name, f.name)));
  return lists.flatMap((items, i) => {
    const tagged = regions ? feeds[i].regions.filter((r) => regions.includes(r)) : feeds[i].regions;
    return items.map((it) => ({ ...it, regions: tagged }));
  });
}

const US_ID = /^[A-Z0-9-]{1,6}$/;

/**
 * Per-stock headlines: Google News search by company name, plus Nasdaq's
 * symbol feed for US tickers (`usTicker`, e.g. "AAPL").
 */
export async function getStockFeedItems(name: string, usTicker: string | null): Promise<FeedItem[]> {
  const q = name
    .replace(/[^\p{L}\p{N} .&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const jobs: Promise<FeedItem[]>[] = [];
  if (q) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} stock`)}&hl=en-AU&gl=AU&ceid=AU:en`;
    jobs.push(cachedFeed(`g:${q.toLowerCase()}`, url, "Google News", "Google News"));
  }
  if (usTicker && US_ID.test(usTicker)) {
    const url = `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(usTicker)}`;
    jobs.push(cachedFeed(`n:${usTicker}`, url, "Nasdaq", "Nasdaq"));
  }
  return (await Promise.all(jobs)).flat();
}

/* ---------- merging ---------- */

export const normTitle = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function normLink(l: string): string {
  try {
    const u = new URL(l);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|cmpid)/i.test(k)) u.searchParams.delete(k);
    }
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return l.toLowerCase();
  }
}

/**
 * Merge headline lists into one, newest first. Earlier items win a duplicate
 * (same normalised title or same link); `onDuplicate` lets the caller fold
 * extra data (e.g. regions) into the kept item.
 */
export function mergeNews<T extends { title: string; link: string; time: number | null }>(
  items: T[],
  max: number,
  onDuplicate?: (kept: T, dup: T) => void,
): T[] {
  const byKey = new Map<string, T>();
  const kept: T[] = [];
  for (const it of items) {
    const kt = "t:" + normTitle(it.title);
    const kl = "l:" + normLink(it.link);
    const seen = byKey.get(kl) ?? byKey.get(kt);
    if (seen) {
      onDuplicate?.(seen, it);
      byKey.set(kl, seen);
      byKey.set(kt, seen);
      continue;
    }
    byKey.set(kl, it);
    byKey.set(kt, it);
    kept.push(it);
  }
  return kept.sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, max);
}
