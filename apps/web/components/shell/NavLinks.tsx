"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type NavEntry = { href: string; label: string; icon?: ReactNode; exact?: boolean };

function isCurrent(pathname: string, e: NavEntry): boolean {
  if (e.exact) return pathname === e.href;
  return pathname === e.href || pathname.startsWith(`${e.href}/`);
}

/** Desktop: text links in the top bar. */
export function TopNav({ entries, label }: { entries: NavEntry[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="ed-topnav">
        {entries.map((e) => (
          <li key={e.href}>
            <Link className="ed-navlink" href={e.href} aria-current={isCurrent(pathname, e) ? "page" : undefined}>
              {e.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Phones: the same destinations fixed at the bottom, in thumb reach. */
export function BottomNav({ entries, label }: { entries: NavEntry[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="ed-bottomnav" aria-label={label}>
      {entries.map((e) => (
        <Link key={e.href} href={e.href} aria-current={isCurrent(pathname, e) ? "page" : undefined}>
          {e.icon}
          <span>{e.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export type SectionGroup = { key: string; label: string; items: Array<{ href: string; label: string; exact?: boolean }> };

/** Occasion sections: scrolling tabs under the masthead on phones/tablets. */
export function SectionTabs({ groups, label }: { groups: SectionGroup[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="ed-tabs" data-collapses>
        {groups.flatMap((g) =>
          g.items.map((it) => (
            <li key={it.href}>
              <Link className="ed-tab" href={it.href} aria-current={isCurrent(pathname, it) ? "page" : undefined}>
                {it.label}
              </Link>
            </li>
          )),
        )}
      </ul>
    </nav>
  );
}

/** Occasion sections: grouped rail beside the content on wide screens. */
export function SectionRail({ groups, label }: { groups: SectionGroup[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="ed-rail" aria-label={label}>
      {groups.map((g) => (
        <div className="ed-rail__group" key={g.key}>
          <span className="ed-rail__label">{g.label}</span>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} aria-current={isCurrent(pathname, it) ? "page" : undefined}>
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
