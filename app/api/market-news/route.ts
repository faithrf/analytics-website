import type { NextRequest } from "next/server";
import { ApiError, respond } from "@/lib/api";
import { isRegion, NEWS_TERMS, REGIONS, type RegionId } from "@/lib/markets";
import { getQuotes, getTermNews, type MarketNewsItem } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const MAX_STORIES = 40;
const MAX_QUOTED = 60;

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
    const results = await Promise.allSettled(jobs.map((j) => getTermNews(j.term)));
    if (results.every((x) => x.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;

    const byLink = new Map<string, MarketNewsItem & { regions: RegionId[] }>();
    results.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      for (const n of res.value) {
        const seen = byLink.get(n.link);
        if (seen) {
          if (!seen.regions.includes(jobs[i].r)) seen.regions.push(jobs[i].r);
        } else byLink.set(n.link, { ...n, regions: [jobs[i].r] });
      }
    });
    const news = [...byLink.values()].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, MAX_STORIES);

    const counts = new Map<string, number>();
    for (const n of news) for (const t of n.tickers) counts.set(t, (counts.get(t) ?? 0) + 1);
    const mentions = [...counts.entries()]
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
    const { quotes } = await getQuotes(mentions.slice(0, MAX_QUOTED).map((m) => m.symbol)).catch(() => ({ quotes: [] }));
    return { news, mentions: mentions.slice(0, 25), quotes };
  });
}
