import { getGiftPage, GIFT_DISTANCES, GIFT_RELATIONSHIPS, GIFT_VENUES } from "@ed/core/gifts";
import { formatMoney } from "@ed/i18n/format";
import { EmptyState, List, Notice, PageHeader, Row, Section, SheetTrigger } from "@ed/ui";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { GiftEstimator, GuideForm, RemoveNote, type GuideValues } from "./Estimator";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("gifts"))("title") };
}

/**
 * Gift estimator — "calculator dar" (C-11). A cultural guide, private to the signed-in
 * account: what is worked out or kept here is read from rows carrying this account's id and
 * shown to nobody else — not other organisers, not guests, not exports, not assistants.
 */
export default async function GiftsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("gifts");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) === "en" ? "en" : "ro";
  const page = await orNotFound(getGiftPage(ctx, id));
  const values: GuideValues = {
    base: Object.fromEntries(GIFT_VENUES.map((v) => [v, { low: page.guide.base[v].lowMinor / 100, high: page.guide.base[v].highMinor / 100 }])),
    relationshipPct: Object.fromEntries(GIFT_RELATIONSHIPS.map((r) => [r, page.guide.relationshipPct[r]])),
    distancePct: Object.fromEntries(GIFT_DISTANCES.map((d) => [d, page.guide.distancePct[d]])),
  };

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />
      <Section>
        <Notice title={t("private.title")}>{t("private.body")}</Notice>
      </Section>
      <Section>
        <GiftEstimator occasionId={id} households={page.households} locale={locale} />
      </Section>

      <Section title={t("notes.title")} level={3}>
        {page.estimates.length === 0 ? (
          <EmptyState title={t("notes.empty")}>{t("notes.emptyBody")}</EmptyState>
        ) : (
          <List>
            {page.estimates.map((e) => (
              <Row
                key={e.id}
                title={e.label}
                meta={t("notes.meta", { relationship: t(`relationships.${e.relationship}`), distance: t(`distances.${e.distance}`), venue: t(`venues.${e.venue}`), adults: e.adults })}
                end={<RemoveNote occasionId={id} id={e.id} label={t("notes.remove")} pendingLabel={t("notes.removing")} />}
              >
                <span className="ed-num">{t("result.range", { low: formatMoney(e.lowMinor, e.currency, locale), high: formatMoney(e.highMinor, e.currency, locale) })}</span>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section title={t("guide.title")} level={3}>
        <p className="ed-muted" style={{ maxWidth: "var(--measure)" }}>{t("guide.body")}</p>
        <p className="ed-small ed-muted">{page.isDefault ? t("guide.isDefault") : t("guide.isOwn")}</p>
        <div>
          <SheetTrigger label={t("guide.open")} title={t("guide.title")} closeLabel={tc("actions.close")}>
            <GuideForm occasionId={id} values={values} isDefault={page.isDefault} />
          </SheetTrigger>
        </div>
      </Section>
    </>
  );
}
