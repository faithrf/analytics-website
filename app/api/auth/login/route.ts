import { NextRequest } from "next/server";
import { authSecret, json, readJson, sameOrigin, trackUser, userFor, withSessionCookie } from "@/lib/auth";
import { getStore } from "@/lib/sync-store";
import { ADMIN_ID, verifyPassword } from "@/lib/session";
import { verifyLogin } from "@/lib/accounts";
import { identify, track } from "@/lib/track";

export const dynamic = "force-dynamic";
const MAX_TRIES_PER_10_MIN = 10;

/** POST /api/auth/login { email, password } - the admin (from env) or a signed-up account; personas never log in directly. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  if (!authSecret()) {
    return json({ error: "not_configured", message: "Login isn't set up on this server." }, 503);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  try {
    const n = await getStore()?.incr(`rl:login:${ip}`, 600);
    if (n && n > MAX_TRIES_PER_10_MIN) return json({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
  } catch {
    /* rate limiting is best effort */
  }
  const body = await readJson(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (adminEmail && email === adminEmail) {
    if (!adminHash) return json({ error: "not_configured", message: "Login isn't set up on this server." }, 503);
    if (!verifyPassword(password, adminHash)) return json({ error: "invalid", message: "Wrong email or password." }, 401);
    const user = userFor(ADMIN_ID)!;
    identify(trackUser(user), { role: "admin" });
    track(user.id, "login");
    return withSessionCookie(json({ ok: true }), { actorId: ADMIN_ID, subjectId: ADMIN_ID });
  }
  // verifyLogin always runs one hash so a wrong email and a wrong password take the same time.
  const acct = await verifyLogin(email, password);
  if (!acct) return json({ error: "invalid", message: "Wrong email or password." }, 401);
  identify(trackUser({ id: acct.id, name: acct.name || acct.email, email: acct.email, isPersona: false }), { role: "user" });
  track(acct.id, "login");
  return withSessionCookie(json({ ok: true }), { actorId: acct.id, subjectId: acct.id });
}
