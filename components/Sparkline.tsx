"use client";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import type { Direction } from "@/lib/format";

const STROKE: Record<Direction, string> = { up: "var(--gain)", down: "var(--loss)", flat: "var(--muted)" };

export function Sparkline({
  data,
  dir,
  prevClose,
}: {
  data: { t: number; v: number }[];
  dir: Direction;
  prevClose?: number | null;
}) {
  if (data.length < 2) {
    return <div className="flex h-full items-center text-xs text-muted">No intraday data</div>;
  }
  const values = data.map((d) => d.v);
  const lo = Math.min(...values, prevClose ?? Infinity);
  const hi = Math.max(...values, prevClose ?? -Infinity);
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 200, height: 48 }}>
      <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <YAxis hide domain={[lo, hi]} />
        {prevClose != null && (
          <ReferenceLine y={prevClose} stroke="var(--line)" strokeDasharray="3 3" ifOverflow="extendDomain" />
        )}
        <Line type="linear" dataKey="v" stroke={STROKE[dir]} strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
