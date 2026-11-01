import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { listAccounts } from "@/lib/accounts";
import { PERSONAS } from "@/lib/personas";
import { AdminTable, type AdminRow } from "@/components/AdminTable";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin - Meridian", robots: { index: false } };

export default async function AdminPage() {
  if (!(await getAdminSession())) notFound();
  const signups = await listAccounts().catch(() => []);
  const rows: AdminRow[] = PERSONAS.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    plan: p.plan,
    country: p.country,
    signupDate: p.signupDate,
    interests: p.interests,
    risk: p.risk,
    stage: p.stage,
    pins: p.boards.boards.reduce((n, b) => n + b.ids.length, 0),
    follows: p.follows.length,
  }));
  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-baseline gap-2">
          Admin
          <span className="text-xs font-normal text-muted">Fictional test personas and real sign-ups. Impersonating acts as that user and is reported to the CEP hook.</span>
        </span>
      }
      bodyClass="min-h-0 overflow-auto"
    >
      <AdminTable rows={rows} signups={signups} />
    </Panel>
  );
}
