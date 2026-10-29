import type { NextRequest } from "next/server";
import { ASX200_BY_CODE } from "@/data/asx200";
import { ApiError, CODE_RE, respond } from "@/lib/api";
import { getProfile, getQuote } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/stock/BHP - quote, key stats and sector. 404 for unknown tickers. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const code = (await ctx.params).code.toUpperCase();
    if (!CODE_RE.test(code)) throw new ApiError(400, "bad_request", "Invalid ASX code.");
    const symbol = `${code}.AX`;
    const quote = await getQuote(symbol);
    if (!quote || quote.price === null) {
      throw new ApiError(404, "not_found", `No ASX stock found for "${code}".`);
    }
    const known = ASX200_BY_CODE.get(code);
    const profile = await getProfile(symbol);
    return { quote, sector: known?.sector ?? profile.sector, industry: profile.industry };
  });
}
