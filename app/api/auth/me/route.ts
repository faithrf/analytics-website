import { getWho, json } from "@/lib/auth";
import { signupDisabled } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/** GET /api/auth/me - who the site is showing, and the real admin behind them if impersonating. */
export async function GET() {
  const who = await getWho();
  const signupEnabled = !signupDisabled();
  if (!who) return json({ user: null, signupEnabled });
  return json({
    user: who.user,
    isAdmin: who.session.actorId === "admin",
    impersonatedBy: who.impersonatedBy,
    signupEnabled,
  });
}
