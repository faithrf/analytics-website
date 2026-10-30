import type { Metadata } from "next";
import { StockView } from "@/components/StockView";
import { displayCode, isValidId } from "@/lib/symbols";

type Props = { params: Promise<{ code: string }> };

const toId = (raw: string) => {
  const id = decodeURIComponent(raw).toUpperCase();
  return isValidId(id) ? id : "X";
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `${displayCode(toId(code))} - Bellwether` };
}

export default async function StockPage({ params }: Props) {
  const { code } = await params;
  return <StockView code={toId(code)} />;
}
