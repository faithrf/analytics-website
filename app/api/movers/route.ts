import type { NextRequest } from "next/server";
import { ASX200_AS_OF } from "@/data/asx200";
import { CONSTITUENTS } from "@/data/markets";
import { rankMovers, sectorAverages, type MoverRow } from "@/lib/aggregate";
import { ApiError, respond } from "@/lib/api";
import { isRegion } from "@/lib/markets";
import { toYahoo } from "@/lib/symbols";
import { getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/movers?region=us - top gainers / losers / most active plus sector averages (default region au). */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const id = req.nextUrl.searchParams.get("region") ?? "au";
    if (!isRegion(id)) throw new ApiError(400, "bad_request", "Unknown region.");
    const list = CONSTITUENTS[id];
    const names = new Map(list.map((c) => [c.code, c.name]));
    const { quotes, failed } = await getQuotes(list.map((c) => toYahoo(c.code)));
    const rows: MoverRow[] = quotes.map((q) => ({
      code: q.code,
      name: names.get(q.code) ?? q.name,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      volume: q.volume,
    }));
    return {
      gainers: rankMovers(rows, "gainers", 15),
      losers: rankMovers(rows, "losers", 15),
      active: rankMovers(rows, "active", 15),
      sectors: sectorAverages(rows, list),
      covered: rows.length,
      total: list.length,
      missing: failed.length,
      asOf: ASX200_AS_OF,
      /** newest last-trade time across the quotes (ms), for the freshness label */
      quoteTime: quotes.reduce<number | null>((m, q) => (q.time && (!m || q.time > m) ? q.time : m), null),
    };
  });
}
