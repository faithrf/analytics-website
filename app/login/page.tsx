"use client";
import { useState } from "react";
import Link from "next/link";
import { login, useAccount } from "@/lib/use-account";
import { Panel } from "@/components/ui";

const input = "h-8 w-full rounded border border-line bg-panel2 px-2 text-sm";

export default function LoginPage() {
  const acct = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await login(email, password);
    if (!r.ok) {
      setError(r.message ?? "Login failed.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-xs flex-col justify-center">
      <Panel title="Log in" bodyClass="p-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          </label>
          {error && (
            <p role="alert" className="text-xs text-loss">
              {error}
            </p>
          )}
          <button disabled={busy} className="h-8 rounded bg-accent text-sm font-semibold text-accentink disabled:opacity-60">
            {busy ? "Logging in…" : "Log in"}
          </button>
          {acct.signupEnabled && (
            <p className="text-xs text-muted">
              New here? <Link href="/signup" className="text-accent hover:underline">Create account</Link>
            </p>
          )}
          <p className="text-xs text-muted">The site works without logging in. Logging in saves dashboards and followed leaders to your account.</p>
        </form>
      </Panel>
    </div>
  );
}
