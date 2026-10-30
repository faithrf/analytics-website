import type { NextRequest } from "next/server";
import { ApiError, SYMBOL_RE, respond } from "@/lib/api";
import { getChart } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

const MAX = 40;
const CONCURRENCY = 8;

/** GET /api/sparks?symbols=BHP.AX,AAPL (max 40) - intraday close points per symbol; failures are left out. */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const raw = req.nextUrl.searchParams.get("symbols") ?? "";
    const symbols = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length > MAX || symbols.some((s) => !SYMBOL_RE.test(s))) {
      throw new ApiError(400, "bad_request", `Provide up to ${MAX} valid symbols.`);
    }
    const sparks: Record<string, { points: { t: number; v: number }[]; prevClose: number | null }> = {};
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const group = symbols.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(group.map((s) => getChart(s, "1D")));
      results.forEach((r, j) => {
        if (r.status === "fulfilled") {
          sparks[group[j]] = { points: r.value.points.map((p) => ({ t: p.t, v: p.close })), prevClose: r.value.prevClose };
        }
      });
    }
    return { sparks };
  });
}
