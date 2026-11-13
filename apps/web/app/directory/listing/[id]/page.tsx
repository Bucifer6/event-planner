import { actorAccountId } from "@ed/core/context";
import { getDirectoryPrefill, getPublicListing, recordListingView } from "@ed/core/directory";
import { isAppError } from "@ed/shared/errors";
import { formatDate } from "@ed/i18n/format";
import { ExternalLink, Page } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCtx } from "@/lib/ctx";
import { Badges } from "../../_components/Badges";
import styles from "../../directory.module.css";
import { EnquiryCta } from "../../_slots/EnquiryCta";
import { ListingExtras } from "../../_slots/ListingExtras";
import { ListingStatsBlock } from "../../_slots/ListingStatsBlock";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ occasion?: string }> };

const load = cache(async (id: string) => {
  const ctx = await getCtx();
  return { ctx, listing: await getPublicListing(ctx, id) };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { listing } = await load(id);
  if (!listing) return {};
  return { title: listing.name, description: listing.excerpt ?? undefined, alternates: { canonical: `/directory/listing/${listing.id}` } };
}

/**
 * One public listing (P6). Facts only: the name, what it does and where, the description in
 * the language it was written in (L4), photos, the two possible factual badges (P4), the
 * public contact fields and — when publishable — the response statistics (P31).
 * An unclaimed listing (P29) is labelled as added by EventDesk and shows only the contact
 * route its public source states; it has no enquiry button and no uploads.
 */
export default async function ListingPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx, listing } = await load(id);
  if (!listing) notFound();
  const t = await getTranslations("directory");
  await recordListingView(ctx, listing.id); // D4: a daily total per listing, nothing about the visitor

  let occasionId: string | null = null;
  if (sp.occasion && actorAccountId(ctx.actor)) {
    try {
      occasionId = (await getDirectoryPrefill(ctx, sp.occasion)).occasionId;
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }
  const byCounty = listing.counties.map((c) => ({ county: c, places: listing.localities.filter((l) => l.countyCode === c.code) }));
  const reportHref = `/report?ref=${encodeURIComponent(listing.name)}&type=listing&id=${listing.id}`;

  return (
    <Page>
      <nav aria-label={t("crumbs.label")}>
        <ol className={styles.crumbs}>
          <li>
            <Link href={occasionId ? `/directory?occasion=${occasionId}` : "/directory"}>{t("crumbs.directory")}</Link>
          </li>
          <li aria-current="page">{listing.categories[0]?.name ?? t("crumbs.listing")}</li>
        </ol>
      </nav>

      <header className={styles.listingHead}>
        <h1 className={styles.listingName}>{listing.name}</h1>
        {!listing.claimed ? <span className="ed-label">{t("unclaimed.label")}</span> : null}
        <div className={styles.entryMeta}>
          <span className="ed-label">{listing.categories.map((c) => c.name).join(" · ")}</span>
          <span className="ed-label">{listing.counties.map((c) => c.name).join(" · ")}</span>
        </div>
        {listing.badges.length > 0 ? (
          <ul className={styles.facts}>
            <Badges badges={listing.badges} />
          </ul>
        ) : null}
      </header>

      <div className={styles.columns}>
        <div className="ed-stack" data-gap="5">
          <section className="ed-section" aria-labelledby="about">
            <h2 id="about">{t("listing.about")}</h2>
            {listing.description ? (
              <>
                <p className={styles.description} lang={listing.romanianOnly ? "ro" : undefined}>
                  {listing.description}
                </p>
                {listing.romanianOnly ? <span className={styles.note}>{t("romanianOnly")}</span> : null}
              </>
            ) : (
              <p className="ed-unknown">{t("listing.noDescription")}</p>
            )}
          </section>

          {listing.photos.length > 0 ? (
            <section className="ed-section" aria-labelledby="photos">
              <h2 id="photos">{t("listing.photos")}</h2>
              <ul className={styles.photos}>
                {listing.photos.map((p, i) => (
                  <li key={p.assetId}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived same-origin link; not a static asset */}
                    <img src={p.url} alt={t("listing.photoAlt", { name: listing.name, n: i + 1 })} loading="lazy" width={480} height={360} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ListingExtras listing={listing} />
        </div>

        <aside className={styles.aside} aria-label={t("listing.facts")}>
          <EnquiryCta listing={listing} occasionId={occasionId} />

          <div className={styles.asideBlock}>
            <span className="ed-label">{t("listing.contact")}</span>
            {listing.contact ? (
              listing.contact.phone || listing.contact.email || listing.contact.website ? (
                <ul className={styles.contact}>
                  {listing.contact.phone ? (
                    <li>
                      <a href={`tel:${listing.contact.phone.replace(/[^+0-9]/g, "")}`}>{listing.contact.phone}</a>
                    </li>
                  ) : null}
                  {listing.contact.email ? (
                    <li>
                      <a href={`mailto:${listing.contact.email}`}>{listing.contact.email}</a>
                    </li>
                  ) : null}
                  {listing.contact.website ? (
                    <li>
                      <ExternalLink href={listing.contact.website}>{new URL(listing.contact.website).hostname.replace(/^www\./, "")}</ExternalLink>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="ed-unknown">{t("listing.noContact")}</p>
              )
            ) : (
              <>
                <p>{listing.unclaimed?.publicContactRoute ?? <span className="ed-unknown">{t("listing.noContact")}</span>}</p>
                <p className="ed-small ed-muted">{t("unclaimed.contactNote")}</p>
              </>
            )}
          </div>

          <div className={styles.asideBlock}>
            <span className="ed-label">{t("listing.areas")}</span>
            <ul className={styles.contact}>
              {byCounty.map(({ county, places }) => (
                <li key={county.code}>
                  <strong>{county.name}</strong>
                  <span className="ed-small ed-muted">{places.map((p) => p.name).join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>

          <ListingStatsBlock listing={listing} />

          {listing.unclaimed ? (
            <div className={styles.asideBlock}>
              <span className="ed-label">{t("unclaimed.sourceTitle")}</span>
              <p className="ed-small">{t("unclaimed.body")}</p>
              {listing.unclaimed.sourceUrl ? (
                <p className="ed-small">
                  <ExternalLink href={listing.unclaimed.sourceUrl}>{t("unclaimed.source")}</ExternalLink>
                  {listing.unclaimed.collectedAt ? ` · ${t("unclaimed.collected", { date: formatDate(listing.unclaimed.collectedAt, ctx.locale) })}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={styles.asideBlock}>
            <p className="ed-small ed-muted">{t("listing.moderated")}</p>
            <Link href={reportHref} className={styles.report}>
              {t("listing.report")}
            </Link>
          </div>
        </aside>
      </div>
    </Page>
  );
}
