import { NextRequest } from "next/server";
import { getWho, json, readJson, sameOrigin } from "@/lib/auth";
import { cleanFollows, getUserData, parseUserData, setUserData } from "@/lib/user-store";
import { track } from "@/lib/track";

export const dynamic = "force-dynamic";

/** GET /api/me/data - the signed-in user's boards and followed leaders (401 when logged out). */
export async function GET() {
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  return json(await getUserData(who.user.id));
}

/** PUT /api/me/data { boards?, active?, follows? } - merges into the user's saved data and reports the changes. */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
  const who = await getWho();
  if (!who) return json({ error: "unauthorized", message: "Log in first." }, 401);
  const body = await readJson(req);
  const prev = await getUserData(who.user.id);
  const hasBoards = Array.isArray(body.boards);
  const next = hasBoards ? parseUserData({ boards: body.boards, active: body.active, follows: prev.follows }) : { ...prev };
  if (Array.isArray(body.follows)) next.follows = cleanFollows(body.follows);
  if (!(await setUserData(who.user.id, next))) return json({ error: "not_configured", message: "Storage isn't available." }, 503);

  const opts = who.impersonatedBy ? { impersonatedBy: who.impersonatedBy } : {};
  const uid = who.user.id;
  if (hasBoards) {
    track(uid, "board_saved", { boards: next.boards.length }, opts);
    const before = new Map(prev.boards.map((b) => [b.id, b.ids]));
    for (const b of next.boards) {
      const old = before.get(b.id) ?? [];
      for (const s of b.ids.filter((x) => !old.includes(x))) track(uid, "watchlist_add", { boardId: b.id, stockId: s }, opts);
      for (const s of old.filter((x) => !b.ids.includes(x))) track(uid, "watchlist_remove", { boardId: b.id, stockId: s }, opts);
    }
  }
  const lower = (a: string[]) => a.map((x) => x.toLowerCase());
  for (const f of next.follows.filter((x) => !lower(prev.follows).includes(x.toLowerCase()))) track(uid, "leader_follow", { leader: f }, opts);
  for (const f of prev.follows.filter((x) => !lower(next.follows).includes(x.toLowerCase()))) track(uid, "leader_unfollow", { leader: f }, opts);
  return json({ ok: true });
}
