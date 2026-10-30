import type { NextRequest } from "next/server";
import { ApiError, respond } from "@/lib/api";
import { isRegion, region } from "@/lib/markets";
import { getChart, getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/overview?region=us - index and FX quotes with an intraday sparkline each (default region au). */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const id = req.nextUrl.searchParams.get("region") ?? "au";
    if (!isRegion(id)) throw new ApiError(400, "bad_request", "Unknown region.");
    const tilesDef = region(id).tiles;
    const symbols = tilesDef.map((o) => o.symbol);
    const [{ quotes }, charts] = await Promise.all([
      getQuotes(symbols),
      Promise.allSettled(symbols.map((s) => getChart(s, "1D"))),
    ]);
    const tiles = tilesDef.map((o, i) => {
      const chart = charts[i];
      return {
        label: o.label,
        symbol: o.symbol,
        quote: quotes.find((q) => q.symbol === o.symbol) ?? null,
        spark: chart.status === "fulfilled" ? chart.value.points.map((p) => ({ t: p.t, v: p.close })) : [],
        prevClose: chart.status === "fulfilled" ? chart.value.prevClose : null,
      };
    });
    if (tiles.every((t) => !t.quote)) {
      throw new Error("No index quotes returned");
    }
    return { tiles };
  });
}
