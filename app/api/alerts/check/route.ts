import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { decideAlerts, sentKey, tradingDay, type AlertContext, type AlertQuote } from "@/lib/alerts";
import { getAlertStore } from "@/lib/alerts-store";
import { pushConfigured, pushToUser } from "@/lib/push";
import { fromYahoo, idPath, isValidId, toYahoo } from "@/lib/symbols";
import { getUserData } from "@/lib/user-store";
import { getNews, getQuotes } from "@/lib/yahoo";

/** A headline newer than this is shown in the alert as a likely reason for the move. */
const HEADLINE_MAX_AGE_MS = 24 * 3600_000;

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
  const people: { uid: string; settings: Awaited<ReturnType<typeof store.getSettings>>; subs: Awaited<ReturnType<typeof store.subs>>; symbols: string[]; ctx: Map<string, AlertContext> }[] = [];
  for (const uid of await store.users()) {
    const [settings, subs] = await Promise.all([store.getSettings(uid), store.subs(uid)]);
    if (!settings.enabled) {
      await store.removeUser(uid);
      continue;
    }
    if (subs.length === 0) continue;
    const data = await getUserData(uid);
    const ids = new Set<string>(data.boards.flatMap((b) => b.ids));
    const traded = new Set<string>();
    for (const t of data.trades) {
      const ended = t.closedMs !== undefined || (t.expiryMs ?? t.endMs ?? Infinity) <= now;
      if (!ended) {
        ids.add(t.symbol);
        traded.add(t.symbol);
      }
    }
    const valid = [...ids].filter(isValidId);
    const ctx = new Map<string, AlertContext>(
      valid.map((id) => [toYahoo(id), { inTrade: traded.has(id), boards: data.boards.filter((b) => b.ids.includes(id)).map((b) => b.name) }]),
    );
    const symbols = valid.map(toYahoo);
    if (symbols.length > 0) people.push({ uid, settings, subs, symbols, ctx });
  }
  if (people.length === 0) return NextResponse.json({ users: 0, sent: 0 }, { headers: noStore });

  const { quotes } = await getQuotes([...new Set(people.flatMap((p) => p.symbols))]);
  const bySymbol = new Map<string, AlertQuote>(quotes.map((q) => [q.symbol, q]));

  // Latest fresh headline per symbol, fetched only for symbols that are about to alert.
  const headlines = new Map<string, Promise<AlertContext["headline"]>>();
  const headline = (symbol: string) => {
    if (!headlines.has(symbol)) {
      headlines.set(
        symbol,
        getNews(symbol)
          .then((items) => {
            const n = items.find((i) => i.time !== null && now - i.time <= HEADLINE_MAX_AGE_MS);
            return n ? { title: n.title, publisher: n.publisher } : null;
          })
          .catch(() => null),
      );
    }
    return headlines.get(symbol)!;
  };

  let sent = 0;
  for (const p of people) {
    for (const symbol of p.symbols) {
      const q = bySymbol.get(symbol);
      if (!q || q.time === null) continue;
      const day = tradingDay(symbol, q.time);
      if (decideAlerts(q, p.settings, now).length === 0) continue;
      const alerts = decideAlerts(q, p.settings, now, new Set(), { ...p.ctx.get(symbol), headline: await headline(symbol) });
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
