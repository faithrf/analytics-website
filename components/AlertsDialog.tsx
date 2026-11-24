"use client";
import { useEffect, useState } from "react";
import { DEFAULT_ALERTS, MAX_MOVE, MIN_MOVE, type AlertSettings } from "@/lib/alerts";

type Perm = "unsupported" | NotificationPermission;

const b64ToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function api<T>(url: string, method = "GET", body?: unknown): Promise<{ ok: boolean; data: T & { message?: string } }> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, data: (await r.json().catch(() => ({}))) as T & { message?: string } };
}

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const swReady = () => navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);

/** Compact alerts panel: turn push on for this device, set thresholds, send a test. */
export function AlertsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AlertSettings>(DEFAULT_ALERTS);
  const [devices, setDevices] = useState(0);
  const [configured, setConfigured] = useState(true);
  const [perm, setPerm] = useState<Perm>(() => (pushSupported() ? Notification.permission : "unsupported"));
  const [thisDevice, setThisDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const sub = pushSupported() ? await navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).catch(() => null) : null;
      const r = await api<{ settings: AlertSettings; devices: number; configured: boolean }>("/api/alerts");
      if (!live) return;
      setThisDevice(!!sub);
      if (r.ok) {
        setS(r.data.settings);
        setDevices(r.data.devices);
        setConfigured(r.data.configured);
      } else setMsg(r.data.message ?? "Could not load alerts.");
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = async (next: AlertSettings) => {
    setS(next);
    const r = await api<{ settings: AlertSettings }>("/api/alerts", "PUT", next);
    if (r.ok) setS(r.data.settings);
    else setMsg(r.data.message ?? "Could not save.");
  };

  const turnOn = async () => {
    setBusy(true);
    setMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setPerm(Notification.permission);
        setMsg("Notifications are blocked. Allow them for this site in your browser settings.");
        return;
      }
      const key = await api<{ publicKey: string | null }>("/api/alerts/key");
      if (!key.data.publicKey) {
        setMsg("Push isn't set up on the server yet.");
        return;
      }
      const reg = await swReady();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.data.publicKey) }));
      const r = await api<{ devices: number }>("/api/alerts/subscribe", "POST", { subscription: sub.toJSON() });
      if (!r.ok) {
        setMsg(r.data.message ?? "Could not subscribe.");
        return;
      }
      await save({ ...s, enabled: true });
      setThisDevice(true);
      setDevices(r.data.devices);
      setPerm("granted");
    } catch {
      setMsg("Could not turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMsg("");
    try {
      const sub = await navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription());
      if (sub) {
        await api("/api/alerts/subscribe", "DELETE", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setThisDevice(false);
      if (devices <= 1) await save({ ...s, enabled: false });
      setDevices((d) => Math.max(0, d - 1));
    } catch {
      setMsg("Could not turn off notifications.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const r = await api<{ delivered: number }>("/api/alerts/test", "POST");
    setMsg(r.ok ? (r.data.delivered > 0 ? "Test sent." : "Sent, but no device accepted it.") : (r.data.message ?? "Test failed."));
    setBusy(false);
  };

  const num = "w-16 rounded-md border border-line bg-panel2 px-2 py-1 text-right text-sm";
  const btn = "rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-sm p-0 sm:items-start sm:justify-end sm:p-3 sm:pt-14" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Alerts"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-line bg-panel p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg sm:rounded-lg sm:pb-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Alerts</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-md text-muted hover:text-accent">
            ✕
          </button>
        </div>
        {!loaded ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted">Get a push notification when a stock on your boards or in an open trade moves a lot during market hours.</p>
            {perm === "unsupported" ? (
              <p className="text-xs text-loss">This browser can&apos;t do push. On iPhone, add Meridian to the Home Screen first.</p>
            ) : !configured ? (
              <p className="text-xs text-loss">Push isn&apos;t set up on the server yet.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {thisDevice && perm === "granted" ? (
                  <button className={btn} disabled={busy} onClick={() => void turnOff()}>
                    Turn off on this device
                  </button>
                ) : (
                  <button className="rounded-md bg-accent px-2.5 py-1.5 text-sm font-semibold text-accentink disabled:opacity-50" disabled={busy || perm === "denied"} onClick={() => void turnOn()}>
                    Enable notifications
                  </button>
                )}
                {thisDevice && (
                  <button className={btn} disabled={busy} onClick={() => void test()}>
                    Send test
                  </button>
                )}
                <span className="text-xs text-muted">{devices} device{devices === 1 ? "" : "s"}</span>
              </div>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <label className="flex items-center justify-between gap-2">
                <span>Alert at a move of</span>
                <span className="flex items-center gap-1">
                  <input type="number" min={MIN_MOVE} max={MAX_MOVE} step={0.5} className={num} value={s.movePct} onChange={(e) => setS({ ...s, movePct: Number(e.target.value) })} onBlur={() => void save(s)} />%
                </span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>Alert again at</span>
                <span className="flex items-center gap-1">
                  <input type="number" min={MIN_MOVE} max={MAX_MOVE} step={0.5} className={num} value={s.bigMovePct} onChange={(e) => setS({ ...s, bigMovePct: Number(e.target.value) })} onBlur={() => void save(s)} />%
                </span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>52-week high / low</span>
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={s.hiLo} onChange={(e) => void save({ ...s, hiLo: e.target.checked })} />
              </label>
            </div>
            {msg && (
              <p role="status" className="text-xs text-muted">
                {msg}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
