import { respond } from "@/lib/api";
import { getInsiders } from "@/lib/leaders";

export const dynamic = "force-dynamic";

/** GET /api/leaders/insiders - recent SEC Form 4 transactions by company insiders. */
export async function GET() {
  return respond(getInsiders);
}
