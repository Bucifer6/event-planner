import { getAiTextStatus } from "@ed/core/aitext";
import { getPromotionCardPreview, getPromotionPage, PROMOTION_TEXT_KEYS, PROMOTION_TEXT_LIMITS } from "@ed/core/promotion";
import { svgDataUri } from "@ed/core/stationerykit";
import { stationeryDesignName } from "@ed/core/stationery";
import { formatDate } from "@ed/i18n/format";
import { LinkButton, List, Notice, PageHeader, Row, Section } from "@ed/ui";
import { IconDownload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import styles from "./promotion.module.css";
import { PromotionTexts, type PromoText } from "./TextsForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("promotion"))("title") };
}

/**
 * Promotion exports (C-12): description texts and assets generated from the occasion's own
 * records, to download. There is no posting, scheduling or spending anywhere on this page —
 * and no integration that could do it.
 */
export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("promotion");
  const locale = (await getLocale()) === "en" ? "en" : "ro";
  const page = await orNotFound(getPromotionPage(ctx, id));
  const [card, ai] = await Promise.all([getPromotionCardPreview(ctx, id), getAiTextStatus(ctx)]);
  const initial = Object.fromEntries(PROMOTION_TEXT_KEYS.map((k) => [k, { value: page.texts[k].value, aiOriginal: page.texts[k].aiGenerated ? (page.texts[k].aiOriginal ?? page.texts[k].value) : null, saved: page.texts[k].saved }])) as Record<(typeof PROMOTION_TEXT_KEYS)[number], PromoText>;
  const assets: Array<{ key: string; title: string; meta: string; available: boolean }> = [
    { key: "card-square", title: t("assets.square"), meta: t("assets.squareMeta"), available: true },
    { key: "card-story", title: t("assets.story"), meta: t("assets.storyMeta"), available: true },
    { key: "calendar", title: t("assets.ics"), meta: page.occasion.hasDate ? t("assets.icsMeta") : t("assets.icsNoDate"), available: page.occasion.hasDate },
    { key: "poster-a4", title: t("assets.posterA4"), meta: t("assets.posterMeta"), available: true },
    { key: "poster-a3", title: t("assets.posterA3"), meta: t("assets.posterMeta"), available: true },
  ];

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />
      <Section>
        <Notice title={t("exportOnly.title")}>{t("exportOnly.body")}</Notice>
      </Section>

      <Section title={t("assets.title")} level={3}>
        <div className={styles.layout}>
          <div>
            <img className={styles.card} src={svgDataUri(card)} width={420} height={420} alt={t("assets.previewAlt")} />
          </div>
          <div>
            <p className="ed-small ed-muted">{page.design.fromStationery ? t("assets.design", { design: stationeryDesignName(page.design.designKey, locale) }) : t("assets.designDefault")}</p>
            <List>
              {assets.map((a) => (
                <Row
                  key={a.key}
                  title={a.title}
                  meta={a.meta}
                  end={
                    a.available ? (
                      <LinkButton size="sm" href={`/occasions/${id}/promotion/download/${a.key}`} download>
                        <IconDownload size={18} />
                        {t("assets.download")}
                      </LinkButton>
                    ) : null
                  }
                />
              ))}
            </List>
          </div>
        </div>
      </Section>

      <Section title={t("texts.title")} level={3}>
        <PromotionTexts
          occasionId={id}
          occasionKind={page.occasion.kind}
          canManage={page.canManage}
          initial={initial}
          limits={PROMOTION_TEXT_LIMITS}
          ai={{ enabled: ai.enabled, remaining: ai.remaining, limit: ai.limit, resetsOn: formatDate(ai.resetsAt, locale) }}
        />
      </Section>
    </>
  );
}
