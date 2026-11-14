import { getArrangementDesign, indicativeCostText, listArrangementDesigns, type ArrangementDesignView } from "@ed/core/arrangements";
import type { DesignChange } from "@ed/core/arrangementkit";
import { listPublicCatalogues } from "@ed/core/catalogues";
import { getOccasion } from "@ed/core/occasions";
import { zonedParts } from "@ed/shared/time";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, List, Notice, PageHeader, Row, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { ArrangementDesigner, type CatalogueOption, type DesignerInitial } from "./Designer";
import styles from "./flowers.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("arrangements"))("title") };
}

/**
 * Visual flower arrangement designer (C-13, F3–F6): designs from the florists' published
 * catalogues, an indicative cost that is never presented as a quote, immutable versions, the
 * quote request of F5 and the "design changed after the quote" delta of F6.
 */
export default async function FlowersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("arrangements");
  const locale = (await getLocale()) === "en" ? "en" : "ro";
  const [designs, occasion, catalogues] = await Promise.all([orNotFound(listArrangementDesigns(ctx, id)), orNotFound(getOccasion(ctx, id)), listPublicCatalogues(ctx)]);
  const wanted = typeof sp.design === "string" ? sp.design : null;
  const isNew = wanted === "new" || (!wanted && designs.length === 0);
  let view: ArrangementDesignView | null = null;
  if (wanted && wanted !== "new") {
    view = await orNotFound(getArrangementDesign(ctx, wanted, Number(sp.v) || null));
    if (view.occasionId !== id) view = null;
  }
  const canManage = view ? view.canManage : await import("@ed/core/access").then(async (m) => m.isManager(await m.requireMember(ctx, id)));
  const catalogue: CatalogueOption[] = catalogues.flatMap((c) => c.items.map((i) => ({ id: i.id, varietyName: i.varietyName, kind: i.kind, listingId: c.listingId, listingName: c.listingName, colours: i.colours, seasonMonths: i.seasonMonths, pricePerStemMinor: i.pricePerStemMinor, currency: i.currency })));
  const known = new Set(catalogue.map((c) => c.id));
  const snapshots: CatalogueOption[] = (view?.version.lines ?? []).filter((l) => !known.has(l.catalogueItemId)).map((l) => ({ id: l.catalogueItemId, varietyName: l.varietyName, kind: l.kind, listingId: l.listingId, listingName: l.listingName, colours: l.colour ? [l.colour] : [], seasonMonths: l.seasonMonths, pricePerStemMinor: l.pricePerStemMinor, currency: l.currency }));
  const listings = [...new Map(catalogues.map((c) => [c.listingId, { id: c.listingId, name: c.listingName }])).values()];
  const initial: DesignerInitial = view
    ? { designId: view.id, version: view.version.version, name: view.name, form: view.version.form, note: view.version.note ?? "", lines: view.version.lines.map((l) => ({ catalogueItemId: l.catalogueItemId, stems: l.stems, colour: l.colour })) }
    : { designId: null, version: null, name: t("designer.nameDefault"), form: "round_bouquet", note: "", lines: [] };
  const month = occasion.startsAt ? zonedParts(occasion.startsAt, occasion.timezone).month : null;
  const changeText = (c: DesignChange): string => {
    switch (c.kind) {
      case "form":
        return `${t("changes.form")}: ${t(`forms.${c.before}`)} → ${t(`forms.${c.after}`)}`;
      case "note":
        return `${t("changes.note")}: ${c.before || t("changes.none")} → ${c.after || t("changes.none")}`;
      case "added":
        return `${c.varietyName}: ${t("changes.added")}, ${t("changes.stems", { count: c.stems })}`;
      case "removed":
        return `${c.varietyName}: ${t("changes.removed")} (${t("changes.stems", { count: c.stems })})`;
      case "stems":
        return `${c.varietyName}: ${t("changes.stems", { count: c.before })} → ${t("changes.stems", { count: c.after })}`;
      case "colour":
        return `${t("changes.colour", { name: c.varietyName })}: ${c.before ? t(`colours.${c.before}`) : t("changes.none")} → ${c.after ? t(`colours.${c.after}`) : t("changes.none")}`;
    }
  };

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />

      <Section
        title={t("list.title")}
        level={3}
        actions={
          canManage && designs.length > 0 && !isNew ? (
            <Link href={`/occasions/${id}/flowers?design=new`} className={buttonClassName({})}>
              {t("list.new")}
            </Link>
          ) : null
        }
      >
        {designs.length === 0 ? (
          <EmptyState title={t("list.empty")}>{t("list.emptyBody")}</EmptyState>
        ) : (
          <List>
            {designs.map((d) => (
              <Row
                key={d.id}
                title={d.name}
                meta={t("list.meta", { form: t(`forms.${d.form}`), stems: d.cost.totalStems, version: d.version })}
                end={
                  view?.id === d.id ? null : (
                    <Link href={`/occasions/${id}/flowers?design=${d.id}`} className={buttonClassName({ size: "sm" })}>
                      {t("list.open")}
                    </Link>
                  )
                }
              >
                <span className="ed-small ed-muted">
                  {t("cost.label")}: <span className="ed-num">{indicativeCostText(d.cost, locale)}</span>
                  {d.quoteRequests > 0 ? ` · ${t("list.quoteRequests", { count: d.quoteRequests })}` : ""}
                </span>
                {d.source === "assistant" ? <Tag>{t("list.assistant")}</Tag> : null}
              </Row>
            ))}
          </List>
        )}
      </Section>

      {view || isNew ? (
        <Section title={view ? view.name : t("list.new")} level={3}>
          {view && view.version.version !== view.currentVersion ? <Notice>{t("versions.row", { version: view.version.version, stems: view.version.lines.reduce((n, l) => n + l.stems, 0) })}</Notice> : null}
          {(view?.quotes ?? [])
            .filter((q) => q.changedSinceQuote)
            .map((q) => (
              <Notice key={q.enquiryId} tone="attention" title={t("quote.changedTitle")}>
                {t("quote.changedBody", { listing: q.listingName, quoted: q.changedSinceQuote!.quotedVersion, current: q.changedSinceQuote!.currentVersion })}
                <ul className={styles.changes}>
                  {q.changedSinceQuote!.changes.map((c, i) => (
                    <li key={i}>{changeText(c)}</li>
                  ))}
                </ul>
              </Notice>
            ))}
          <ArrangementDesigner key={`${view?.id ?? "new"}-${view?.version.version ?? 0}`} occasionId={id} occasionMonth={month} canManage={canManage} catalogue={catalogue} snapshots={snapshots} listings={listings} initial={initial} isCurrent={!view || view.version.version === view.currentVersion} locale={locale} />
        </Section>
      ) : null}

      {view && view.quotes.length > 0 ? (
        <Section title={t("quote.requests")} level={3}>
          <List>
            {view.quotes.map((q) => (
              <Row
                key={q.enquiryId}
                title={t("quote.request", { listing: q.listingName, version: q.version })}
                meta={`${formatDate(q.sentAt, locale)} · ${q.link ? t("quote.accepted", { version: q.link.current.designRef?.version ?? q.version }) : t("quote.waiting")}`}
              />
            ))}
          </List>
        </Section>
      ) : null}

      {view && view.versions.length > 1 ? (
        <Section title={t("versions.title")} level={3}>
          <List>
            {view.versions.map((v) => (
              <Row
                key={v.version}
                title={t("versions.row", { version: v.version, stems: v.stems })}
                meta={formatDate(v.createdAt, locale)}
                end={
                  v.version === view!.currentVersion ? (
                    <Tag>{t("versions.current")}</Tag>
                  ) : (
                    <Link href={`/occasions/${id}/flowers?design=${view!.id}&v=${v.version}`} className={buttonClassName({ size: "sm" })}>
                      {t("list.open")}
                    </Link>
                  )
                }
              />
            ))}
          </List>
        </Section>
      ) : null}
    </>
  );
}
