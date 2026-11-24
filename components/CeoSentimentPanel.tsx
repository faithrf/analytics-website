"use client";
import { useMemo, useState } from "react";
import raw from "@/data/ceo-sentiment.json";
import { splitOf, type CeoSentimentFile, type CeoSplit } from "@/lib/ceo-sentiment";
import { fmtNum } from "@/lib/format";
import { input } from "@/components/TradesView";

const DATA = raw as unknown as CeoSentimentFile;
const pct = (n: number | null, d = 1) => (n === null ? "-" : `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`);
const tone = (n: number | null) => (n === null || n === 0 ? "text-muted" : n > 0 ? "text-gain" : "text-loss");
const th = "px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted";
const td = "px-2 py-1 tabular-nums";

export default function CeoSentimentPanel() {
  const [ceo, setCeo] = useState("all");
  const [hz, setHz] = useState<"e1" | "e5" | "e20">("e20");
  const ceos = useMemo(() => [...new Set(DATA.statements.map((s) => s.ceo))].sort(), []);
  const rows = useMemo(() => (ceo === "all" ? DATA.statements : DATA.statements.filter((s) => s.ceo === ceo)), [ceo]);
  const splits = useMemo(
    () => ({ e1: splitOf(rows.map((s) => ({ score: s.s, ex: s.e1 }))), e5: splitOf(rows.map((s) => ({ score: s.s, ex: s.e5 }))), e20: splitOf(rows.map((s) => ({ score: s.s, ex: s.e20 }))) }),
    [rows],
  );
  if (!DATA.statements.length)
    return <p className="text-sm text-muted">No data yet. Run <code>npm run ceo:sentiment</code> to build data/ceo-sentiment.json.</p>;
  const sp: CeoSplit = splits[hz];
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {DATA.note} {rows.length} statements, {ceos.length} CEOs; updated {DATA.updatedAt?.slice(0, 10)}.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          CEO
          <select className={`${input} ml-1 !w-auto`} value={ceo} onChange={(e) => setCeo(e.target.value)}>
            <option value="all">All</option>
            {ceos.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Horizon
          <select className={`${input} ml-1 !w-auto`} value={hz} onChange={(e) => setHz(e.target.value as typeof hz)}>
            <option value="e1">1 day</option>
            <option value="e5">5 days</option>
            <option value="e20">20 days</option>
          </select>
        </label>
        <span className="text-xs text-muted">Correlation {fmtNum(sp.corr, 2)} (n={sp.n})</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>Sentiment</th>
            <th className={th}>n</th>
            <th className={th}>Mean excess</th>
            <th className={th}>Hit rate</th>
            <th className={th}>t</th>
          </tr>
        </thead>
        <tbody>
          {(["low", "mid", "high"] as const).map((k) => (
            <tr key={k} className="border-b border-line/50">
              <td className={`${td} capitalize`}>{k}</td>
              <td className={td}>{sp[k].n}</td>
              <td className={`${td} ${tone(sp[k].mean)}`}>{pct(sp[k].mean, 2)}</td>
              <td className={td}>{fmtNum(sp[k].hit, 0)}%</td>
              <td className={td}>{fmtNum(sp[k].t, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="max-h-[40vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line">
              <th className={th}>Date</th>
              <th className={th}>Ticker</th>
              <th className={th}>CEO</th>
              <th className={th}>Score</th>
              <th className={th}>Quote</th>
              <th className={th}>5d</th>
              <th className={th}>20d</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((s, i) => (
              <tr key={i} className="border-b border-line/50 align-top">
                <td className={`${td} whitespace-nowrap`}>{s.d}</td>
                <td className={td}>{s.sym}</td>
                <td className={`${td} whitespace-nowrap`}>{s.ceo}</td>
                <td className={`${td} ${tone(s.s)}`}>{fmtNum(s.s, 2)}</td>
                <td className="px-2 py-1 text-xs text-muted">{s.q}</td>
                <td className={`${td} ${tone(s.e5)}`}>{pct(s.e5)}</td>
                <td className={`${td} ${tone(s.e20)}`}>{pct(s.e20)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
