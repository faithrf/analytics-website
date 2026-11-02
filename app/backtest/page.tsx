import type { Metadata } from "next";
import { BacktestView } from "@/components/BacktestView";

export const metadata: Metadata = { title: "Backtest - Meridian" };

export default function BacktestPage() {
  return <BacktestView />;
}
