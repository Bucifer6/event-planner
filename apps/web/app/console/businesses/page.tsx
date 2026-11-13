import { listBusinessesForConsole } from "@ed/core/business";
import { listListingsForConsole } from "@ed/core/listings";
import { formatDate, formatInteger } from "@ed/i18n/format";
import { Button, buttonClassName, EmptyState, Page, PageHeader, Section, Table, Tag, TextField } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NoRole } from "../_components/NoRole";
import { requireConsole } from "../_lib";
import styles from "../console.module.css";
import pageStyles from "../moderation/moderation.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("moderation"))("businesses.title") };
}

const TABS = ["all", "restricted", "suspended"] as const;
const tone = (s: string) => (s === "active" ? "success" : "danger");

/** W3: businesses, with their status. Restricting or suspending happens on the business's page. */
export default async function ConsoleBusinessesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("moderation");
  const b = await getTranslations("business");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("businesses.title")} roles={["listing_moderator", "platform_admin"]} />;
  const sp = await searchParams;
  const status = (TABS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof TABS)[number]) : "all";
  const q = (sp.q ?? "").slice(0, 80);
  const [rows, unclaimed] = await Promise.all([listBusinessesForConsole(ctx, { status, q }), listListingsForConsole(ctx, { filter: "unclaimed" })]);

  return (
    <Page>
      <PageHeader title={t("businesses.title")} description={t("businesses.description")} />
      <nav aria-label={t("businesses.filterLabel")}>
        <ul className="ed-tabs">
          {TABS.map((tab) => (
            <li key={tab}>
              <Link className="ed-tab" href={tab === "all" ? "/console/businesses" : `/console/businesses?status=${tab}`} aria-current={tab === status ? "page" : undefined}>
                {t(`businesses.tabs.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form method="get" action="/console/businesses" className={styles.filterForm}>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <div className={styles.filters}>
          <TextField id="biz-q" name="q" label={t("businesses.search")} defaultValue={q} maxLength={80} />
        </div>
        <div>
          <Button type="submit">{t("businesses.searchSubmit")}</Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t("businesses.empty")} />
      ) : (
        <section className={`ed-section ${pageStyles.rel}`}>
        <Table caption={t("businesses.title")}>
          <thead>
            <tr>
              <th scope="col">{t("businesses.name")}</th>
              <th scope="col">{t("businesses.status")}</th>
              <th scope="col" data-num>
                {t("businesses.listings")}
              </th>
              <th scope="col">{t("businesses.since")}</th>
              <th scope="col" aria-label={t("open")} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ business, listings, liveListings }) => (
              <tr key={business.id}>
                <td className={pageStyles.subject}>
                  <strong>{business.name}</strong>
                </td>
                <td>
                  <Tag tone={tone(business.status)}>{b(`status.${business.status}`)}</Tag>
                </td>
                <td className="ed-num">{t("businesses.listingsValue", { live: formatInteger(liveListings, ctx.locale), total: formatInteger(listings, ctx.locale) })}</td>
                <td className="ed-num">{formatDate(business.createdAt, ctx.locale)}</td>
                <td>
                  <Link href={`/console/businesses/${business.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("openNamed", { title: business.name })}>
                    {t("open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        </section>
      )}

      <Section title={t("businesses.unclaimedTitle")}>
        <p className="ed-muted">{t("businesses.unclaimedBody")}</p>
        {unclaimed.length === 0 ? (
          <EmptyState title={t("businesses.unclaimedEmpty")} />
        ) : (
          <Table caption={t("businesses.unclaimedTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("businesses.name")}</th>
                <th scope="col">{t("businesses.status")}</th>
                <th scope="col" aria-label={t("open")} />
              </tr>
            </thead>
            <tbody>
              {unclaimed.map((l) => (
                <tr key={l.id}>
                  <td className={pageStyles.subject}>{l.name}</td>
                  <td>
                    <Tag tone={l.status === "live" ? "success" : l.status === "suspended" ? "danger" : "attention"}>{t(`listingStatus.${l.status}`)}</Tag>
                  </td>
                  <td>
                    <Link href={`/console/businesses/listing-${l.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("openNamed", { title: l.name })}>
                      {t("open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
