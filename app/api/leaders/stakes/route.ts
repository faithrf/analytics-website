import { respond } from "@/lib/api";
import { getStakes } from "@/lib/leaders";

export const dynamic = "force-dynamic";

/** GET /api/leaders/stakes - recent Schedule 13D/13G filings (stakes of 5% or more). */
export async function GET() {
  return respond(getStakes);
}
