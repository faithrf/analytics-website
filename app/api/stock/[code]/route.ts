import type { NextRequest } from "next/server";
import { CONSTITUENT_BY_ID } from "@/data/markets";
import { ApiError, respond } from "@/lib/api";
import { displayCode, isValidId, marketOf, toYahoo } from "@/lib/symbols";
import { getProfile, getQuote } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/stock/BHP or /api/stock/AAPL.US - quote, key stats and sector. 404 for unknown tickers. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const id = decodeURIComponent((await ctx.params).code).toUpperCase();
    if (!isValidId(id)) throw new ApiError(400, "bad_request", "Invalid stock code.");
    const symbol = toYahoo(id);
    const quote = await getQuote(symbol);
    if (!quote || quote.price === null) {
      throw new ApiError(404, "not_found", `No ${marketOf(id)} stock found for "${displayCode(id)}".`);
    }
    const known = CONSTITUENT_BY_ID.get(id);
    const profile = await getProfile(symbol);
    return { quote, sector: known?.sector ?? profile.sector, industry: profile.industry };
  });
}
