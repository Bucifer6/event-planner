"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every few seconds while a deployment is in progress (DEP4: live progress). */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
