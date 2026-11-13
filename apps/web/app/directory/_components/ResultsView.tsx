import type { DirectoryCard, DirectoryResults, FeaturedCard } from "@ed/core/directory";
import type { CategoryView, CountyView, LocalityView } from "@ed/core/geography";
import { buttonClassName, EmptyState, Fact, Page, PaidLabel } from "@ed/ui";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { plural } from "@/app/(app)/occasions/_lib/plural";
import { directoryHref, listingHref, statsInWords } from "../_lib";
import styles from "../directory.module.css";
import { Badges } from "./Badges";

const MAX_PLACES = 3;

/** One organic entry: the name in Bodoni, facts as small tracked labels, nothing that sells. */
async function Entry({ card, occasionId }: { card: DirectoryCard; occasionId: string | null }) {
  const t = await getTranslations("directory");
  const locale = await getLocale();
  const places = card.localities.slice(0, MAX_PLACES).map((l) => l.name);
  const more = card.localities.length - places.length;
  const words = card.stats ? statsInWords((k, p) => t(k as never, p as never), card.stats, locale) : null;
  return (
    <li className={styles.entry}>
      <h2 className={styles.entryName}>
        <Link href={`${listingHref(card.id)}${occasionId ? `?occasion=${occasionId}` : ""}`}>{card.name}</Link>
      </h2>
      {!card.claimed ? <span className="ed-label">{t("unclaimed.label")}</span> : null}
      <div className={styles.entryMeta}>
        <span className="ed-label">{card.categories.map((c) => c.name).join(" · ")}</span>
        <span className="ed-label">
          {places.join(" · ")}
          {more > 0 ? ` · ${t("results.morePlaces", { count: more })}` : ""}
        </span>
      </div>
      {card.excerpt ? <p className={styles.entryText}>{card.excerpt}</p> : null}
      {card.romanianOnly ? <span className={styles.note}>{t("romanianOnly")}</span> : null}
      {card.badges.length > 0 || words ? (
        <ul className={styles.facts}>
          <Badges badges={card.badges} />
          {words ? (
            <li>
              <Fact>
                {words.answered}
                {words.reply ? ` · ${words.reply}` : ""}
              </Fact>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * RELEASE P (P13, P14): one Featured card. The label "Promovat — plasare plătită" is set with
 * <PaidLabel> in the SAME size and weight as the business name beside it (design gate, PRD
 * §21): the label line and the name share one class. The card itself is deliberately
 * quieter than an organic entry — no excerpt, no facts — so nothing competes with the label.
 */
async function FeaturedEntry({ card, occasionId }: { card: FeaturedCard; occasionId: string | null }) {
  const t = await getTranslations();
  const places = card.localities.slice(0, MAX_PLACES).map((l) => l.name);
  return (
    <li className={styles.featuredEntry}>
      <p className={styles.featuredLine}>
        <PaidLabel>{t(card.labelKey)}</PaidLabel>
      </p>
      <h2 className={styles.featuredLine}>
        <Link href={`${listingHref(card.id)}${occasionId ? `?occasion=${occasionId}` : ""}`}>{card.name}</Link>
      </h2>
      <div className={styles.entryMeta}>
        <span className="ed-label">{card.categories.map((c) => c.name).join(" · ")}</span>
        <span className="ed-label">{places.join(" · ")}</span>
      </div>
    </li>
  );
}

/** Shared by the county page and the locality page (P6). */
export async function ResultsView({
  category,
  county,
  locality,
  localityPages,
  results,
  otherCounties,
  occasionId,
}: {
  category: CategoryView;
  county: CountyView;
  locality: LocalityView | null;
  /** Localities of this county that have their own page. */
  localityPages: LocalityView[];
  results: DirectoryResults;
  otherCounties: CountyView[];
  occasionId: string | null;
}) {
  const t = await getTranslations("directory");
  const tf = await getTranslations("featured"); // Release P (P13)
  const locale = await getLocale();
  const area = locality ? `${locality.name}, ${county.name}` : county.name;
  return (
    <Page>
      <nav aria-label={t("crumbs.label")}>
        <ol className={styles.crumbs}>
          <li>
            <Link href={occasionId ? `/directory?occasion=${occasionId}` : "/directory"}>{t("crumbs.directory")}</Link>
          </li>
          <li>
            <Link href={directoryHref(category.slug, county.slug, null, occasionId)}>{county.name}</Link>
          </li>
          {locality ? <li aria-current="page">{locality.name}</li> : null}
        </ol>
      </nav>
      <header className="ed-pagehead">
        <div className="ed-pagehead__row">
          <h1>{t("results.title", { category: category.name, area })}</h1>
        </div>
        <p className="ed-pagehead__desc">{t(`results.count.${plural(results.total, locale, { zero: true })}`, { count: results.total })}</p>
      </header>

      {localityPages.length > 0 ? (
        <nav aria-label={t("results.localities")}>
          <ul className={styles.chips}>
            <li>
              <Link className="ed-chip" href={directoryHref(category.slug, county.slug, null, occasionId)} aria-current={locality ? undefined : "page"}>
                {t("results.wholeCounty")}
              </Link>
            </li>
            {localityPages.map((l) => (
              <li key={l.id}>
                <Link className="ed-chip" href={directoryHref(category.slug, county.slug, l.slug, occasionId)} aria-current={locality?.id === l.id ? "page" : undefined}>
                  {l.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <section className="ed-section" aria-label={t("results.listLabel")}>
        {/* MON5 / P13: `results.featured` is [] while monetization is off — then nothing at all is
            rendered here. When it is on: up to three labelled cards ABOVE the organic list, which
            itself is exactly what it would be without them. */}
        {results.featured.length > 0 ? (
          <ol className={styles.featured} aria-label={tf("sectionLabel")}>
            {results.featured.map((card) => (
              <FeaturedEntry key={card.id} card={card} occasionId={occasionId} />
            ))}
          </ol>
        ) : null}
        {results.organic.length === 0 ? (
          <EmptyState
            title={t("results.emptyTitle")}
            action={
              <Link href="/business" className={buttonClassName({ variant: "secondary" })}>
                {t("results.emptyAction")}
              </Link>
            }
          >
            {t("results.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <div className={styles.rotation}>
              <span className="ed-label">{t("results.rotation")}</span>
            </div>
            <ol className={styles.results}>
              {results.organic.map((card) => (
                <Entry key={card.id} card={card} occasionId={occasionId} />
              ))}
            </ol>
            {results.total > results.organic.length ? <p className="ed-small ed-muted">{t("results.truncated", { shown: results.organic.length, total: results.total })}</p> : null}
          </>
        )}
      </section>

      {otherCounties.length > 0 ? (
        <section className="ed-section" aria-label={t("results.elsewhere", { category: category.name })}>
          <span className="ed-label">{t("results.elsewhere", { category: category.name })}</span>
          <ul className={styles.chips}>
            {otherCounties.map((c) => (
              <li key={c.code}>
                <Link className="ed-chip" href={directoryHref(category.slug, c.slug, null, occasionId)}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}
