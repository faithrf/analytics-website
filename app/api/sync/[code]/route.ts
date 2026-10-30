import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import { guard, parseCode, readBoards, syncRespond } from "@/lib/sync-api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ code: string }> };

const notFound = () => new ApiError(404, "not_found", "Sync code not found.");

/** GET /api/sync/[code] - the synced dashboards, or 404. */
export async function GET(req: NextRequest, ctx: Ctx) {
  return syncRespond(async () => {
    const code = parseCode((await ctx.params).code);
    const store = await guard(req);
    const rec = await store.getRecord(code);
    if (!rec) throw notFound();
    return { boards: rec.boards, active: rec.active, updatedAt: rec.updatedAt };
  });
}

/** PUT /api/sync/[code] { boards, active } - saves only if the code exists; the server sets updatedAt. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return syncRespond(async () => {
    const code = parseCode((await ctx.params).code);
    const store = await guard(req);
    const boards = await readBoards(req);
    const updatedAt = Date.now();
    if (!(await store.setRecord(code, { ...boards, updatedAt }, "update"))) throw notFound();
    return { updatedAt };
  });
}

/** DELETE /api/sync/[code] - removes the code and its data. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return syncRespond(async () => {
    const code = parseCode((await ctx.params).code);
    const store = await guard(req);
    await store.deleteRecord(code);
    return { ok: true };
  });
}
