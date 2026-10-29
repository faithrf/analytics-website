import type { NextRequest } from "next/server";
import { ApiError, SYMBOL_RE, respond } from "@/lib/api";
import { getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

/** GET /api/quotes?symbols=BHP.AX,^AXJO (max 60) */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const raw = req.nextUrl.searchParams.get("symbols") ?? "";
    const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) return { quotes: [], failed: [] };
    if (symbols.length > 60 || symbols.some((s) => !SYMBOL_RE.test(s))) {
      throw new ApiError(400, "bad_request", "Provide up to 60 valid symbols.");
    }
    return getQuotes(symbols);
  });
}
