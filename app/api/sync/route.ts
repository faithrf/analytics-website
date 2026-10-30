import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import { guard, newCode, readBoards, syncRespond } from "@/lib/sync-api";
import { getStore } from "@/lib/sync-store";

export const dynamic = "force-dynamic";

/** GET /api/sync - whether sync is available here (503 not_configured when it is not). */
export async function GET() {
  return syncRespond(async () => {
    if (!getStore()) throw new ApiError(503, "not_configured", "Sync isn't set up on this server.");
    return { enabled: true };
  });
}

/** POST /api/sync { boards, active } - creates a new sync code holding those dashboards. */
export async function POST(req: NextRequest) {
  return syncRespond(async () => {
    const store = await guard(req, true);
    const boards = await readBoards(req);
    const updatedAt = Date.now();
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await store.setRecord(code, { ...boards, updatedAt }, "create")) return { code, updatedAt };
    }
    throw new ApiError(502, "upstream", "Could not create a sync code. Try again.");
  });
}
