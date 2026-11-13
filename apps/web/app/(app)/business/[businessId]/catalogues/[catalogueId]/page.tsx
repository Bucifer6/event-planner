import { BUSINESS_PHOTO_PURPOSE } from "@ed/core/business";
import { CATALOGUE_COLOURS, getCatalogueEditor, type CatalogueEditorItem } from "@ed/core/catalogues";
import { formatDate, formatMoney } from "@ed/i18n/format";
import { EmptyState, Notice, PageHeader, Section, SheetTrigger, Tag, Unknown, type Tone } from "@ed/ui";
import { IconArrowLeft, IconFlower, IconLeaf, IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { discardCatalogueDraftAction, removeCatalogueItemAction, renameCatalogueAction, retireCatalogueAction, submitCatalogueAction } from "@/app/actions/catalogues";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "../catalogues.module.css";
import { ItemForm, type ItemFormValues } from "./ItemForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalogues"))("title") };
}

const STATE_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success", retired: "neutral" };
const priceText = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2).replace(".", ",").replace(/,00$/, ""));

/**
 * F1: the editor of one catalogue. What is typed here is a working copy; "Trimite spre
 * verificare" queues it for a moderator, and the live version stays exactly as it is until
 * that revision is approved.
 */
export default async function CatalogueEditorPage({ params, searchParams }: { params: Promise<{ businessId: string; catalogueId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ businessId, catalogueId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("catalogues");
  const editor = await orNotFound(getCatalogueEditor(ctx, catalogueId));
  if (editor.catalogue.businessId !== businessId) notFound();
  const { catalogue, working, pending, lastRejection, canEdit, hasUnsentChanges } = editor;
  const base = `/business/${businessId}/catalogues`;
  const ref = { businessId, catalogueId: catalogue.id };
  const palette = [...CATALOGUE_COLOURS];
  const canSubmit = canEdit && working.items.length > 0 && hasUnsentChanges;
  const values = (i: CatalogueEditorItem): ItemFormValues => ({
    id: i.id,
    kind: i.kind,
    varietyName: i.varietyName,
    imageAssetId: i.imageAssetId,
    seasonMonths: i.seasonMonths,
    priceStem: priceText(i.pricePerStemMinor),
    priceBunch: priceText(i.pricePerBunchMinor),
    colours: i.colours,
    notes: i.notes ?? "",
  });
  const meta = (i: CatalogueEditorItem) => {
    const prices = [
      i.pricePerStemMinor !== null ? t("public.perStem", { price: formatMoney(i.pricePerStemMinor, "RON", ctx.locale) }) : null,
      i.pricePerBunchMinor !== null ? t("public.perBunch", { price: formatMoney(i.pricePerBunchMinor, "RON", ctx.locale) }) : null,
    ].filter(Boolean);
    return (
      <>
        <span className={styles.itemMeta}>
          {t("public.indicative")}: {prices.length ? <span className="ed-num">{prices.join(" · ")}</span> : <Unknown label={t("public.priceUnknown")} />}
        </span>
        <span className={styles.itemMeta}>
          {t("public.season")}: {i.seasonMonths.length === 0 ? <Unknown label={t("public.seasonUnknown")} /> : i.seasonMonths.length === 12 ? t("public.allYear") : i.seasonMonths.map((m) => t(`months.${m}` as never)).join(", ")}
          {" · "}
          {i.colours.length ? i.colours.map((c) => t(`colours.${c}`)).join(", ") : <Unknown label={t("public.coloursUnknown")} />}
        </span>
      </>
    );
  };

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("editor.back")}
      </Link>
      <PageHeader
        level={2}
        eyebrow={t("list.listing", { name: editor.listingName })}
        title={working.name}
        actions={
          <span className={styles.tags}>
            <Tag tone={STATE_TONE[catalogue.state]}>{t(`states.${catalogue.state}`)}</Tag>
            {catalogue.state === "live" && pending ? <Tag tone="attention">{t("states.editPending")}</Tag> : null}
          </span>
        }
      />

      <div className={styles.notices}>
      {sp.saved === "submitted" ? <Notice tone="success" title={t("editor.submitted")} /> : null}
      {pending ? (
        <Notice tone="attention" title={t("editor.pendingTitle", { date: formatDate(pending.submittedAt, ctx.locale) })}>
          {catalogue.state === "live" ? t("editor.pendingBody") : t("editor.pendingNew")}
        </Notice>
      ) : null}
      {lastRejection ? (
        <Notice tone="danger" title={t("editor.rejectedTitle")} role="status">
          {lastRejection.reason ? <p className={styles.reason}>{t("editor.rejectedReason", { reason: lastRejection.reason })}</p> : null}
        </Notice>
      ) : null}
      {hasUnsentChanges && catalogue.state !== "draft" ? <Notice title={t("editor.unsentTitle")}>{t("editor.unsentBody")}</Notice> : null}
      {!canEdit ? <Notice tone="attention" title={t("editor.readOnly")} /> : null}
      </div>

      <Section
        title={t("editor.items")}
        actions={
          canEdit && working.items.length > 0 ? (
            <SheetTrigger label={t("editor.add")} title={t("item.titleNew")} closeLabel={t("editor.close")} icon={<IconPlus size={18} />}>
              <ItemForm businessId={businessId} catalogueId={catalogue.id} uploadPurpose={BUSINESS_PHOTO_PURPOSE} palette={palette} formId="new" />
            </SheetTrigger>
          ) : undefined
        }
      >
        {working.items.length === 0 ? (
          <EmptyState
            title={t("editor.emptyTitle")}
            action={
              canEdit ? (
                <SheetTrigger label={t("editor.addFirst")} title={t("item.titleNew")} closeLabel={t("editor.close")} variant="primary">
                  <ItemForm businessId={businessId} catalogueId={catalogue.id} uploadPurpose={BUSINESS_PHOTO_PURPOSE} palette={palette} formId="first" />
                </SheetTrigger>
              ) : undefined
            }
          >
            {t("editor.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <p className="ed-muted">{t("editor.itemsCount", { count: working.items.length })}</p>
            <ul className={styles.items}>
              {working.items.map((i) => (
                <li key={i.id} className={styles.item}>
                  {i.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived same-origin link; not a static asset
                    <img className={styles.thumb} src={i.imageUrl} alt="" loading="lazy" width={64} height={64} />
                  ) : (
                    <span className={styles.noThumb} aria-hidden="true">
                      {i.kind === "foliage" ? <IconLeaf size={22} /> : <IconFlower size={22} />}
                    </span>
                  )}
                  <div className={styles.itemMain}>
                    <span className={styles.itemName}>{i.varietyName}</span>
                    <span className="ed-label">{t(`item.kinds.${i.kind}`)}</span>
                    {meta(i)}
                    {i.notes ? <span className={styles.itemMeta}>{i.notes}</span> : null}
                  </div>
                  {canEdit ? (
                    <div className={styles.itemTools}>
                      <SheetTrigger label={t("editor.edit")} title={t("item.titleEdit")} closeLabel={t("editor.close")} variant="quiet">
                        <ItemForm businessId={businessId} catalogueId={catalogue.id} uploadPurpose={BUSINESS_PHOTO_PURPOSE} palette={palette} item={values(i)} formId={i.id} />
                      </SheetTrigger>
                      <SpecForm action={removeCatalogueItemAction} hidden={{ ...ref, itemId: i.id }} fields={[]} submitLabel={t("editor.remove")} pendingLabel={t("editor.removing")} variant="danger-quiet" refreshOnSuccess />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {canEdit ? (
        <Section>
          {canSubmit ? (
            <div className="ed-actionbar">
              <SpecForm action={submitCatalogueAction} hidden={ref} fields={[]} submitLabel={t("editor.submit")} pendingLabel={t("editor.submitting")} />
            </div>
          ) : null}
          <div className={styles.tools}>
            <SheetTrigger label={t("editor.rename")} title={t("editor.renameTitle")} closeLabel={t("editor.close")} variant="quiet">
              <SpecForm
                action={renameCatalogueAction}
                hidden={ref}
                fields={[{ kind: "text", name: "name", label: t("fields.name"), required: true, maxLength: 120, defaultValue: working.name }]}
                submitLabel={t("editor.saveName")}
                pendingLabel={t("editor.saving")}
                success={t("editor.saved")}
                variant="secondary"
                refreshOnSuccess
                block
              />
            </SheetTrigger>
            {hasUnsentChanges && catalogue.state !== "draft" ? (
              <SpecForm action={discardCatalogueDraftAction} hidden={ref} fields={[]} submitLabel={t("editor.discard")} pendingLabel={t("editor.discarding")} variant="quiet" refreshOnSuccess />
            ) : null}
            {editor.role !== "staff" ? (
              <SheetTrigger label={t("editor.retire")} title={t("editor.retireTitle")} closeLabel={t("editor.keep")} variant="danger-quiet">
                <SpecForm action={retireCatalogueAction} hidden={ref} fields={[]} submitLabel={t("editor.retireConfirm")} pendingLabel={t("editor.retiring")} variant="danger" block>
                  <p>{t("editor.retireBody")}</p>
                </SpecForm>
              </SheetTrigger>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}
