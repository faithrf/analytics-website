import { NextRequest } from "next/server";
import { getAdminSession, json, readJson, sameOrigin } from "@/lib/auth";
import { getAccount, isAccountId } from "@/lib/accounts";
import { PERSONA_IDS } from "@/lib/personas";
import { canImpersonate } from "@/lib/session";
import { resetPersona, resetUserData } from "@/lib/user-store";

export const dynamic = "force-dynamic";

/** POST /api/admin/reset { personaId } - restores a persona's seeded boards and follows. Admin only. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const session = await getAdminSession();
  if (!session) return json({ error: "forbidden", message: "Admin only." }, 403);
  const { personaId } = await readJson(req);
  if (!canImpersonate(session, personaId, PERSONA_IDS, isAccountId)) return json({ error: "bad_request", message: "Unknown user." }, 400);
  const id = personaId as string;
  if (isAccountId(id) && !(await getAccount(id).catch(() => null))) return json({ error: "bad_request", message: "Unknown user." }, 400);
  const ok = await (isAccountId(id) ? resetUserData(id) : resetPersona(id)).catch(() => false);
  return ok ? json({ ok: true }) : json({ error: "not_configured", message: "Storage isn't available." }, 503);
}
