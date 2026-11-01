import { NextRequest } from "next/server";
import { getWho, json, readJson, sameOrigin } from "@/lib/auth";
import { CLIENT_EVENTS, track, type TrackEvent } from "@/lib/track";

export const dynamic = "force-dynamic";

/** POST /api/track { event, props? } - browser events, attributed to the session user. Silently ignored when logged out. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (!who) return json({ ok: true });
  const { event, props } = await readJson(req);
  if (typeof event !== "string" || !CLIENT_EVENTS.includes(event as TrackEvent)) {
    return json({ error: "bad_request", message: "Unknown event." }, 400);
  }
  const clean: Record<string, unknown> = {};
  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props).slice(0, 8)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") clean[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 120) : v;
    }
  }
  track(who.user.id, event as TrackEvent, clean, who.impersonatedBy ? { impersonatedBy: who.impersonatedBy } : {});
  return json({ ok: true });
}
