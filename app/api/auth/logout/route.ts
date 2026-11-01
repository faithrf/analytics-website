import { NextRequest } from "next/server";
import { getWho, json, sameOrigin, withoutSessionCookie } from "@/lib/auth";
import { track } from "@/lib/track";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout - ends the session (the real login, even while impersonating). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (who) track(who.session.actorId, "logout");
  return withoutSessionCookie(json({ ok: true }));
}
