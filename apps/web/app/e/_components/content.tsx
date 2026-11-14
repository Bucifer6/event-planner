import type { Locale } from "@ed/core/context";
import type { PublishedJourney } from "@ed/core/guestevent";
import { MENU_COURSES, type MenuView } from "@ed/core/menus";
import type { GuestProgrammeItem } from "@ed/core/programme";
import { ExternalLink, Tag, Unknown } from "@ed/ui";
import type { ReactNode } from "react";
import { guestTranslator } from "@/lib/guest";
import styles from "./event.module.css";

// Server-rendered, read-only pieces of the guest event page (C-10, Q3): the programme, the
// menu card, the venue with its navigation link and the accessible journey. Used by both
// doors — the public page /e/<slug> and the sections of the guest link /g/<token> — so the
// two always read the same. No client code here.

export function EventBlock({ title, intro, children, id }: { title: string; intro?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className={styles.block} id={id}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {intro ? <p className="ed-muted">{intro}</p> : null}
      {children}
    </section>
  );
}

export function ProgrammeList({ items, locale }: { items: GuestProgrammeItem[]; locale: Locale }) {
  const t = guestTranslator(locale, "programme.guest");
  let lastDay = 0;
  const rows: ReactNode[] = [];
  for (const i of items) {
    if (i.dayOffset > lastDay) {
      rows.push(
        <li className={styles.dayMark} key={`day-${i.dayOffset}`}>
          {t("nextDay")}
        </li>,
      );
      lastDay = i.dayOffset;
    }
    const meta = [i.place, i.durationMin !== null ? t("minutes", { n: i.durationMin }) : null].filter(Boolean).join(" · ");
    rows.push(
      <li className={styles.moment} key={i.id}>
        <span className={styles.time} aria-label={t("timeLabel", { time: i.time })}>
          {i.time}
        </span>
        <div className={styles.momentBody}>
          <span className={styles.momentTitle}>{i.title}</span>
          {meta ? <span className={styles.momentMeta}>{meta}</span> : null}
          {i.changed ? (
            <span>
              <Tag tone="accent">{t("changed")}</Tag>
            </span>
          ) : null}
        </div>
      </li>,
    );
  }
  return <ol className={styles.timeline}>{rows}</ol>;
}

/** The menu as a printed card: courses in order, options of a choice joined by "sau". */
export function MenuCard({ menus, locale }: { menus: MenuView[]; locale: Locale }) {
  const t = guestTranslator(locale, "menus");
  const or = t("guest.or");
  return (
    <>
      {menus.map((m) => (
        <div className={styles.menu} key={m.id}>
          {menus.length > 1 ? <p className={styles.menuName}>{m.name}</p> : null}
          {MENU_COURSES.filter((c) => m.items.some((i) => i.course === c)).map((course) => {
            const dishes = m.items.filter((i) => i.course === course);
            return (
              <div className={styles.course} key={course}>
                <h3 className={styles.sub}>{t(`courses.${course}`)}</h3>
                {dishes.map((d, n) => {
                  const prev = dishes[n - 1];
                  const alternative = !!prev && d.isChoice && prev.isChoice && prev.audience === d.audience;
                  return (
                    <div className={styles.dish} key={d.id}>
                      {alternative ? <span className={styles.or}>{or}</span> : null}
                      <span className={styles.dishName}>{d.name}</span>
                      {d.description ? <span className={styles.dishDesc}>{d.description}</span> : null}
                      {d.dietTags.length > 0 || d.audience === "children" ? (
                        <span className={styles.dishTags}>
                          {[d.audience === "children" ? t("item.childrenTag") : null, ...d.dietTags.map((tag) => t(`diet.${tag}`))].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Address + the external navigation link (SEC7: ExternalLink adds rel="noopener noreferrer"). */
export function VenueLines({ name, address, href, locale }: { name: string | null; address: string | null; href: string | null; locale: Locale }) {
  const t = guestTranslator(locale, "guestevent.venue");
  return (
    <p className={styles.venueLine}>
      {name ? <strong>{name}</strong> : null}
      {name && address ? <br /> : null}
      {address}
      {href ? (
        <>
          <br />
          <ExternalLink href={href}>{t("navigate")}</ExternalLink>
        </>
      ) : null}
    </p>
  );
}

/** Each fact known or unknown; "necunoscut" is shown, never hidden (C-07). */
export function JourneyFacts({ journey, locale }: { journey: PublishedJourney; locale: Locale }) {
  const t = guestTranslator(locale, "guestevent.journey");
  return (
    <>
      <ul className={styles.facts}>
        {journey.facts.map((f) => (
          <li className={styles.fact} key={f.key}>
            <div className={styles.factLine}>
              <span>{t(`facts.${f.key}`)}</span>
              <span className={styles.factState}>{f.state === "unknown" ? <Unknown label={t("states.unknown")} /> : t(`states.${f.state}`)}</span>
            </div>
            {f.note[locale] ? <span className={styles.factNote}>{f.note[locale]}</span> : null}
          </li>
        ))}
      </ul>
      {journey.contact ? (
        <p className="ed-small">
          <span className="ed-label">{t("contact")}</span>
          <br />
          {[journey.contact.name, journey.contact.route].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </>
  );
}
