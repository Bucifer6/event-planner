"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (offline shell). An effect in a client component — no inline script, so
 * the strict CSP holds. Not registered in development, where a service worker caching build
 * files gets in the way of hot reload.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Offline support is a nicety; the app works without it.
    });
  }, []);
  return null;
}
