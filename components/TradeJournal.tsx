"use client";
import { useState } from "react";
import { fmtNum } from "@/lib/format";
import { closedStats, netPositions, type PortfolioRow } from "@/lib/trade-portfolio";
import { MAX_REASON_LEN, type TradeReview, type Verdict } from "@/lib/trades";
import { Change, Panel, Tabs } from "@/components/ui";

const TABS = [
  { id: "net", label: "Net position" },
  { id: "stats", label: "Stats" },
  { id: "review", label: "Review" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const VERDICT_LABEL: Record<Verdict, string> = { yes: "Yes", partly: "Partly", no: "No" };

function ReviewRow({ row, onSave }: { row: PortfolioRow & { code: string }; onSave: (id: string, r: TradeReview) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const { trade, result } = row;
  return (
    <li className="min-w-0 rounded-md border border-line p-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-semibold">{row.code}</span>
        {result?.pl != null && <Change value={result.pl} pct={result.plPct} />}
      </div>
      {trade.reason && <p className="mt-0.5 text-xs break-words text-muted">Why: {trade.reason}</p>}
      <p className="mt-1.5 text-xs font-medium">Was I right for the right reason?</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {(["yes", "partly", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={verdict === v}
            onClick={() => setVerdict(v)}
            className={`rounded border px-2 py-0.5 text-xs font-medium ${verdict === v ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {VERDICT_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex min-w-0 gap-1.5">
        <input
          value={note}
          maxLength={MAX_REASON_LEN}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Review note"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="button"
          disabled={!verdict}
          onClick={() => verdict && onSave(trade.id, { verdict, ...(note.trim() ? { note: note.trim() } : {}) })}
          className="h-8 shrink-0 rounded-md bg-accent px-3 text-xs font-semibold text-accentink hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </li>
  );
}

/** Portfolio net positions, closed-trade stats and the after-trade review queue. Compact, tabbed. */
export function TradeJournal({ rows, now, onReview }: { rows: (PortfolioRow & { code: string })[]; now: number; onReview: (id: string, r: TradeReview) => void }) {
  const [tab, setTab] = useState<Tab>("net");
  const net = netPositions(rows, now);
  const stats = closedStats(rows);
  const codeOf = new Map(rows.map((r) => [r.trade.symbol, r.code]));
  const finished = rows.filter((r) => r.result && r.result.status !== "open");
  const todo = finished.filter((r) => !r.trade.review);
  const done = finished.filter((r) => r.trade.review);
  const rightCount = done.filter((r) => r.trade.review?.verdict === "yes").length;

  return (
    <Panel title="Portfolio and journal" right={<Tabs tabs={TABS} value={tab} onChange={setTab} label="Journal view" />} bodyClass="max-h-72 overflow-auto p-3">
      {tab === "net" &&
        (net.length === 0 ? (
          <p className="text-sm text-muted">
            {rows.some((r) => !r.result || r.result.status === "open")
              ? "Waiting for prices to load for your open trades."
              : "No open trades."}
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {net.map((p) => {
                const n = Math.round(Math.abs(p.shares));
                return (
                  <li key={p.symbol} className="min-w-0 break-words">
                    <span className="font-semibold">Net {codeOf.get(p.symbol) ?? p.symbol}:</span>{" "}
                    <span className={p.direction === "bullish" ? "text-gain" : p.direction === "bearish" ? "text-loss" : "text-muted"}>{p.direction}</span>
                    {p.direction !== "flat" && <span className="text-muted"> ≈ {p.shares > 0 ? "long" : "short"} {fmtNum(n, 0)} shares</span>}
                    <span className="text-xs text-muted"> ({p.trades} trade{p.trades === 1 ? "" : "s"}{p.approx ? ", approx." : ""})</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">Options count as Black-Scholes delta x shares covered (delta x 100 x contracts); sold options flip the sign.</p>
          </>
        ))}
      {tab === "stats" &&
        (stats.count === 0 ? (
          <p className="text-sm text-muted">No finished trades yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="min-w-0">
                <div className="text-xs text-muted">Win rate</div>
                <div className="font-semibold">{stats.winRate === null ? "—" : `${fmtNum(stats.winRate, 0)}%`}</div>
                <div className="text-xs text-muted">{stats.count} closed</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted">Avg win</div>
                <div className="font-semibold text-gain">{stats.avgWin === null ? "—" : fmtNum(stats.avgWin)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted">Avg loss</div>
                <div className="font-semibold text-loss">{stats.avgLoss === null ? "—" : fmtNum(stats.avgLoss)}</div>
              </div>
            </div>
            <ul className="divide-y divide-line/60 border-t border-line">
              {stats.byStrategy.map((s) => (
                <li key={s.label} className="flex items-baseline justify-between gap-2 py-1">
                  <span className="min-w-0 truncate">
                    {s.label} <span className="text-xs text-muted">({s.count})</span>
                  </span>
                  <Change value={s.pl} pct={null} />
                </li>
              ))}
            </ul>
            {done.length > 0 && <p className="text-xs text-muted">Right for the right reason: {rightCount} of {done.length} reviewed.</p>}
          </div>
        ))}
      {tab === "review" &&
        (finished.length === 0 ? (
          <p className="text-sm text-muted">Finished trades show up here for a quick review.</p>
        ) : (
          <div className="space-y-2">
            {todo.length === 0 ? <p className="text-sm text-muted">All finished trades reviewed.</p> : <ul className="space-y-2">{todo.map((r) => <ReviewRow key={r.trade.id} row={r} onSave={onReview} />)}</ul>}
            {done.length > 0 && (
              <ul className="space-y-1 border-t border-line pt-2 text-xs text-muted">
                {done.map((r) => (
                  <li key={r.trade.id} className="min-w-0 break-words">
                    <span className="font-semibold text-ink">{r.code}</span>: {VERDICT_LABEL[r.trade.review!.verdict]}
                    {r.trade.review?.note ? ` - ${r.trade.review.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </Panel>
  );
}
