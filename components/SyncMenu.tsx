"use client";
import { useEffect, useRef, useState } from "react";
import { useSync, type SyncResult } from "@/lib/use-boards";
import { whenShort } from "@/components/ui";

const smallButton =
  "rounded border border-line px-2 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-line disabled:hover:text-inherit";

/** Toolbar button plus popover for the optional sync code. */
export function SyncMenu() {
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRemote, setConfirmRemote] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { probe } = sync;

  useEffect(() => {
    void probe();
  }, [probe]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unavailable = sync.status.kind === "not_configured" && !sync.code;
  const on = sync.code !== null;

  const run = async (fn: () => Promise<SyncResult>, after?: () => void) => {
    setBusy(true);
    setMessage(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) after?.();
    else setMessage(r.message);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sync.display ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage("Could not copy. Select the code and copy it by hand.");
    }
  };

  const status = sync.status;
  const statusText =
    status.kind === "synced"
      ? `Synced ${whenShort(status.at, status.at)}`
      : status.kind === "syncing"
        ? "Syncing..."
        : status.kind === "error"
          ? status.message
          : "";

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        disabled={unavailable}
        title={unavailable ? "Sync isn't set up on this server" : "Sync dashboards to other devices"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${smallButton} inline-flex items-center gap-1.5`}
      >
        {on && (
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${status.kind === "error" ? "bg-loss" : "bg-gain"}`}
          />
        )}
        {on ? "Sync on" : "Sync"}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Sync dashboards"
          className="absolute top-full right-0 z-50 mt-1 w-72 rounded-md border border-line bg-panel p-3 text-sm shadow-lg"
        >
          {on ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <code
                  aria-label="Sync code"
                  className="flex-1 rounded bg-panel2 px-2 py-1.5 text-center font-mono text-lg font-semibold tracking-widest select-all"
                >
                  {sync.display}
                </code>
                <button onClick={copy} className={smallButton}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p
                role="status"
                className={`text-xs ${status.kind === "error" ? "text-loss" : "text-muted"}`}
              >
                {statusText}
              </p>
              <p className="text-xs text-muted">
                Anyone with this code can see and change these dashboards. No name or email is
                stored.
              </p>
              {message && <p className="text-xs text-loss">{message}</p>}
              {confirmRemote ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs">Delete the synced copy from the server?</p>
                  <div className="flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(sync.deleteRemote, () => {
                          setConfirmRemote(false);
                          setOpen(false);
                        })
                      }
                      className="rounded border border-loss px-2 py-1 text-xs font-medium text-loss hover:bg-loss hover:text-accentink disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button onClick={() => setConfirmRemote(false)} className={smallButton}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      sync.stop();
                      setOpen(false);
                    }}
                    className={smallButton}
                  >
                    Stop syncing here
                  </button>
                  <button onClick={() => setConfirmRemote(true)} className={smallButton}>
                    Delete from server
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <p className="text-xs">Sync these dashboards to other devices.</p>
                <button
                  disabled={busy}
                  onClick={() => run(sync.enable)}
                  className={`${smallButton} self-start`}
                >
                  Turn on sync
                </button>
              </div>
              <form
                className="flex flex-col gap-1.5 border-t border-line pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => sync.load(input), () => setInput(""));
                }}
              >
                <label htmlFor="sync-code-input" className="text-xs">
                  Have a code?
                </label>
                <p className="text-xs text-muted">
                  Loading replaces this browser&apos;s dashboards with the synced ones.
                </p>
                <div className="flex gap-2">
                  <input
                    id="sync-code-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="XXXXX-XXXXX"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={14}
                    className="h-7 min-w-0 flex-1 rounded border border-line bg-bg px-2 font-mono text-sm uppercase outline-none placeholder:text-muted focus:border-accent"
                  />
                  <button type="submit" disabled={busy || !input.trim()} className={smallButton}>
                    Load
                  </button>
                </div>
              </form>
              {message && <p className="text-xs text-loss">{message}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
