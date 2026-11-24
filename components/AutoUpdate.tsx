"use client";
import { useEffect } from "react";

const MINE = process.env.NEXT_PUBLIC_BUILD_ID;

/**
 * A home-screen app can sit in memory for days. When it comes back to the
 * foreground (or every 15 minutes while open), ask the server which deploy is
 * live and reload once if it is newer than the code on screen.
 */
export function AutoUpdate() {
  useEffect(() => {
    if (!MINE || MINE === "local") return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await r.json()) as { build?: string };
        if (!build || build === MINE) return;
        // Guard against a reload loop if the CDN briefly serves mixed versions.
        if (sessionStorage.getItem("meridian-reloaded-for") === build) return;
        sessionStorage.setItem("meridian-reloaded-for", build);
        location.reload();
      } catch {
        /* offline or storage blocked: try again next time */
      } finally {
        busy = false;
      }
    };
    document.addEventListener("visibilitychange", check);
    const t = setInterval(check, 15 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      clearInterval(t);
    };
  }, []);
  return null;
}
