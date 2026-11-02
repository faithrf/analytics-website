import type { NextRequest } from "next/server";
import { ApiError, SYMBOL_RE, respond } from "@/lib/api";
import { parseOptionsParams } from "@/lib/options";
import { getContractQuotes, getOptionChain } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/**
 * GET /api/options?symbol=AAPL&date=<expiry ms, optional>
 *   -> { symbol, spot, expiries, expiry, strikes: [{ strike, call, put }] } (~30 strikes around spot; empty expiries = no options)
 * GET /api/options?contracts=AAPL261120C00250000,...&from=<ms, optional>
 *   -> { quotes: [{ contractSymbol, bid, ask, last, mark, bars }] } (up to 50, for marking open real-priced trades)
 */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const p = parseOptionsParams(req.nextUrl.searchParams, SYMBOL_RE, Date.now());
    if ("error" in p) throw new ApiError(400, "bad_request", p.error);
    if (p.kind === "contracts") return { quotes: await getContractQuotes(p.contracts, p.from) };
    return getOptionChain(p.symbol, p.date);
  });
}
