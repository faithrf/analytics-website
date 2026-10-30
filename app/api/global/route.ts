import { respond } from "@/lib/api";
import { GLOBAL_GAUGES, REGIONS } from "@/lib/markets";
import { getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const TILES = [
  ...REGIONS.map((r) => ({ ...r.tiles[0], region: r.label })),
  ...GLOBAL_GAUGES.map((g) => ({ ...g, region: null })),
];

/** GET /api/global - each market's main index plus gold, oil, US 10-year, VIX and bitcoin. */
export async function GET() {
  return respond(async () => {
    const { quotes } = await getQuotes(TILES.map((t) => t.symbol));
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    const tiles = TILES.map((t) => ({ ...t, quote: bySymbol.get(t.symbol) ?? null }));
    if (tiles.every((t) => !t.quote)) throw new Error("No global quotes returned");
    return { tiles };
  });
}
