import type { Metadata } from "next";
import { NewsView } from "@/components/NewsView";

export const metadata: Metadata = { title: "News - Meridian" };

export default function NewsPage() {
  return <NewsView />;
}
