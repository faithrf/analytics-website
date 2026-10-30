import type { NextRequest } from "next/server";
import { ApiError, respond } from "@/lib/api";
import { isRegion, NEWS_TERMS, REGIONS, type RegionId } from "@/lib/markets";
import { getMarketFeedItems, mergeNews } from "@/lib/feeds";
import { getQuotes, getTermNews, type MarketNewsItem } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const MAX_STORIES = 40;
const MAX_QUOTED = 60;
const MAX_PER_FEED = 7;

/**
 * GET /api/market-news?region=all|au|us|uk|eu|jp|hk - recent market headlines,
 * the tickers each one is tagged with, today's quotes for those tickers, and
 * how often each ticker is mentioned.
 */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const pick = req.nextUrl.searchParams.get("region") ?? "all";
    if (pick !== "all" && !isRegion(pick)) throw new ApiError(400, "bad_request", "Unknown region.");
    const regions: RegionId[] = pick === "all" ? REGIONS.map((r) => r.id) : [pick];
    const jobs = regions.flatMap((r) => NEWS_TERMS[r].map((term) => ({ r, term })));
    // Yahoo and the extra feeds run in parallel; each feed has its own timeout.
    const [results, feedItems] = await Promise.all([
      Promise.allSettled(jobs.map((j) => getTermNews(j.term))),
      getMarketFeedItems(pick === "all" ? null : regions).catch(() => []),
    ]);
    if (results.every((x) => x.status === "rejected") && feedItems.length === 0) {
      throw (results[0] as PromiseRejectedResult).reason;
    }

    type Story = MarketNewsItem & { regions: RegionId[] };
    const all: Story[] = [];
    results.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      for (const n of res.value) all.push({ ...n, regions: [jobs[i].r] });
    });
    // Cap each feed so one busy feed cannot crowd the others out of the list.
    const perFeed = new Map<string, number>();
    for (const f of [...feedItems].sort((a, b) => (b.time ?? 0) - (a.time ?? 0))) {
      const k = f.source ?? "";
      if ((perFeed.get(k) ?? 0) >= MAX_PER_FEED) continue;
      perFeed.set(k, (perFeed.get(k) ?? 0) + 1);
      all.push({ ...f, tickers: [] });
    }
    const news = mergeNews(all, MAX_STORIES, (kept, dup) => {
      for (const r of dup.regions) if (!kept.regions.includes(r)) kept.regions.push(r);
    });
    const tally = new Map<string, number>();
    for (const n of news) tally.set(n.source ?? "Yahoo Finance", (tally.get(n.source ?? "Yahoo Finance") ?? 0) + 1);
    const sources = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

    const counts = new Map<string, number>();
    for (const n of news) for (const t of n.tickers) counts.set(t, (counts.get(t) ?? 0) + 1);
    const mentions = [...counts.entries()]
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
    const { quotes } = await getQuotes(mentions.slice(0, MAX_QUOTED).map((m) => m.symbol)).catch(() => ({ quotes: [] }));
    return { news, sources, mentions: mentions.slice(0, 25), quotes };
  });
}
