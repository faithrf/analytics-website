import type { NextRequest } from "next/server";
import { ApiError, respond } from "@/lib/api";
import { isValidId, toYahoo } from "@/lib/symbols";
import { getNews } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/news?code=BHP (or AAPL.US, VOD.L) */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const code = (req.nextUrl.searchParams.get("code") ?? "").toUpperCase();
    if (!isValidId(code)) throw new ApiError(400, "bad_request", "Invalid stock code.");
    return { news: await getNews(toYahoo(code)) };
  });
}
