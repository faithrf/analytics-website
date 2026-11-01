"use client";
import { impersonate, useAccount } from "@/lib/use-account";

/** Red bar on every page while an admin is acting as a test persona. */
export function ImpersonationBanner() {
  const acct = useAccount();
  if (!acct.user || !acct.impersonatedBy) return null;
  return (
    <div role="status" className="flex shrink-0 items-center justify-center gap-3 bg-loss px-3 py-1 text-sm font-semibold text-white">
      <span>Impersonating {acct.user.name} ({acct.user.email})</span>
      <button
        onClick={() => void impersonate(null)}
        className="rounded border border-white/70 px-2 py-0.5 text-xs hover:bg-white/15"
      >
        Return to admin
      </button>
    </div>
  );
}
