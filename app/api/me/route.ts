import { NextRequest } from "next/server";
import { getWho, json, readJson, sameOrigin, withoutSessionCookie } from "@/lib/auth";
import { deleteAccount, verifyLogin } from "@/lib/accounts";
import { deleteUserData } from "@/lib/user-store";
import { ADMIN_ID } from "@/lib/session";
import { getStore } from "@/lib/sync-store";
import { track } from "@/lib/track";

export const dynamic = "force-dynamic";
const MAX_TRIES_PER_10_MIN = 10;

/** DELETE /api/me { password } - permanently deletes the signed-in user's own account and saved data. */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  if (who.user.id === ADMIN_ID || who.session.actorId === ADMIN_ID || who.impersonatedBy || who.user.isPersona) {
    return json({ error: "forbidden", message: "This account can't be deleted." }, 403);
  }
  try {
    const n = await getStore()?.incr(`rl:delete:${who.user.id}`, 600);
    if (n && n > MAX_TRIES_PER_10_MIN) return json({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
  } catch {
    /* rate limiting is best effort */
  }
  const body = await readJson(req);
  const password = typeof body.password === "string" ? body.password : "";
  const acct = await verifyLogin(who.user.email, password);
  if (!acct || acct.id !== who.user.id) return json({ error: "invalid", message: "Wrong password." }, 401);
  track(acct.id, "account_deleted");
  await deleteUserData(acct.id);
  await deleteAccount(acct.id);
  return withoutSessionCookie(json({ ok: true }));
}
