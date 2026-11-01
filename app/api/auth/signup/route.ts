import { NextRequest } from "next/server";
import { authSecret, json, readJson, sameOrigin, trackUser, withSessionCookie } from "@/lib/auth";
import { cleanName, createAccount, MAX_PASSWORD, MIN_PASSWORD, normaliseEmail, signupDisabled, validEmail } from "@/lib/accounts";
import { getStore } from "@/lib/sync-store";
import { identify, track } from "@/lib/track";

export const dynamic = "force-dynamic";
const MAX_SIGNUPS_PER_HOUR = 5;

/** POST /api/auth/signup { name?, email, password } - creates a regular account and signs it in. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  if (signupDisabled()) return json({ error: "disabled", message: "Sign-up is turned off." }, 403);
  if (!authSecret()) return json({ error: "not_configured", message: "Sign-up isn't set up on this server." }, 503);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  try {
    const n = await getStore()?.incr(`rl:signup:${ip}`, 3600);
    if (n && n > MAX_SIGNUPS_PER_HOUR) return json({ error: "rate_limited", message: "Too many attempts. Try again later." }, 429);
  } catch {
    /* rate limiting is best effort */
  }
  const body = await readJson(req);
  const email = normaliseEmail(body.email);
  const name = cleanName(body.name);
  const password = typeof body.password === "string" ? body.password : "";
  if (!validEmail(email)) return json({ error: "invalid", message: "Enter a valid email address." }, 400);
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return json({ error: "invalid", message: `Password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters.` }, 400);
  }
  // the admin email logs in through ADMIN_PASSWORD_HASH; a regular account under it would be unreachable
  if (email === process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
    return json({ error: "conflict", message: "Couldn't create that account. Try logging in instead." }, 409);
  }
  const r = await createAccount({ email, name, password }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (!r.ok) {
    if (r.reason === "duplicate") return json({ error: "conflict", message: "Couldn't create that account. Try logging in instead." }, 409);
    return json({ error: "not_configured", message: "Storage isn't available." }, 503);
  }
  const { account } = r;
  identify(trackUser({ id: account.id, name: account.name || account.email, email: account.email, isPersona: false }), { role: "user" });
  track(account.id, "signed_up");
  return withSessionCookie(json({ ok: true }), { actorId: account.id, subjectId: account.id });
}
