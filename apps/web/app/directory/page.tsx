import { actorAccountId } from "@ed/core/context";
import { getDirectoryIndex, getDirectoryPrefill, type DirectoryPrefill } from "@ed/core/directory";
import { getCategoryBySlug, getCounty, getLocalityBySlug, listLocalities } from "@ed/core/geography";
import { isAppError } from "@ed/shared/errors";
import { Notice, Page, PageHeader, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { SearchForm } from "./_components/SearchForm";
import { directoryHref } from "./_lib";
import styles from "./directory.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory");
  return { title: t("meta.title"), description: t("meta.description") };
}

type Search = { category?: string; county?: string; locality?: string; occasion?: string };

/**
 * P6: the directory index — the search (three picklists) and the register of categories ×
 * launch counties. Public. Opened from an occasion (?occasion=<id>, members only) it starts
 * from that occasion: suggested categories first, the venue's county chosen when it is known.
 */
export default async function DirectoryIndexPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("directory");
  const index = await getDirectoryIndex(ctx);

  let prefill: DirectoryPrefill | null = null;
  if (sp.occasion && actorAccountId(ctx.actor)) {
    try {
      prefill = await getDirectoryPrefill(ctx, sp.occasion);
    } catch (e) {
      if (!isAppError(e)) throw e; // not a member, or no such occasion: the plain index
    }
  }
  const occasionId = prefill?.occasionId ?? null;

  // The search form submits here: both picklists chosen → the results page.
  const errors: { category?: string; county?: string } = {};
  const submitted = sp.category !== undefined || sp.county !== undefined;
  const category = sp.category ? await getCategoryBySlug(ctx, sp.category) : null;
  const county = sp.county ? await getCounty(ctx, sp.county) : null;
  if (category && county && category.active && category.published && county.active && county.published) {
    const locality = sp.locality ? await getLocalityBySlug(ctx, county.code, sp.locality) : null;
    redirect(directoryHref(category.slug, county.slug, locality?.active && locality.publicPage ? locality.slug : null, occasionId));
  }
  if (submitted && sp.county !== undefined && !category) errors.category = t("search.categoryRequired");
  if (submitted && sp.category !== undefined && !county) errors.county = t("search.countyRequired");

  const prefillCounty = prefill?.countyCode ? [...index.launchCounties, ...index.otherCounties].find((c) => c.code === prefill!.countyCode) : undefined;
  const pages = (await listLocalities(ctx)).filter((l) => l.publicPage);
  const bySlug = new Map([...index.launchCounties, ...index.otherCounties].map((c) => [c.code, c.slug]));
  const prefillLocality = prefill?.localityId ? pages.find((l) => l.id === prefill!.localityId) : undefined;
  // Register columns: the occasion's county first (when known), then the launch areas.
  const columns = [...(prefillCounty && !prefillCounty.launchArea ? [prefillCounty] : []), ...index.launchCounties];
  const suggested = prefill?.suggestedCategorySlugs ?? [];
  const ordered = [
    ...suggested.map((slug) => index.categories.find((c) => c.slug === slug)).filter((c) => c !== undefined),
    ...index.categories.filter((c) => !suggested.includes(c.slug)),
  ];

  return (
    <Page>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      {prefill ? (
        <Notice title={t("prefill.title", { occasion: prefill.occasionTitle })}>
          {prefillCounty ? t("prefill.withArea", { area: prefillCounty.name }) : t("prefill.noArea")}{" "}
          <Link href={`/occasions/${prefill.occasionId}`}>{t("prefill.back")}</Link>
        </Notice>
      ) : null}

      <Section title={t("search.title")} id="cautare">
        <SearchForm
          categories={index.categories.map((c) => ({ slug: c.slug, name: c.name }))}
          suggested={suggested}
          launchCounties={index.launchCounties.map((c) => ({ slug: c.slug, name: c.name }))}
          otherCounties={index.otherCounties.map((c) => ({ slug: c.slug, name: c.name }))}
          localities={pages.map((l) => ({ slug: l.slug, name: l.name, countySlug: bySlug.get(l.countyCode) ?? "" }))}
          defaults={{
            category: category?.slug ?? sp.category,
            county: county?.slug ?? prefillCounty?.slug,
            locality: prefillLocality?.slug,
          }}
          occasionId={occasionId}
          errors={errors}
          labels={{
            category: t("search.category"),
            county: t("search.county"),
            locality: t("search.locality"),
            choose: t("search.choose"),
            wholeCounty: t("search.wholeCounty"),
            optional: t("search.optional"),
            submit: t("search.submit"),
            launchGroup: t("search.launchGroup"),
            otherGroup: t("search.otherGroup"),
            suggestedGroup: t("search.suggestedGroup"),
            allGroup: t("search.allGroup"),
          }}
        />
      </Section>

      <Section title={t("register.title")} eyebrow={prefill ? t("register.suggestedFirst") : undefined}>
        <ol className={styles.register}>
          {ordered.map((c, i) => (
            <li key={c.id} className={styles.registerRow}>
              <span className={styles.registerIndex} aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={styles.registerName}>{c.name}</span>
              <ul className={styles.registerLinks} aria-label={t("register.inCounties", { category: c.name })}>
                {columns.map((co) => (
                  <li key={co.code}>
                    <Link href={directoryHref(c.slug, co.slug, null, occasionId)} aria-label={t("results.title", { category: c.name, area: co.name })}>
                      {co.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t("counties.title")}>
        <p className="ed-muted">{t("counties.body")}</p>
        <details>
          <summary className={styles.summary}>{t("counties.show", { count: index.otherCounties.length })}</summary>
          <ul className={styles.counties}>
            {index.otherCounties.map((c) => (
              <li key={c.code}>
                <Link href={`/directory?county=${c.slug}${occasionId ? `&occasion=${occasionId}` : ""}#cautare`}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </details>
      </Section>
    </Page>
  );
}
