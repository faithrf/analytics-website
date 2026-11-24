import { NextRequest } from "next/server";
import { getWho, json, sameOrigin } from "@/lib/auth";
import { getAlertStore } from "@/lib/alerts-store";
import { pushConfigured, pushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/** POST /api/alerts/test - sends a test notification to all of the user's devices. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  if (!pushConfigured()) return json({ error: "not_configured", message: "Push isn't set up on the server." }, 503);
  const store = getAlertStore();
  if (!store) return json({ error: "not_configured", message: "Storage isn't available." }, 503);
  const subs = await store.subs(who.user.id);
  if (subs.length === 0) return json({ error: "no_devices", message: "No device is subscribed yet." }, 409);
  const delivered = await pushToUser(who.user.id, subs, { title: "Meridian test", body: "Alerts are working on this device.", tag: "meridian-test", url: "/" });
  return json({ delivered });
}
