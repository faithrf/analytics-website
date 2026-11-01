"use client";
import Link from "next/link";
import { useState } from "react";
import { signup, useAccount } from "@/lib/use-account";
import { Panel } from "@/components/ui";

const input = "h-8 w-full rounded border border-line bg-panel2 px-2 text-sm";

export default function SignupPage() {
  const acct = useAccount();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError("");
    const r = await signup(name, email, password);
    if (!r.ok) {
      setError(r.message ?? "Sign-up failed.");
      setBusy(false);
    }
  }

  const off = acct.loaded && !acct.signupEnabled;
  return (
    <div className="mx-auto flex h-full max-w-xs flex-col justify-center">
      <Panel title="Create account" bodyClass="p-3">
        {off ? (
          <p className="text-sm text-muted">
            Sign-up is turned off. <Link href="/login" className="text-accent hover:underline">Log in</Link>
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Name (optional)
              <input type="text" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Email
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Password (8+ characters)
              <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Confirm password
              <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
            </label>
            {error && (
              <p role="alert" className="text-xs text-loss">
                {error}
              </p>
            )}
            <button disabled={busy} className="h-8 rounded bg-accent text-sm font-semibold text-accentink disabled:opacity-60">
              {busy ? "Creating…" : "Create account"}
            </button>
            <p className="text-xs text-muted">
              Have an account? <Link href="/login" className="text-accent hover:underline">Log in</Link>
            </p>
          </form>
        )}
      </Panel>
    </div>
  );
}
