"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";
import {
  isOptionInstrument,
  runModel,
  type EventRule,
  type MBar,
  type TradeSpec,
} from "@/lib/model";
import { indexSymbolFor, SECTORS } from "@/lib/sectors";
import { toYahoo } from "@/lib/symbols";
import { DAY_MS } from "@/lib/trades";

const MAX_HISTORY_MS = 3650 * DAY_MS - DAY_MS;
const WARMUP_MS = 100 * DAY_MS;
const CONCURRENCY = 4;
const th = "px-2 py-1 text-left text-xs font-medium text-muted";
const td = "px-2 py-1 tabular-nums";
const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${fmtNum(n, d)}%`;
const tone = (n: number) =>
  n > 0 ? "text-gain" : n < 0 ? "text-loss" : "text-muted";

/** Bars already fetched this page session, keyed by Yahoo symbol and start day, so reloads are instant. */
const cache = new Map<string, MBar[]>();

async function getBars(
  sym: string,
  from: number,
  signal: AbortSignal,
): Promise<MBar[] | null> {
  const key = `${sym}|${Math.floor(from / DAY_MS)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(
    `/api/history?symbol=${encodeURIComponent(sym)}&from=${Math.floor(from)}`,
    { signal },
  );
  const body = (await res.json().catch(() => null)) as { bars?: MBar[] } | null;
  if (!res.ok || !body?.bars?.length) return null;
  cache.set(key, body.bars);
  return body.bars;
}

interface Loaded {
  data: Record<string, MBar[]>;
  indexes: Record<string, MBar[]>;
  missing: string[];
  fromMs: number;
  years: number;
}

/** Runs the selected hypothesis on each sector's tickers (same runModel/summarise as the other tabs). */
export function SectorPanel({
  rule,
  spec,
  years,
  hypoLabel,
}: {
  rule: EventRule | null;
  spec: TradeSpec | null;
  years: number;
  hypoLabel: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function load() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const now = Date.now();
    const from = Math.max(
      now - years * 365 * DAY_MS - WARMUP_MS,
      now - MAX_HISTORY_MS,
    );
    const idxFrom = Math.max(from - 300 * DAY_MS, now - MAX_HISTORY_MS);
    const list = [...new Set(SECTORS.flatMap((s) => s.ids))];
    const idxSyms = [
      ...new Set(
        list.map(indexSymbolFor).filter((x): x is string => x !== null),
      ),
    ];
    const data: Record<string, MBar[]> = {};
    const indexes: Record<string, MBar[]> = {};
    const missing: string[] = [];
    let done = 0;
    let next = 0;
    const total = list.length + idxSyms.length;
    setProgress({ done: 0, total });
    const worker = async () => {
      while (next < list.length && !ctrl.signal.aborted) {
        const id = list[next++];
        try {
          const b = await getBars(toYahoo(id), from, ctrl.signal);
          if (b) data[id] = b;
          else missing.push(id);
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          missing.push(id);
        }
        setProgress({ done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    for (const sym of idxSyms) {
      if (ctrl.signal.aborted) return;
      try {
        const b = await getBars(sym, idxFrom, ctrl.signal);
        if (b) indexes[sym] = b;
        else missing.push(sym);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        missing.push(sym);
      }
      setProgress({ done: ++done, total });
    }
    if (ctrl.signal.aborted) return;
    setLoaded({
      data,
      indexes,
      missing,
      fromMs: now - years * 365 * DAY_MS,
      years,
    });
    setProgress(null);
  }

  const opt = spec ? isOptionInstrument(spec.instrument) : false;
  const rows = useMemo(() => {
    if (!loaded || !rule || !spec) return [];
    const indexFor = (t: string) => {
      const s = indexSymbolFor(t);
      return s ? loaded.indexes[s] : undefined;
    };
    return SECTORS.map((sec) => {
      // listed options do not exist on spot crypto, so option instruments are skipped there
      if (sec.crypto && opt) return { sec, res: null, skipped: true };
      const sub: Record<string, MBar[]> = {};
      for (const id of sec.ids) if (loaded.data[id]) sub[id] = loaded.data[id];
      return {
        sec,
        res: runModel(sub, rule, spec, loaded.fromMs, { indexFor }),
        skipped: false,
      };
    });
  }, [loaded, rule, spec, opt]);

  const stale = loaded !== null && loaded.years !== years;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <button
          type="button"
          onClick={load}
          disabled={progress !== null}
          className="rounded-md border border-line bg-panel px-3 py-1 text-ink hover:bg-bg disabled:opacity-60"
        >
          {progress
            ? `Loading ${progress.done}/${progress.total}`
            : loaded
              ? "Reload all sectors"
              : "Load all sectors"}
        </button>
        <span>
          Hypothesis: <strong className="text-ink">{hypoLabel}</strong>, last{" "}
          {years} yr. Uses the rule and trade settings on the left.
        </span>
        {stale && <span className="text-warn">Period changed, reload.</span>}
      </div>
      {!rule || !spec ? (
        <p className="text-sm text-warn">
          Fix the rule or trade settings first.
        </p>
      ) : !loaded ? (
        <p className="text-sm text-muted">
          Load all sectors to compare how this hypothesis does in each.
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Sector</th>
                <th className={th}>Trades</th>
                <th className={th}>Hit rate</th>
                <th className={th}>Mean return</th>
                <th className={th}>Edge vs baseline</th>
                <th className={th}>t-stat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sec, res, skipped }) => (
                <tr key={sec.id} className="border-t border-line">
                  <td className={td}>{sec.label}</td>
                  {skipped ? (
                    <td className={`${td} text-muted`} colSpan={5}>
                      n/a: no listed options on spot crypto
                    </td>
                  ) : !res || res.summary.count === 0 ? (
                    <td className={`${td} text-muted`} colSpan={5}>
                      0 trades
                      {sec.crypto && rule.kind.startsWith("earn")
                        ? " (crypto has no earnings)"
                        : ""}
                    </td>
                  ) : (
                    <>
                      <td className={td}>{res.summary.count}</td>
                      <td className={td}>{fmtNum(res.summary.winRate, 0)}%</td>
                      <td className={`${td} ${tone(res.summary.avg)}`}>
                        {pct(res.summary.avg, 2)}
                      </td>
                      <td className={`${td} ${tone(res.edge)}`}>
                        {pct(res.edge, 2)}
                      </td>
                      <td className={td}>{fmtNum(res.stats.t, 2)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {loaded.missing.length > 0 && (
            <p className="text-xs text-muted">
              No data for: {loaded.missing.join(", ")}.
            </p>
          )}
          <p className="text-xs text-muted">
            Crypto trades every day, so a hold of N days is N calendar days
            there. Its filters use BTC-USD as the index. Today&apos;s
            constituents, so survivorship bias applies. Small samples give
            noisy t-stats.
          </p>
        </>
      )}
    </div>
  );
}
