"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the day from the server every `seconds` while the tab is visible, and at once when
 * it becomes visible again. router.refresh() swaps server-rendered data in place: no reload,
 * no scroll change, open sheets and typed input stay.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      // do not pull the page from under someone filling a sheet
      if (document.querySelector("dialog[open]")) return;
      router.refresh();
    };
    const id = window.setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, seconds]);
  return null;
}
