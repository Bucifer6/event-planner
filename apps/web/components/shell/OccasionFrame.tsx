import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Eyebrow } from "@ed/ui";
import { occasionHref, occasionNav } from "@/lib/occasion-nav";
import { SectionRail, SectionTabs, type SectionGroup } from "./NavLinks";

/**
 * Frame for every /occasions/[id]/* page: the masthead (the occasion speaks in Bodoni),
 * scrolling section tabs on phones, a grouped rail on wide screens.
 * `hiddenKeys` lets the caller drop sections the member may not see (e.g. budget without the finance grant).
 */
export async function OccasionFrame({
  occasionId,
  eyebrow,
  title,
  meta,
  hiddenKeys = [],
  banner,
  children,
}: {
  occasionId: string;
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode[];
  hiddenKeys?: string[];
  banner?: ReactNode;
  children: ReactNode;
}) {
  const t = await getTranslations("nav");
  const hidden = new Set(hiddenKeys);
  const groups: SectionGroup[] = occasionNav
    .map((g) => ({
      key: g.key,
      label: t(`occasionGroup.${g.key}`),
      items: g.items
        .filter((it) => !hidden.has(it.key))
        .map((it) => ({ href: occasionHref(occasionId, it.slug), label: t(`occasion.${it.key}`), exact: it.slug === "" })),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <div className="ed-masthead">
        <div className="ed-masthead__inner">
          <Eyebrow>{eyebrow}</Eyebrow>
          <p className="ed-masthead__title" style={{ fontFamily: "var(--font-display)", lineHeight: 1.12, letterSpacing: "-0.02em", margin: 0 }}>
            {title}
          </p>
          {meta && meta.length > 0 ? (
            <div className="ed-masthead__meta">
              {meta.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </div>
          ) : null}
          <SectionTabs groups={groups} label={t("sections")} />
        </div>
      </div>
      {banner}
      <div className="ed-page">
        <div className="ed-withrail">
          <SectionRail groups={groups} label={t("sections")} />
          <div style={{ minWidth: 0 }}>{children}</div>
        </div>
      </div>
    </>
  );
}
