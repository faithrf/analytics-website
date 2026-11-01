import type { Metadata } from "next";
import { LeadersView } from "@/components/LeadersView";

export const metadata: Metadata = { title: "Leaders - Meridian" };

export default function LeadersPage() {
  return <LeadersView />;
}
