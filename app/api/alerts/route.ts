import { NextRequest } from "next/server";
import { getWho, json, readJson, sameOrigin } from "@/lib/auth";
import { parseAlertSettings } from "@/lib/alerts";
import { getAlertStore } from "@/lib/alerts-store";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/alerts - the signed-in user's alert settings and how many devices are subscribed. */
export async function GET() {
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  const store = getAlertStore();
  if (!store) return json({ error: "not_configured", message: "Storage isn't available." }, 503);
  const [settings, subs] = await Promise.all([store.getSettings(who.user.id), store.subs(who.user.id)]);
  return json({ settings, devices: subs.length, configured: pushConfigured() });
}

/** PUT /api/alerts { enabled?, movePct?, bigMovePct?, hiLo? } - merges into the user's alert settings. */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  if (who.impersonatedBy) return json({ error: "forbidden", message: "Alerts can't be changed while impersonating." }, 403);
  const store = getAlertStore();
  if (!store) return json({ error: "not_configured", message: "Storage isn't available." }, 503);
  const body = await readJson(req);
  const uid = who.user.id;
  const settings = parseAlertSettings({ ...(await store.getSettings(uid)), ...body });
  await store.setSettings(uid, settings);
  if (settings.enabled) await store.addUser(uid);
  else await store.removeUser(uid);
  return json({ settings });
}
