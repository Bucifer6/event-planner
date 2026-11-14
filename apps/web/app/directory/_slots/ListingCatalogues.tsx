import { listPublicCatalogues, type PublicCatalogueItem } from "@ed/core/catalogues";
import type { PublicListing } from "@ed/core/directory";
import { formatMoney } from "@ed/i18n/format";
import { Section, Unknown } from "@ed/ui";
import { IconFlower, IconLeaf } from "@ed/ui/icons";
import { getLocale, getTranslations } from "next-intl/server";
import { getCtx } from "@/lib/ctx";
import styles from "./slots.module.css";

/**
 * Approved flower catalogues of a listing (F1, F2). Facts as the business published them and
 * a moderator checked them: variety, picture, season, colours, and prices that are always
 * labelled "preț orientativ" — an unknown price says "necunoscut", never zero, never a guess.
 * Renders nothing for a listing without a live catalogue.
 */
export async function ListingCatalogues({ listing }: { listing: PublicListing }) {
  if (!listing.claimed) return null;
  const ctx = await getCtx();
  const catalogues = await listPublicCatalogues(ctx, { listingId: listing.id });
  if (catalogues.length === 0) return null;
  const t = await getTranslations("catalogues");
  const locale = (await getLocale()) as "ro" | "en";

  const season = (months: number[]) => {
    if (months.length === 0) return <Unknown label={t("public.seasonUnknown")} />;
    if (months.length === 12) return t("public.allYear");
    return months.map((m) => t(`months.${m}` as never)).join(", ");
  };
  const price = (item: PublicCatalogueItem) => {
    const parts = [
      item.pricePerStemMinor !== null ? t("public.perStem", { price: formatMoney(item.pricePerStemMinor, item.currency, locale) }) : null,
      item.pricePerBunchMinor !== null ? t("public.perBunch", { price: formatMoney(item.pricePerBunchMinor, item.currency, locale) }) : null,
    ].filter(Boolean);
    return parts.length ? <span className="ed-num">{parts.join(" · ")}</span> : <Unknown label={t("public.priceUnknown")} />;
  };

  return (
    <Section title={t("public.title")}>
      <p className="ed-muted">{t("public.lead")}</p>
      {catalogues.map((c) => (
        <div key={c.id} className={styles.catalogue}>
          <div className={styles.catalogueHead}>
            <h3 className={styles.catalogueName}>{c.name}</h3>
            <span className="ed-label">{t("public.count", { count: c.items.length })}</span>
          </div>
          <ul className={styles.varieties}>
            {c.items.map((item) => (
              <li key={item.id} className={styles.variety}>
                {item.imageUrl ? (
                  // signed, short-lived same-origin link; not a static asset
                  <img className={styles.varietyImage} src={item.imageUrl} alt={t("public.imageAlt", { name: item.varietyName })} loading="lazy" width={96} height={96} />
                ) : (
                  <span className={styles.varietyNoImage} role="img" aria-label={t("public.noImage")}>
                    {item.kind === "foliage" ? <IconLeaf size={24} /> : <IconFlower size={24} />}
                  </span>
                )}
                <div className={styles.varietyMain}>
                  <span className={styles.varietyName}>{item.varietyName}</span>
                  <span className="ed-label">{t(`item.kinds.${item.kind}`)}</span>
                  <dl className={styles.varietyFacts}>
                    <div>
                      <dt>{t("public.indicative")}</dt>
                      <dd>{price(item)}</dd>
                    </div>
                    <div>
                      <dt>{t("public.season")}</dt>
                      <dd>{season(item.seasonMonths)}</dd>
                    </div>
                    <div>
                      <dt>{t("public.colours")}</dt>
                      <dd>{item.colours.length ? item.colours.map((col) => t(`colours.${col}`)).join(", ") : <Unknown label={t("public.coloursUnknown")} />}</dd>
                    </div>
                  </dl>
                  {item.notes ? <p className={styles.varietyNotes}>{item.notes}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}
