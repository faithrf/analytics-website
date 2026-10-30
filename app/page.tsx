import { Markets } from "@/components/Markets";
import { isRegion } from "@/lib/markets";

type Props = { searchParams: Promise<{ region?: string | string[] }> };

export default async function Home({ searchParams }: Props) {
  const { region } = await searchParams;
  return <Markets regionId={isRegion(region) ? region : "au"} />;
}
