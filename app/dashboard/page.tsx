import type { Metadata } from "next";
import { BoardsView } from "@/components/BoardsView";

export const metadata: Metadata = { title: "Dashboard - Bellwether" };

export default function DashboardPage() {
  return <BoardsView />;
}
