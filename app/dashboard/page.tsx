import type { Metadata } from "next";
import { BoardsView } from "@/components/BoardsView";

export const metadata: Metadata = { title: "Dashboard - Meridian" };

export default function DashboardPage() {
  return <BoardsView />;
}
