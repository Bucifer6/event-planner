import Link from "next/link";
import styles from "./travel.module.css";

export type TabItem = { key: string; href: string; label: string };

/** Section tabs (plain links: each tab is its own page, reachable by keyboard and deep link). */
export function Tabs({ items, current, label }: { items: TabItem[]; current: string; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export const TRAVEL_TABS = ["hub", "itinerary", "groups", "packing", "transport", "rooms", "settlement"] as const;
export function travelTabs(occasionId: string, t: (key: string) => string): TabItem[] {
  return TRAVEL_TABS.map((key) => ({ key, href: key === "hub" ? `/occasions/${occasionId}/travel` : `/occasions/${occasionId}/travel/${key}`, label: t(`tabs.${key}`) }));
}

export const ZONE_LIST_ID = "ed-time-zones";
/** One datalist per page with every IANA zone (curated ones first): the search behind the zone fields. */
export function ZoneList({ zones }: { zones: string[] }) {
  return (
    <datalist id={ZONE_LIST_ID}>
      {zones.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}
