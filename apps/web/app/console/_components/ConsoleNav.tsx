"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../console.module.css";

export type ConsoleNavEntry = { href: string; label: string; exact?: boolean };

/** Console sections: a sideways-scrolling bar on phones, a column on wide screens. */
export function ConsoleNav({ entries, label }: { entries: ConsoleNavEntry[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={styles.scroller}>
      <ul>
        {entries.map((e) => {
          const current = e.exact ? pathname === e.href : pathname === e.href || pathname.startsWith(`${e.href}/`);
          return (
            <li key={e.href}>
              <Link href={e.href} className={styles.link} aria-current={current ? "page" : undefined}>
                {e.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
