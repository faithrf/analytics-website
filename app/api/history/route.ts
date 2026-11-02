import type { NextRequest } from "next/server";
import { ApiError, SYMBOL_RE, respond } from "@/lib/api";
import { getDaily } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const TEN_YEARS_MS = 10 * 365.25 * 86_400_000;

/** GET /api/history?symbol=BHP.AX&from=<ms> - daily high/low/close bars from `from` to now (test trades). */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
    const fromRaw = req.nextUrl.searchParams.get("from") ?? "";
    const from = fromRaw.trim() === "" ? NaN : Number(fromRaw);
    const now = Date.now();
    if (!SYMBOL_RE.test(symbol)) throw new ApiError(400, "bad_request", "Invalid symbol.");
    if (!Number.isFinite(from) || from > now || from < now - TEN_YEARS_MS) {
      throw new ApiError(400, "bad_request", "Start date must be within the last 10 years and not in the future.");
    }
    const bars = await getDaily(symbol, from);
    if (bars.length === 0) throw new ApiError(404, "no_data", "No price history for that period.");
    return { symbol, from, bars };
  });
}
