import type { NextRequest } from "next/server";
import { ApiError, respond } from "@/lib/api";
import { searchAsx } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/search?q=bhp - ASX equities and ETFs only. */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length === 0) return { results: [] };
    if (q.length > 40) throw new ApiError(400, "bad_request", "Query too long.");
    return { results: await searchAsx(q) };
  });
}
