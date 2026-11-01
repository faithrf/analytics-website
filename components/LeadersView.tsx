"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  applyRange,
  delayDays,
  delayLabel,
  delayTone,
  FRESH_DAYS,
  HOUSE_LATEST_DAYS,
  isFresh,
  weekIncomplete,
  WEEK_DAYS,
  type CongressData,
  type DelayTone,
  type InsidersData,
  type LeaderRow,
  type Range,
  type StakesData,
} from "@/lib/leaders-shared";
import { isValidId } from "@/lib/symbols";
import { useApi } from "@/lib/use-api";
import { agoShort, ErrorBox, Panel, Skeleton, Tabs, useNow, whenShort } from "@/components/ui";
import { trackClient, useAccount } from "@/lib/use-account";
import { sameLeader, useFollows } from "@/lib/use-follows";

const SUBS = [
  { id: "insiders", label: "Insiders" },
  { id: "congress", label: "Congress" },
  { id: "stakes", label: "Big stakes" },
] as const;
type Sub = (typeof SUBS)[number]["id"];

const TONE: Record<DelayTone, string> = {
  good: "bg-gain/15 text-gain",
  warn: "bg-warn/15 text-warn",
  bad: "bg-loss/15 text-loss",
};

export function DelayPill({ days }: { days: number | null }) {
  const tone = delayTone(days);
  return (
    <span
      className={`inline-block min-w-16 rounded-full px-2 py-0.5 text-center text-xs font-semibold whitespace-nowrap ${tone ? TONE[tone] : "bg-panel2 text-muted"}`}
      title={days === null ? "The filing does not say when the trade happened." : `Filed ${delayLabel(days)} after the trade`}
    >
      {delayLabel(days)}
    </span>
  );
}

const fmtDay = (d: string | null) => {
  if (!d) return "—";
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
};

const RANGES = [
  { id: "latest", label: "Latest" },
  { id: "week", label: "Last 7 days" },
] as const;

function Banner({
  rule,
  fetchedAt,
  extra,
  range,
  count,
  since,
  failed,
}: {
  rule: ReactNode;
  fetchedAt?: number;
  /** The feed errored with nothing to show, so don't claim it is still loading. */
  failed?: boolean;
  extra?: ReactNode;
  range: Range;
  count: number;
  since?: number;
}) {
  const now = useNow();
  const partial = range === "week" && now && weekIncomplete(since, now);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm">
      <span className="font-semibold">
        {range === "week" ? `Last ${WEEK_DAYS} days` : "Latest"} · {count} {count === 1 ? "trade" : "trades"}
        <span className="font-normal"> · {rule}</span>
      </span>
      <span className="text-xs text-muted">
        {partial && since
          ? `Collecting since ${new Date(since).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}; the full week fills in as the server runs. `
          : ""}
        {extra}
        {fetchedAt && now ? `Data refreshed ${agoShort(fetchedAt, now)}` : failed ? "Feed unavailable" : "Loading…"}
      </span>
    </div>
  );
}

/** Per-user follow list: names (members, insiders) or tickers. canFollow is false when logged out. */
interface Fl {
  canFollow: boolean;
  /** Only show rows that match something followed. */
  only: boolean;
  list: string[];
  has: (name: string) => boolean;
  toggle: (name: string) => void;
  match: (r: LeaderRow) => boolean;
}

const chip = (on: boolean) =>
  `rounded border px-2 py-0.5 text-xs font-medium ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:border-accent hover:text-ink"}`;

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {children}
    </label>
  );
}

function TickerCell({ row }: { row: LeaderRow }) {
  const t = row.ticker;
  const id = t ? `${t}.US` : "";
  return (
    <div className="min-w-0">
      {t && isValidId(id) ? (
        <Link href={`/stock/${id}`} className="font-semibold text-accent hover:underline">
          {t}
        </Link>
      ) : (
        t && <span className="font-semibold">{t}</span>
      )}
      <div className="max-w-[26ch] truncate text-xs text-muted" title={row.company}>
        {row.company}
      </div>
    </div>
  );
}

