"use client";
import { Area, Bar, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartDTO } from "@/lib/yahoo";
import type { Range } from "@/lib/ranges";
import { direction, fmtCompact, fmtNum } from "@/lib/format";

const TZ = "Australia/Sydney";
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o });
const fmtTime = f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDayTime = f({ weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDay = f({ day: "numeric", month: "short" });
const fmtMonth = f({ month: "short", year: "2-digit" });
const fmtFull = f({ weekday: "short", day: "numeric", month: "short", year: "numeric" });

function tickFormat(range: Range, t: number) {
  const d = new Date(t);
  if (range === "1D") return fmtTime.format(d);
  if (range === "5D") return fmtDayTime.format(d);
  if (range === "5Y" || range === "1Y") return fmtMonth.format(d);
  return fmtDay.format(d);
}

interface TipProps {
  active?: boolean;
  payload?: { payload: { t: number; close: number; volume: number | null } }[];
  range: Range;
}

function Tip({ active, payload, range }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const intraday = range === "1D" || range === "5D";
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-muted">{intraday ? `${fmtFull.format(new Date(p.t))} ${fmtTime.format(new Date(p.t))}` : fmtFull.format(new Date(p.t))}</div>
      <div className="text-sm font-semibold">{fmtNum(p.close, p.close < 1 ? 3 : 2)}</div>
      <div className="text-muted">Vol {fmtCompact(p.volume)}</div>
    </div>
  );
}

export function PriceChart({ chart, range }: { chart: ChartDTO; range: Range }) {
  const pts = chart.points;
  const first = pts[0]?.close ?? 0;
  const last = pts[pts.length - 1]?.close ?? 0;
  const dir = direction(last - first, 4);
  const color = dir === "down" ? "var(--loss)" : dir === "up" ? "var(--gain)" : "var(--muted)";

  const closes = pts.map((p) => p.close);
  const showPrev = range === "1D" && chart.prevClose != null;
  const lo = Math.min(...closes, showPrev ? chart.prevClose! : Infinity);
  const hi = Math.max(...closes, showPrev ? chart.prevClose! : -Infinity);
  const pad = (hi - lo) * 0.08 || hi * 0.01;
  const maxVol = Math.max(...pts.map((p) => p.volume ?? 0), 1);

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 400 }}>
      <ComposedChart data={pts} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          tickFormatter={(t: number) => tickFormat(range, t)}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          stroke="var(--line)"
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          yAxisId="p"
          orientation="right"
          domain={[lo - pad, hi + pad]}
          tickFormatter={(v: number) => fmtNum(v, hi < 10 ? 3 : 2)}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          stroke="var(--line)"
          tickLine={false}
          width={58}
        />
        <YAxis yAxisId="v" hide domain={[0, maxVol * 4.5]} />
        <Tooltip content={<Tip range={range} />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} />
        {showPrev && (
          <ReferenceLine yAxisId="p" y={chart.prevClose!} stroke="var(--muted)" strokeDasharray="4 4" />
        )}
        <Bar yAxisId="v" dataKey="volume" fill="var(--muted)" fillOpacity={0.35} isAnimationActive={false} />
        <Area
          yAxisId="p"
          dataKey="close"
          type="linear"
          stroke={color}
          strokeWidth={2}
          fill="url(#fillPrice)"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
