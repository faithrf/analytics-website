"use client";
import { useState } from "react";
import { impersonate, resetPersona } from "@/lib/use-account";

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  country: string;
  signupDate: string;
  interests: string[];
  risk: string;
  stage: string;
  pins: number;
  follows: number;
}

const STAGE: Record<string, string> = {
  new: "bg-accent/15 text-accent",
  active: "bg-gain/15 text-gain",
  lapsed: "bg-warn/15 text-warn",
  churned: "bg-loss/15 text-loss",
};

export interface SignupRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export function AdminTable({ rows, signups }: { rows: AdminRow[]; signups: SignupRow[] }) {
  const [tab, setTab] = useState<"personas" | "signups">("personas");
  const [msg, setMsg] = useState("");
  const th = "px-2 py-1.5 text-left text-xs font-medium text-muted whitespace-nowrap";
  const btn = "rounded border border-line px-2 py-0.5 text-xs font-medium hover:border-accent hover:text-accent";
  return (
    <>
      <div role="tablist" className="flex gap-1 border-b border-line px-2 py-1.5">
        {(["personas", "signups"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-sm font-medium ${tab === t ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}
          >
            {t === "personas" ? `Personas (${rows.length})` : `Sign-ups (${signups.length})`}
          </button>
        ))}
      </div>
      {tab === "signups" ? (
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-panel2">
            <tr>
              <th className={th}>Account</th>
              <th className={th}>Created</th>
              <th className={th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {signups.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-panel2">
                <td className="px-2 py-1">
                  <div className="font-medium">{r.name || "(no name)"}</div>
                  <div className="text-xs text-muted">{r.email}</div>
                </td>
                <td className="px-2 py-1 whitespace-nowrap">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button className={`${btn} mr-1.5`} onClick={() => void impersonate(r.id)}>
                    Impersonate
                  </button>
                  <button
                    className={btn}
                    onClick={async () => {
                      const x = await resetPersona(r.id);
                      setMsg(x.ok ? `Reset ${r.email}.` : (x.message ?? "Reset failed."));
                    }}
                  >
                    Reset data
                  </button>
                </td>
              </tr>
            ))}
            {signups.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-xs text-muted">
                  No sign-ups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-panel2">
          <tr>
            <th className={th}>Persona</th>
            <th className={th}>Plan</th>
            <th className={th}>Country</th>
            <th className={th}>Signed up</th>
            <th className={th}>Stage</th>
            <th className={th}>Risk</th>
            <th className={th}>Interests</th>
            <th className={th}>Seed</th>
            <th className={th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line hover:bg-panel2">
              <td className="px-2 py-1">
                <div className="font-medium">{r.name.replace(/^Test Persona - /, "")}</div>
                <div className="text-xs text-muted">{r.email}</div>
              </td>
              <td className="px-2 py-1 capitalize">{r.plan}</td>
              <td className="px-2 py-1">{r.country}</td>
              <td className="px-2 py-1 whitespace-nowrap">{r.signupDate}</td>
              <td className="px-2 py-1">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STAGE[r.stage] ?? ""}`}>{r.stage}</span>
              </td>
              <td className="px-2 py-1 capitalize">{r.risk}</td>
              <td className="px-2 py-1 text-xs text-muted">{r.interests.join(", ")}</td>
              <td className="px-2 py-1 text-xs whitespace-nowrap text-muted">
                {r.pins} pins · {r.follows} follows
              </td>
              <td className="px-2 py-1 whitespace-nowrap">
                <button className={`${btn} mr-1.5`} onClick={() => void impersonate(r.id)}>
                  Impersonate
                </button>
                <button
                  className={btn}
                  onClick={async () => {
                    const x = await resetPersona(r.id);
                    setMsg(x.ok ? `Reset ${r.name}.` : (x.message ?? "Reset failed."));
                  }}
                >
                  Reset data
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {msg && (
        <p role="status" className="px-3 py-2 text-xs text-muted">
          {msg}
        </p>
      )}
    </>
  );
}
