import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { decideAlerts, sentKey, tradingDay, type AlertQuote } from "@/lib/alerts";
import { getAlertStore } from "@/lib/alerts-store";
import { pushConfigured, pushToUser } from "@/lib/push";
import { fromYahoo, idPath, isValidId, toYahoo } from "@/lib/symbols";
import { getUserData } from "@/lib/user-store";
import { getQuotes } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const noStore = { "Cache-Control": "no-store" };

/** GET /api/alerts/check - called every 15 minutes by .github/workflows/alerts.yml with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  const store = getAlertStore();
  if (!store || !pushConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: noStore });

  // Users with alerts on and a device, and the Yahoo symbols each one watches (board pins and open trades).
  const now = Date.now();
  const people: { uid: string; settings: Awaited<ReturnType<typeof store.getSettings>>; subs: Awaited<ReturnType<typeof store.subs>>; symbols: string[] }[] = [];
  for (const uid of await store.users()) {
    const [settings, subs] = await Promise.all([store.getSettings(uid), store.subs(uid)]);
    if (!settings.enabled) {
      await store.removeUser(uid);
      continue;
    }
    if (subs.length === 0) continue;
    const data = await getUserData(uid);
    const ids = new Set<string>(data.boards.flatMap((b) => b.ids));
    for (const t of data.trades) {
      const ended = t.closedMs !== undefined || (t.expiryMs ?? t.endMs ?? Infinity) <= now;
      if (!ended) ids.add(t.symbol);
    }
    const symbols = [...ids].filter(isValidId).map(toYahoo);
    if (symbols.length > 0) people.push({ uid, settings, subs, symbols });
  }
  if (people.length === 0) return NextResponse.json({ users: 0, sent: 0 }, { headers: noStore });

  const { quotes } = await getQuotes([...new Set(people.flatMap((p) => p.symbols))]);
  const bySymbol = new Map<string, AlertQuote>(quotes.map((q) => [q.symbol, q]));

  let sent = 0;
  for (const p of people) {
    for (const symbol of p.symbols) {
      const q = bySymbol.get(symbol);
      if (!q || q.time === null) continue;
      const day = tradingDay(symbol, q.time);
      const alerts = decideAlerts(q, p.settings, now);
      for (const a of alerts) {
        // claim every key first so a repeat run (or a second level on the same day) can't send it again
        const claims = await Promise.all(a.keys.map((k) => store.claim(sentKey(p.uid, symbol, k, day))));
        if (!claims[0]) continue;
        const n = await pushToUser(p.uid, p.subs, {
          title: a.title,
          body: a.body,
          tag: `alert-${symbol}`,
          url: `/stock/${idPath(fromYahoo(symbol))}`,
        });
        sent += n > 0 ? 1 : 0;
      }
    }
  }
  return NextResponse.json({ users: people.length, symbols: bySymbol.size, sent }, { headers: noStore });
}
