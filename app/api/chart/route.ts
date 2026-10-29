import type { NextRequest } from "next/server";
import { ApiError, SYMBOL_RE, respond } from "@/lib/api";
import { isRange } from "@/lib/ranges";
import { getChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/chart?symbol=BHP.AX&range=1M */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
    const range = req.nextUrl.searchParams.get("range") ?? "1M";
    if (!SYMBOL_RE.test(symbol)) throw new ApiError(400, "bad_request", "Invalid symbol.");
    if (!isRange(range)) throw new ApiError(400, "bad_request", "Invalid range.");
    const chart = await getChart(symbol, range);
    if (chart.points.length === 0) throw new ApiError(404, "no_data", "No chart data for this range.");
    return chart;
  });
}
