import type { PublicListing } from "@ed/core/directory";
import { getListingSpaces } from "@ed/core/drawings";
import { itemSizeText, mmToMetresText } from "@ed/core/spacemodel";
import { formatDate } from "@ed/i18n/format";
import { Section, Table, Unknown } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import { PlanView } from "@/components/plan/PlanView";
import plan from "@/components/plan/plan.module.css";
import { getCtx } from "@/lib/ctx";
import { ParkingFacts } from "./ParkingFacts";

/**
 * SLOT — the approved spaces of a venue listing (P-06, V3): a read-only plan to scale, the
 * stated dimensions (or "necunoscut"), the table inventory and the parking facts (V10).
 * Only approved versions are ever shown; a drawing that is not calibrated is a picture, with
 * that said in words (V7).
 */
export async function ListingDrawings({ listing }: { listing: PublicListing }) {
  const ctx = await getCtx();
  const { spaces, parking } = await getListingSpaces(ctx, listing.id);
  if (spaces.length === 0 && !parking) return null;
  const t = await getTranslations("drawings");
  const tc = await getTranslations("common");
  const unknown = <Unknown label={tc("unknown")} />;
  const m = (mm: number | null) => (mm === null ? unknown : `${mmToMetresText(mm, ctx.locale)} m`);

  return (
    <>
      {spaces.length > 0 ? (
        <Section title={t("public.title")} level={2}>
          <div>
            {spaces.map((s) => {
              const fixtures = s.model.items.filter((i) => i.kind === "fixture");
              return (
                <article className={plan.spaceCard} key={s.spaceId}>
                  <div className={plan.spaceHead}>
                    <h3>{s.name}</h3>
                    <span className="ed-small ed-muted">{t("public.version", { n: s.versionNo, date: formatDate(s.effectiveAt, ctx.locale) })}</span>
                  </div>
                  <p>
                    {t("public.stated")}: {m(s.widthMm)} × {m(s.lengthMm)}
                  </p>
                  {s.calibrated ? (
                    <PlanView
                      model={s.model}
                      label={t("plan.label", { name: s.name })}
                      pictureUrl={s.pictureUrl}
                      title={{ name: s.name, meta: `v${s.versionNo} · ${formatDate(s.effectiveAt, ctx.locale)}` }}
                      poiLabels={s.model.pois.map((p) => p.name ?? t(`poiKinds.${p.kind}`))}
                    />
                  ) : (
                    <>
                      {s.pictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media link
                        <img className={plan.picture} src={s.pictureUrl} alt={t("public.pictureAlt", { name: s.name })} loading="lazy" />
                      ) : null}
                      <p className="ed-unknown">{t("public.notCalibrated")}</p>
                    </>
                  )}
                  {s.model.tableTypes.length > 0 ? (
                    <Table caption={t("public.tablesCaption", { name: s.name })}>
                      <thead>
                        <tr>
                          <th scope="col">{t("public.cols.type")}</th>
                          <th scope="col">{t("public.cols.size")}</th>
                          <th scope="col" className="ed-right">
                            {t("public.cols.seats")}
                          </th>
                          <th scope="col" className="ed-right">
                            {t("public.cols.count")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.model.tableTypes.map((x) => (
                          <tr key={x.id}>
                            <th scope="row">{x.name}</th>
                            <td>{itemSizeText(x, ctx.locale) ?? unknown}</td>
                            <td className="ed-right ed-num">{x.seats ?? unknown}</td>
                            <td className="ed-right ed-num">{x.count ?? unknown}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : null}
                  {fixtures.length > 0 ? (
                    <p className="ed-small">
                      {t("public.fixtures")}:{" "}
                      {fixtures.map((f, i) => (
                        <span key={f.id}>
                          {i > 0 ? "; " : ""}
                          {f.name} ({itemSizeText(f, ctx.locale) ?? unknown})
                        </span>
                      ))}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Section>
      ) : null}
      {parking ? (
        <Section title={t("parking.publicTitle")} level={2}>
          <ParkingFacts
            view={parking}
            labels={{
              unknown: tc("unknown"),
              yes: t("parking.yes"),
              no: t("parking.no"),
              noneOnSite: t("parking.noneOnSite"),
              onSite: t("parking.fields.onSite"),
              spaceCount: t("parking.fields.spaceCount"),
              onStreet: t("parking.fields.onStreet"),
              paid: t("parking.fields.paid"),
              accessibleSpaces: t("parking.fields.accessibleSpaces"),
              walkingDistance: t("parking.fields.walkingDistanceM"),
              metres: (n) => t("parking.metres", { m: n }),
            }}
          />
        </Section>
      ) : null}
    </>
  );
}
