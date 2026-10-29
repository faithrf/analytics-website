import type { Metadata } from "next";
import { StockView } from "@/components/StockView";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `${code.toUpperCase()} - Bellwether` };
}

export default async function StockPage({ params }: Props) {
  const { code } = await params;
  return <StockView code={code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "X"} />;
}
