"use client";

import { useEffect, useState } from "react";
import styles from "./day.module.css";

function parts(now: Date, timeZone: string): { hm: string; s: string } {
  const f = new Intl.DateTimeFormat("ro-RO", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { hm: `${p.hour}:${p.minute}`, s: p.second ?? "00" };
}

/** The big clock of the day view: local time of the occasion (Europe/Bucharest), ticking. */
export function DayClock({ timeZone, initial, label }: { timeZone: string; initial: string; label: string }) {
  // the server-rendered minute is shown until the first tick, so nothing jumps on load
  const [now, setNow] = useState<{ hm: string; s: string }>({ hm: initial, s: "" });
  useEffect(() => {
    const tick = () => setNow(parts(new Date(), timeZone));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timeZone]);
  return (
    <time className={`ed-clock ${styles.clock}`} aria-label={`${label} ${now.hm}`} suppressHydrationWarning>
      <span aria-hidden>{now.hm}</span>
      <span className={styles.seconds} aria-hidden>
        {now.s}
      </span>
    </time>
  );
}
