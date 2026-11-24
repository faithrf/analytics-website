"use client";
import { useEffect } from "react";

/** Registers the push worker (public/sw.js). It only handles push and clicks: no caching, so AutoUpdate still sees new deploys. */
export function PushRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
