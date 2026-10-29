import { respond } from "@/lib/api";
import { getChart, getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const OVERVIEW = [
  { symbol: "^AXJO", label: "ASX 200" },
  { symbol: "^AORD", label: "All Ordinaries" },
  { symbol: "AUDUSD=X", label: "AUD/USD" },
] as const;

/** GET /api/overview - index and FX quotes with an intraday sparkline each. */
export async function GET() {
  return respond(async () => {
    const symbols = OVERVIEW.map((o) => o.symbol);
    const [{ quotes }, charts] = await Promise.all([
      getQuotes(symbols),
      Promise.allSettled(symbols.map((s) => getChart(s, "1D"))),
    ]);
    const tiles = OVERVIEW.map((o, i) => {
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
