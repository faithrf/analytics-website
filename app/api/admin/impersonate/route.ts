import { NextRequest } from "next/server";
import { getAdminSession, json, readJson, sameOrigin, resolveUser, trackUser, withSessionCookie } from "@/lib/auth";
import { isAccountId } from "@/lib/accounts";
import { PERSONA_IDS } from "@/lib/personas";
import { ADMIN_ID, canImpersonate } from "@/lib/session";
import { identify, track } from "@/lib/track";
import { getUserData } from "@/lib/user-store";

export const dynamic = "force-dynamic";

/** POST /api/admin/impersonate { personaId } - or { personaId: null } to return to admin. The real actor must be admin. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const session = await getAdminSession();
  if (!session) return json({ error: "forbidden", message: "Admin only." }, 403);
  const { personaId } = await readJson(req);
  if (personaId === null) return withSessionCookie(json({ ok: true }), { actorId: ADMIN_ID, subjectId: ADMIN_ID });
  if (!canImpersonate(session, personaId, PERSONA_IDS, isAccountId)) return json({ error: "bad_request", message: "Unknown user." }, 400);
  const id = personaId as string;
  const target = await resolveUser(id);
  if (!target) return json({ error: "bad_request", message: "Unknown user." }, 400);
  await getUserData(id).catch(() => null); // seed on first use
  identify(trackUser(target), { impersonated: true }, { impersonatedBy: ADMIN_ID });
  track(id, "login", { via: "impersonation" }, { impersonatedBy: ADMIN_ID });
  return withSessionCookie(json({ ok: true }), { actorId: ADMIN_ID, subjectId: id });
}
