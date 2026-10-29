import { ASX200, ASX200_AS_OF, toYahooSymbol } from "@/data/asx200";
import { rankMovers, sectorAverages, type MoverRow } from "@/lib/aggregate";
import { respond } from "@/lib/api";
import { getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/movers - top gainers / losers / most active plus sector averages. */
export async function GET() {
  return respond(async () => {
    const { quotes, failed } = await getQuotes(ASX200.map((c) => toYahooSymbol(c.code)));
    const rows: MoverRow[] = quotes.map((q) => ({
      code: q.code,
      name: ASX200.find((c) => c.code === q.code)?.name ?? q.name,
      price: q.price,
      change: q.change,
      changePct: q.changePct,
      volume: q.volume,
    }));
    return {
      gainers: rankMovers(rows, "gainers", 15),
      losers: rankMovers(rows, "losers", 15),
      active: rankMovers(rows, "active", 15),
      sectors: sectorAverages(rows, ASX200),
      covered: rows.length,
      total: ASX200.length,
      missing: failed.length,
      asOf: ASX200_AS_OF,
    };
  });
}
