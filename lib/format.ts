const MINUS = "−";

export const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return "—";
  return n.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** +1.23 / −1.23 / 0.00 using a true minus sign. */
export function fmtSigned(n: number | null | undefined, digits = 2): string {
  if (!isNum(n)) return "—";
  const body = fmtNum(Math.abs(n), digits);
  const rounded = Number(Math.abs(n).toFixed(digits));
  if (rounded === 0) return body;
  return `${n > 0 ? "+" : MINUS}${body}`;
}

export const fmtPct = (n: number | null | undefined, digits = 2) =>
  isNum(n) ? `${fmtSigned(n, digits)}%` : "—";

export type Direction = "up" | "down" | "flat";

export function direction(n: number | null | undefined, digits = 2): Direction {
  if (!isNum(n)) return "flat";
  const r = Number(n.toFixed(digits));
  return r > 0 ? "up" : r < 0 ? "down" : "flat";
}

export function fmtCompact(n: number | null | undefined): string {
  if (!isNum(n)) return "—";
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [v, s] of units) {
    if (abs >= v) return `${(n / v).toFixed(abs >= v * 100 ? 0 : abs >= v * 10 ? 1 : 2)}${s}`;
  }
  return n.toFixed(0);
}

/** Price decimals: sub-dollar prices and FX need more precision. */
export const priceDigits = (price: number | null | undefined, symbol = ""): number =>
  symbol.endsWith("=X") ? 4 : isNum(price) && price < 1 ? 3 : 2;
