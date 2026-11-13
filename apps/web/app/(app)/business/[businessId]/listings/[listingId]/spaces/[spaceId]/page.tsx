import { getSpaceEditor } from "@ed/core/drawings";
import { mmToMetresText } from "@ed/core/spacemodel";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { DeltaList, Notice, PageHeader, Section, SheetTrigger, Tag, type Tone } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { retireSpaceAction, submitSpaceAction, updateSpaceDetailsAction, withdrawSpaceRevisionAction } from "@/app/actions/drawings";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { PlannerForm } from "@/app/(app)/occasions/[id]/guests/_components/form";
import { requireCtx } from "@/lib/ctx";
import { SpaceEditor } from "./SpaceEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("drawings"))("editor.title") };
}

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success", retired: "neutral" };

/**
 * One space of a venue: its drawing, the calibration (V7) and the markings (V2, V8, V11) —
 * the business's working copy. What is public is the last approved version; changes go to a
 * moderator with "Trimite spre verificare" (V3).
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; listingId: string; spaceId: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const [{ businessId, listingId, spaceId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("drawings");
  const tc = await getTranslations("common");
  const all = await getTranslations();
  const ed = await orNotFound(getSpaceEditor(ctx, spaceId));
  if (ed.businessId !== businessId || ed.listing.id !== listingId) notFound();
  const { space } = ed;
  const base = `/business/${businessId}/listings/${listingId}/spaces`;
  const m = (mm: number | null) => (mm === null ? "" : mmToMetresText(mm, ctx.locale));
  const manage = ed.role === "owner" || ed.role === "admin";
  const empty = <span className="ed-unknown">{tc("unknown")}</span>;
  const changed = ed.pending?.fields.filter((f) => f.before !== f.after) ?? [];
  const canSend = ed.canEdit && space.dirty && (!!space.drawingAssetId || space.widthMm !== null || space.lengthMm !== null);

  return (
    <>
      <PageHeader
        level={2}
        eyebrow={<Link href={base}>{t("editor.back")}</Link>}
        title={space.name}
        actions={
          <>
            <Tag tone={STATUS_TONE[space.status]}>
              {ed.live ? t("status.liveVersion", { n: ed.live.versionNo, date: formatDate(ed.live.effectiveAt, ctx.locale) }) : t(`status.${space.status}`)}
            </Tag>
            {ed.live && ed.pending ? <Tag tone="attention">{t("status.editPending")}</Tag> : null}
          </>
        }
      />

      {sp.sent ? (
        <Notice tone="success" title={t("sent.title")}>
          {t("sent.body")}
        </Notice>
      ) : null}
      {ed.lastRejection ? (
        <Notice tone="attention" title={t("rejected.title")}>
          <p>{ed.lastRejection.reason}</p>
          <p>{t("rejected.next")}</p>
        </Notice>
      ) : null}
      {ed.pending ? (
        <Notice title={t("pending.title")}>
          <p>{t(ed.live ? "pending.bodyEdit" : "pending.bodyNew", { date: formatDateTime(ed.pending.submittedAt, ctx.locale) })}</p>
          {ed.live && changed.length > 0 ? (
            <DeltaList rows={changed.map((f) => ({ key: f.key, what: all(f.labelKey as never), before: f.before ?? empty, after: f.after ?? empty }))} />
          ) : null}
          <ActionForm
            action={withdrawSpaceRevisionAction}
            hidden={{ businessId, listingId, revisionId: ed.pending.revisionId }}
            refreshOnSuccess
            variant="quiet"
            block={false}
            submitLabel={t("withdraw")}
            pendingLabel={t("withdrawing")}
          />
        </Notice>
      ) : null}

      <Section title={t("details.title")} level={3}>
        <p className="ed-muted">{t("details.body")}</p>
        {ed.canEdit ? (
          <SheetTrigger label={t("details.change")} title={t("details.title")} closeLabel={tc("actions.close")}>
            <PlannerForm
              id="space-details"
              action={updateSpaceDetailsAction}
              hidden={{ businessId, listingId, spaceId }}
              fields={[
                { name: "name", label: t("fields.spaceName"), required: true, maxLength: 120, defaultValue: space.name },
                { name: "widthMm", label: t("fields.statedWidth"), hint: t("fields.statedHint"), defaultValue: m(space.widthMm) },
                { name: "lengthMm", label: t("fields.statedLength"), defaultValue: m(space.lengthMm) },
              ]}
              optionalLabel={t("optionalUnknown")}
              submitLabel={t("saveChanges")}
              pendingLabel={tc("status.saving")}
              success={t("saved")}
            />
          </SheetTrigger>
        ) : null}
        <p>
          {t("details.stated")}: {space.widthMm === null ? empty : `${m(space.widthMm)} m`} × {space.lengthMm === null ? empty : `${m(space.lengthMm)} m`}
        </p>
      </Section>

      <SpaceEditor
        key={`${space.drawingAssetId ?? "none"}-${space.updatedAt.getTime()}`}
        businessId={businessId}
        listingId={listingId}
        spaceId={space.id}
        locale={ctx.locale}
        canEdit={ed.canEdit}
        name={space.name}
        version={space.version}
        pictureUrl={ed.pictureUrl}
        pdfWithoutPicture={ed.pdfWithoutPicture}
        hasDrawing={!!space.drawingAssetId}
        pixelWidth={space.pixelWidth}
        pixelHeight={space.pixelHeight}
        mmPerPx={space.mmPerPx}
        calibration={space.calibration}
        markings={space.markings}
        widthMm={space.widthMm}
        lengthMm={space.lengthMm}
      />

      {ed.canEdit ? (
        <Section title={t("submit.title")} level={3}>
          <p className="ed-muted">{t(ed.live ? "submit.bodyEdit" : "submit.bodyNew")}</p>
          {!space.dirty ? <p className="ed-small ed-muted">{t("submit.nothingNew")}</p> : null}
          <div className="ed-actionbar">
            {canSend ? (
              <ActionForm action={submitSpaceAction} hidden={{ businessId, listingId, spaceId }} block={false} submitLabel={t("submit.send")} pendingLabel={t("sending")} />
            ) : null}
            {manage ? (
              <SheetTrigger label={t("retire.open")} variant="danger-quiet" title={t("retire.title", { name: space.name })} closeLabel={tc("actions.close")}>
                <p>{t("retire.body")}</p>
                <ActionForm action={retireSpaceAction} hidden={{ businessId, listingId, spaceId }} variant="danger" block={false} submitLabel={t("retire.confirm", { name: space.name })} pendingLabel={t("retire.removing")} />
              </SheetTrigger>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}