function Table({ rows, kind, empty, fl }: { rows: LeaderRow[]; kind: Sub; empty: string; fl: Fl }) {
  const stakes = kind === "stakes";
  const th = "px-2 py-1.5 text-left text-xs font-medium text-muted whitespace-nowrap";
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-panel2">
          <tr>
            <th className={th}>{stakes ? "Filer" : "Who"}</th>
            <th className={th}>{stakes ? "Company" : "Ticker"}</th>
            <th className={th}>{stakes ? "Form" : "Action"}</th>
            {!stakes && <th className={th}>Size</th>}
            <th className={th}>{stakes ? "Event" : "Traded"}</th>
            <th className={th}>Filed</th>
            <th className={th}>Delay</th>
            <th className={th} aria-label="Filing" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const days = delayDays(r.traded, r.filed);
            return (
              <tr key={r.id} className="border-t border-line hover:bg-panel2">
                <td className="px-2 py-1">
                  <div className="flex max-w-[30ch] items-center gap-1">
                    {fl.canFollow && (
                      <button
                        onClick={() => fl.toggle(r.who)}
                        aria-pressed={fl.has(r.who)}
                        aria-label={fl.has(r.who) ? `Unfollow ${r.who}` : `Follow ${r.who}`}
                        title={fl.has(r.who) ? "Unfollow" : "Follow"}
                        className={`shrink-0 leading-none ${fl.has(r.who) ? "text-warn" : "text-muted hover:text-warn"}`}
                      >
                        {fl.has(r.who) ? "★" : "☆"}
                      </button>
                    )}
                    <span className="truncate font-medium" title={r.who}>
                      {r.who}
                    </span>
                  </div>
                  {r.sub && <div className="max-w-[28ch] truncate text-xs text-muted">{r.sub}</div>}
                </td>
                <td className="px-2 py-1">
                  {stakes ? (
                    <div className="max-w-[32ch] truncate" title={r.company}>
                      {r.company}
                    </div>
                  ) : (
                    <TickerCell row={r} />
                  )}
                </td>
                <td className={`px-2 py-1 whitespace-nowrap ${r.side === "buy" ? "text-gain" : r.side === "sell" ? "text-loss" : ""}`}>
                  {r.side === "buy" ? "▲ " : r.side === "sell" ? "▼ " : ""}
                  {r.action}
                  {r.code && <span className="text-muted"> ({r.code})</span>}
                </td>
                {!stakes && <td className="px-2 py-1 whitespace-nowrap text-muted">{r.size}</td>}
                <td className="px-2 py-1 whitespace-nowrap">{fmtDay(r.traded)}</td>
                <td className="px-2 py-1 whitespace-nowrap" title={r.filedAt ? new Date(r.filedAt).toLocaleString() : undefined}>
                  {r.filedAt && kind !== "congress" ? whenShort(r.filedAt, Date.now()) : fmtDay(r.filed)}
                </td>
                <td className="px-2 py-1">
                  <DelayPill days={days} />
                </td>
                <td className="px-2 py-1">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                    Filing ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

function Insiders({ range, fl }: { range: Range; fl: Fl }) {
  const api = useApi<InsidersData>("/api/leaders/insiders", 300_000);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    return applyRange(api.data?.rows ?? [], range, "insiders", Date.now()).filter(
      (r) => (all || r.code === "P" || r.code === "S") && (!s || r.ticker?.includes(s) || r.who.toUpperCase().includes(s)) && (!fl.only || fl.match(r)),
    );
  }, [api.data, all, q, range, fl]);
  return (
    <>
      <Banner
        rule="Insiders must report within 2 business days. Shown here up to ~10 min after filing."
        fetchedAt={api.data?.fetchedAt}
        range={range}
        count={rows.length}
        since={api.data?.since}
        failed={!!api.error && !api.data}
        extra={api.data ? `Read ${api.data.listed} Form 4 filings · ` : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter ticker or name"
          aria-label="Filter by ticker or name"
          className="h-7 w-44 rounded border border-line bg-panel2 px-2 text-xs"
        />
        <Toggle on={all} onChange={setAll}>
          Show other codes (awards, gifts, option exercises)
        </Toggle>
        <span className="text-xs text-muted">Default: open-market buys (P) and sales (S) only.</span>
      </div>
      {api.error && !api.data ? (
        <ErrorBox error={api.error} onRetry={api.reload} compact />
      ) : api.loading ? (
        <Loading />
      ) : (
        <Table fl={fl} rows={rows} kind="insiders" empty={range === "week" ? "No matching Form 4 transactions in the last 7 days." : "No matching Form 4 transactions in the latest filings."} />
      )}
    </>
  );
}

function Congress({ range, fl }: { range: Range; fl: Fl }) {
  const api = useApi<CongressData>("/api/leaders/congress", 900_000);
  const [fresh, setFresh] = useState(true);
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [chamber, setChamber] = useState<"all" | "house" | "senate">("all");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const now = Date.now();

  const watch = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of api.data?.rows ?? []) n.set(r.who, (n.get(r.who) ?? 0) + 1);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return ["Nancy Pelosi", ...top.filter((x) => !/pelosi/i.test(x))].slice(0, 6);
  }, [api.data]);

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    return applyRange(api.data?.rows ?? [], range, "congress", Date.now()).filter(
      (r) =>
        (!fresh || isFresh(delayDays(r.traded, r.filed))) &&
        (side === "all" || r.side === side) &&
        (chamber === "all" || r.sub?.toLowerCase().startsWith(chamber)) &&
        (!who || r.who.toLowerCase().includes(who.toLowerCase())) &&
        (!s || r.ticker?.includes(s)) &&
        (!fl.only || fl.match(r)),
    );
  }, [api.data, fresh, side, chamber, who, q, range, fl]);

  const houseDays = range === "week" ? WEEK_DAYS : HOUSE_LATEST_DAYS;
  const houseCut = new Date(now - houseDays * 86_400_000).toISOString().slice(0, 10);
  const house = (api.data?.house ?? []).filter((h) => h.filed >= houseCut);
  const today = new Date(now).toISOString().slice(0, 10);
  const yday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <Banner
        rule={
          fresh
            ? `Congress members may wait up to 45 days. Showing only trades filed within ${FRESH_DAYS} days.`
            : "Congress members may wait up to 45 days to report. Showing all trades, including late filings."
        }
        fetchedAt={api.data?.fetchedAt}
        range={range}
        count={rows.length}
        since={api.data?.since}
        failed={!!api.error && !api.data}
        extra={api.data ? `Trades refresh every ${api.data.refreshMin >= 60 ? `${api.data.refreshMin / 60} h` : `${api.data.refreshMin} min`}${api.data.keyed ? "" : " (keyless daily limit)"} · ` : undefined}
      />
      {house.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-md border border-line bg-panel2 px-2 py-1 text-xs whitespace-nowrap">
          <span className="font-semibold">New House filings (last {houseDays} days)</span>
          {house.slice(0, 12).map((h) => (
            <a
              key={h.id}
              href={h.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border border-line bg-panel px-1.5 py-0.5 hover:border-accent"
              title="Periodic transaction report (PDF). Trade dates are inside the PDF."
            >
              {(h.filed === today || h.filed === yday) && <span className="rounded bg-accent px-1 text-[10px] font-bold text-accentink">NEW</span>}
              {h.name} <span className="text-muted">{h.state} · filed {fmtDay(h.filed)} ↗</span>
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button className={chip(!who)} onClick={() => setWho("")}>
          Everyone
        </button>
        {watch.map((n) => (
          <button key={n} className={chip(who === n)} onClick={() => setWho(who === n ? "" : n)}>
            {n}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticker"
          aria-label="Filter by ticker"
          className="h-7 w-24 rounded border border-line bg-panel2 px-2 text-xs"
        />
        <Tabs
          tabs={[{ id: "all", label: "Buy + sell" }, { id: "buy", label: "Buys" }, { id: "sell", label: "Sells" }] as const}
          value={side}
          onChange={setSide}
          label="Trade side"
        />
        <Tabs
          tabs={[{ id: "all", label: "House + Senate" }, { id: "house", label: "House" }, { id: "senate", label: "Senate" }] as const}
          value={chamber}
          onChange={setChamber}
          label="Chamber"
        />
        <Toggle on={fresh} onChange={setFresh}>
          Fresh filings only
        </Toggle>
      </div>
      {api.error && !api.data ? (
        <ErrorBox error={api.error} onRetry={api.reload} compact />
      ) : api.loading ? (
        <Loading />
      ) : (
        <Table
          fl={fl}
          rows={rows}
          kind="congress"
          empty={fresh ? "No trades filed within 3 days of the trade. Untick “Fresh filings only” to see late filings." : "No matching trades."}
        />
      )}
    </>
  );
}

function Stakes({ range, fl }: { range: Range; fl: Fl }) {
  const api = useApi<StakesData>("/api/leaders/stakes", 600_000);
  const rows = useMemo(
    () => applyRange(api.data?.rows ?? [], range, "stakes", Date.now()).filter((r) => !fl.only || fl.match(r)),
    [api.data, range, fl],
  );
  return (
    <>
      <Banner
        rule="13D: within 5 business days of crossing 5%. 13G: up to 45 days."
        fetchedAt={api.data?.fetchedAt}
        range={range}
        count={rows.length}
        since={api.data?.since}
        failed={!!api.error && !api.data}
      />
      {api.error && !api.data ? (
        <ErrorBox error={api.error} onRetry={api.reload} compact />
      ) : api.loading ? (
        <Loading />
      ) : (
        <Table fl={fl} rows={rows} kind="stakes" empty="No Schedule 13D/13G filings listed right now." />
      )}
    </>
  );
}

function FollowBar({ fl, setOnly, add }: { fl: Fl; setOnly: (v: boolean) => void; add: (name: string) => void }) {
  const [q, setQ] = useState("");
  if (!fl.canFollow) {
    return (
      <div className="text-xs text-muted">
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>{" "}
        to follow members, insiders and tickers.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs font-semibold">Following</span>
      {fl.list.length === 0 && <span className="text-xs text-muted">nobody yet. Star a name below, or add one.</span>}
      {fl.list.map((n) => (
        <button key={n} className={chip(true)} onClick={() => fl.toggle(n)} title="Click to unfollow" aria-label={`Unfollow ${n}`}>
          {n} ×
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(q);
          setQ("");
        }}
        className="flex items-center gap-1"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Follow name or ticker"
          aria-label="Follow a name or ticker"
          className="h-7 w-44 rounded border border-line bg-panel2 px-2 text-xs"
        />
        <button className="h-7 rounded border border-line px-2 text-xs font-medium hover:border-accent hover:text-accent">Follow</button>
      </form>
      <Toggle on={fl.only} onChange={setOnly}>
        Only followed
      </Toggle>
    </div>
  );
}

export function LeadersView() {
  const [sub, setSubRaw] = useState<Sub>("insiders");
  const [range, setRange] = useState<Range>("latest");
  const [only, setOnly] = useState(false);
  const acct = useAccount();
  const f = useFollows();
  const setSub = (v: Sub) => {
    setSubRaw(v);
    trackClient("tab_viewed", { tab: `leaders/${v}` });
  };
  const fl: Fl = useMemo(
    () => ({
      canFollow: !!acct.user,
      only: only && !!acct.user,
      list: f.follows,
      has: f.isFollowing,
      toggle: (n) => (f.isFollowing(n) ? f.unfollow(n) : f.follow(n)),
      match: (r) =>
        f.follows.some((x) => sameLeader(r.who, x) || r.who.toLowerCase().includes(x.toLowerCase()) || (!!r.ticker && r.ticker.toUpperCase() === x.toUpperCase())),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acct.user, only, f.follows],
  );
  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-baseline gap-2">
          Leaders
          <span className="text-xs font-normal text-muted">Public STOCK Act and SEC filings. Not financial advice.</span>
        </span>
      }
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Tabs tabs={RANGES} value={range} onChange={setRange} label="Date range" />
          <Tabs tabs={SUBS} value={sub} onChange={setSub} label="Disclosure type" />
        </div>
      }
      bodyClass="flex min-h-0 flex-col gap-2 p-3"
    >
      <FollowBar fl={fl} setOnly={setOnly} add={f.follow} />
      {sub === "insiders" ? <Insiders range={range} fl={fl} /> : sub === "congress" ? <Congress range={range} fl={fl} /> : <Stakes range={range} fl={fl} />}
    </Panel>
  );
}
