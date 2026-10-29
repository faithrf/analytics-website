import type { NextRequest } from "next/server";
import { ApiError, CODE_RE, respond } from "@/lib/api";
import { getNews } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/news?code=BHP */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const code = (req.nextUrl.searchParams.get("code") ?? "").toUpperCase();
    if (!CODE_RE.test(code)) throw new ApiError(400, "bad_request", "Invalid ASX code.");
    return { news: await getNews(`${code}.AX`) };
  });
}
