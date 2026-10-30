"use client";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import type { Direction } from "@/lib/format";

const STROKE: Record<Direction, string> = {
  up: "var(--gain)",
  down: "var(--loss)",
  flat: "var(--muted)",
};

const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const weekday = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: "short" });
const full = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function Sparkline({
  data,
  dir,
  prevClose,
  axis = true,
}: {
  data: { t: number; v: number }[];
  dir: Direction;
  prevClose?: number | null;
  /** show the session's start and end times under the line */
  axis?: boolean;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-full items-center text-xs text-muted">
        No intraday data
      </div>
    );
  }
  const values = data.map((d) => d.v);
  const lo = Math.min(...values, prevClose ?? Infinity);
  const hi = Math.max(...values, prevClose ?? -Infinity);
  const start = data[0].t;
  const end = data[data.length - 1].t;
  const sameDay =
    new Date(start).toDateString() === new Date(end).toDateString();
  const chart = (
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 200, height: 48 }}
    >
      <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <YAxis hide domain={[lo, hi]} />
        {prevClose != null && (
          <ReferenceLine
            y={prevClose}
            stroke="var(--line)"
            strokeDasharray="3 3"
            ifOverflow="extendDomain"
          />
        )}
        <Line
          type="linear"
          dataKey="v"
          stroke={STROKE[dir]}
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
  if (!axis) return chart;
  return (
    <div
      className="flex h-full min-w-0 flex-col"
      title={`Last trading session, ${full(start)} to ${full(end)} (your time).${prevClose != null ? " Dashed line: previous close." : ""}`}
    >
      <div className="min-h-0 flex-1">{chart}</div>
      <div className="flex justify-between gap-1 text-[10px] leading-3 whitespace-nowrap text-muted">
        <span>
          {weekday(start)} {clock(start)}
        </span>
        <span>{sameDay ? clock(end) : `${weekday(end)} ${clock(end)}`}</span>
      </div>
    </div>
  );
}
