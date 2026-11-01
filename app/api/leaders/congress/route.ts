import { respond } from "@/lib/api";
import { getCongress } from "@/lib/leaders";

export const dynamic = "force-dynamic";

/** GET /api/leaders/congress - congressional trades (Bargo) plus new House periodic transaction reports. */
export async function GET() {
  return respond(getCongress);
}
