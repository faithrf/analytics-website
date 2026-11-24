import { respond } from "@/lib/api";
import { getMergers } from "@/lib/leaders";

export const dynamic = "force-dynamic";

/** GET /api/leaders/mergers - recent M&A filings (tender offers, merger proxies, deal registrations), one row per company. */
export async function GET() {
  return respond(getMergers);
}
