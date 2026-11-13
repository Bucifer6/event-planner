import { describeListingChange, getListingEditor } from "@ed/core/listings";
import { getPublishedListingStats } from "@ed/core/listingstats";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { buttonClassName, DeltaList, DescriptionList, Notice, PageHeader, Section, SheetTrigger, Tag, type Tone } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { retireListingAction, setListingStatsVisibility, withdrawListingRevision } from "@/app/actions/listings";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import styles from "../../../business.module.css";
import { ListingEditor } from "../../_components/ListingEditor";
import { editorPicklists, editorValues } from "../../_components/load-editor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("listings"))("detail.title") };
}

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success", suspended: "danger", retired: "neutral" };

/**
 * One listing in the business area: what is PUBLIC now, what WAITS for a moderator (shown as
 * before → after), the last decision with its reason, and the form to change it (P3).
 */
export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; listingId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ businessId, listingId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("listings");
  const all = await getTranslations();
  const ed = await orNotFound(getListingEditor(ctx, listingId));
  if (ed.business.id !== businessId) notFound();
  const { listing, live, pending } = ed;
  const empty = <span className="ed-unknown">{t("detail.empty")}</span>;
  const label = (key: string) => all(key as never);

  const liveFields = live ? await describeListingChange(ctx, live, null) : [];
  const pendingFields = pending ? (await describeListingChange(ctx, pending.payload, live)).filter((f) => f.before !== f.after) : [];
  const manage = ed.role === "owner" || ed.role === "admin";
  const stats = listing.status === "live" ? await getPublishedListingStats(ctx, listing.id) : null;

  return (
    <div className={styles.narrow}>
      <PageHeader
        level={2}
        eyebrow={<Link href={`/business/${businessId}`}>{t("back")}</Link>}
        title={listing.name}
        actions={
          <>
            <Tag tone={STATUS_TONE[listing.status]}>{t(`status.${listing.status}`)}</Tag>
            {listing.status === "live" && pending ? <Tag tone="attention">{t("status.editPending")}</Tag> : null}
          </>
        }
      />

      {sp.saved === "draft" ? <Notice tone="success" title={t("saved.draft")} /> : null}
      {sp.saved === "submitted" ? <Notice tone="success" title={t("saved.submitted")}>{t("saved.submittedBody")}</Notice> : null}

      {listing.status === "suspended" ? (
        <Notice tone="danger" title={t("suspended.title")}>
          <p>{t("suspended.body")}</p>
          {listing.suspensionReason ? (
            <p className={styles.reason}>
              <strong>{t("suspended.reason")}</strong> {listing.suspensionReason}
            </p>
          ) : null}
        </Notice>
      ) : null}

      {ed.lastRejection ? (
        <Notice tone="attention" title={t("rejected.title")}>
          <p className={styles.reason}>
            <strong>{t("rejected.reason")}</strong> {ed.lastRejection.reason ?? empty}
          </p>
          <p>{t("rejected.next")}</p>
        </Notice>
      ) : null}

      <Section title={t("detail.liveTitle")} level={3}>
        {live ? (
          <>
            <DescriptionList cols={2} items={liveFields.filter((f) => f.after !== null).map((f) => ({ term: label(f.labelKey), value: f.after }))} />
            {listing.status === "live" ? (
              <p>
                <Link href={`/directory/listing/${listing.id}`}>{t("detail.viewPublic")}</Link>
              </p>
            ) : null}
          </>
        ) : (
          <p className="ed-muted">{t("detail.notLiveYet")}</p>
        )}
      </Section>

      {pending ? (
        <Section title={t("detail.pendingTitle")} level={3}>
          <p className="ed-muted">
            {t(live ? "detail.pendingEditBody" : "detail.pendingNewBody", { date: formatDateTime(pending.submittedAt, ctx.locale) })}
          </p>
          {pendingFields.length > 0 ? (
            <DeltaList
              rows={pendingFields.map((f) => ({
                key: f.key,
                what: label(f.labelKey),
                before: live ? (f.before ?? empty) : undefined,
                after: f.after ?? empty,
              }))}
            />
          ) : (
            <p className="ed-muted">{t("detail.pendingNoChange")}</p>
          )}
          <ActionForm
            action={withdrawListingRevision}
            hidden={{ businessId, listingId: listing.id, revisionId: pending.revisionId }}
            refreshOnSuccess
            variant="quiet"
            block={false}
            submitLabel={t("detail.withdraw")}
            pendingLabel={t("detail.withdrawing")}
          />
        </Section>
      ) : null}

      {listing.status !== "retired" ? (
        <Section title={ed.canEdit ? t("detail.editTitle") : t("detail.contentTitle")} level={3}>
          {ed.canEdit && live ? <p className="ed-muted">{t("detail.editBody")}</p> : null}
          {ed.draft && ed.canEdit ? <Notice title={t("detail.draftNotice")} /> : null}
          <ListingEditor
            key={`${listing.updatedAt.getTime()}-${pending?.revisionId ?? "none"}`}
            businessId={businessId}
            listingId={listing.id}
            picklists={await editorPicklists(ctx)}
            initial={await editorValues(ctx, ed.working)}
            canEdit={ed.canEdit}
            submitLabel={t("editor.submit")}
          />
        </Section>
      ) : null}

      {manage && listing.status !== "retired" ? (
        <Section title={t("detail.moreTitle")} level={3}>
          <div className="ed-stack" data-gap="4">
            <div className="ed-stack" data-gap="2">
              <strong>{t("stats.title")}</strong>
              <p className="ed-muted">{t("stats.body")}</p>
              <p className="ed-small">
                {listing.hideStats || ed.business.hideStats
                  ? t("stats.hiddenNow")
                  : stats
                    ? t("stats.shownNow", { date: formatDate(new Date(`${stats.day}T12:00:00Z`), ctx.locale) })
                    : t("stats.notYet")}
              </p>
              <ActionForm
                action={setListingStatsVisibility}
                hidden={{ businessId, listingId: listing.id, hide: listing.hideStats ? "false" : "true" }}
                refreshOnSuccess
                variant="secondary"
                block={false}
                submitLabel={listing.hideStats ? t("stats.show") : t("stats.hide")}
                pendingLabel={t("stats.saving")}
              />
            </div>
            <div className="ed-stack" data-gap="2">
              <strong>{t("retire.title")}</strong>
              <p className="ed-muted">{t("retire.body")}</p>
              <div>
                <SheetTrigger label={t("retire.open")} variant="danger-quiet" title={t("retire.confirmTitle", { name: listing.name })} closeLabel={all("common.actions.close")}>
                  <p>{t("retire.confirmBody")}</p>
                  <ActionForm
                    action={retireListingAction}
                    hidden={{ businessId, listingId: listing.id }}
                    variant="danger"
                    block={false}
                    submitLabel={t("retire.confirm", { name: listing.name })}
                    pendingLabel={t("retire.retiring")}
                  />
                </SheetTrigger>
              </div>
            </div>
          </div>
        </Section>
      ) : null}
      <p className="ed-small ed-muted">
        <Link href={`/business/${businessId}`} className={buttonClassName({ variant: "quiet", size: "sm" })}>
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
