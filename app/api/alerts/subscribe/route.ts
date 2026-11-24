import { NextRequest } from "next/server";
import { getWho, json, readJson, sameOrigin } from "@/lib/auth";
import { getAlertStore, parsePushSub } from "@/lib/alerts-store";

export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  if (!sameOrigin(req)) return { err: json({ error: "forbidden", message: "Cross-site request blocked." }, 403) } as const;
  const who = await getWho();
  if (!who) return { err: json({ error: "unauthorized", message: "Log in first." }, 401) } as const;
  if (who.impersonatedBy) return { err: json({ error: "forbidden", message: "Not while impersonating." }, 403) } as const;
  const store = getAlertStore();
  if (!store) return { err: json({ error: "not_configured", message: "Storage isn't available." }, 503) } as const;
  return { who, store } as const;
}

/** POST /api/alerts/subscribe { subscription } - registers this device for the user's alerts. */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  const sub = parsePushSub((await readJson(req)).subscription);
  if (!sub) return json({ error: "bad_request", message: "Invalid subscription." }, 400);
  if (!(await g.store.addSub(g.who.user.id, sub))) return json({ error: "limit", message: "Too many devices; turn alerts off on another one first." }, 409);
  return json({ ok: true, devices: (await g.store.subs(g.who.user.id)).length });
}

/** DELETE /api/alerts/subscribe { endpoint } - removes this device. */
export async function DELETE(req: NextRequest) {
  const g = await guard(req);
  if ("err" in g) return g.err;
  const endpoint = (await readJson(req)).endpoint;
  if (typeof endpoint !== "string") return json({ error: "bad_request", message: "Missing endpoint." }, 400);
  await g.store.removeSub(g.who.user.id, endpoint);
  return json({ ok: true });
}
