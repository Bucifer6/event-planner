import { getBusinessThread, type BudgetBand } from "@ed/core/enquiries";
import { formatDate } from "@ed/i18n/format";
import { Notice, PageHeader, Section, SheetTrigger } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { closeEnquiryAction } from "@/app/actions/enquiries";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import styles from "@/app/(app)/occasions/[id]/suppliers/enquiries/_components/enquiries.module.css";
import { Letters, SharedFacts, StateTag, statusLine } from "@/app/(app)/occasions/[id]/suppliers/enquiries/_components/Thread";
import { BusinessReplyForm, ReportForm } from "@/app/(app)/occasions/[id]/suppliers/enquiries/_components/ThreadForms";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import { waitingText } from "../_wait";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("enquiries"))("inbox.title") };
}

/**
 * One enquiry as the business reads it. Exactly what the planner sent (P8, F5) — no name, no
 * account, no plan; the email only when the planner ticked the box (P9, D3). The business
 * answers here, optionally with a PDF marked as its quote (P12); either side can close or
 * report (P11).
 */
export default async function BusinessThreadPage({ params }: { params: Promise<{ businessId: string; enquiryId: string }> }) {
  const { businessId, enquiryId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("enquiries");
  const to = await getTranslations("occasions");
  const tc = await getTranslations("common");
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const thread = await orNotFound(getBusinessThread(ctx, enquiryId));
  const base = `/business/${businessId}/enquiries`;
  const hidden = { enquiryId: thread.id, businessId };
  const kindLabel = thread.shared.kind === "enquiry" && to.has(`kinds.${thread.shared.occasionKind}` as never) ? to(`kinds.${thread.shared.occasionKind}` as never) : undefined;

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("inbox.back")}
      </Link>
      <PageHeader
        level={2}
        eyebrow={t("inbox.for", { listing: thread.listingName })}
        title={t(`kinds.${thread.kind}`)}
        description={
          <span className={styles.inline}>
            <StateTag t={tt} state={thread.state} viewer="business" />
            <span>{statusLine(tt, thread, ctx.locale, "business")}</span>
            {thread.waitingMinutes !== null ? <span className="ed-num">{t("inbox.waiting", { time: waitingText(tt, thread.waitingMinutes) })}</span> : null}
          </span>
        }
      />
      {thread.reportedAt ? <Notice tone="attention" title={t("thread.reportedOn", { date: formatDate(thread.reportedAt, ctx.locale) })} /> : null}

      <Section title={t("thread.sharedBusiness")}>
        <SharedFacts t={tt} shared={thread.shared} kindLabel={kindLabel} budgetLabel={(b: BudgetBand) => t(`budget.${b}`)} email={thread.sharedEmail} locale={ctx.locale} viewer="business" />
      </Section>

      <Section title={t("thread.messages")}>
        <Letters t={tt} messages={thread.messages} viewer="business" locale={ctx.locale} />
        {thread.canReply ? <BusinessReplyForm businessId={businessId} enquiryId={thread.id} /> : <Notice title={t("thread.closedNotice")} />}
      </Section>

      {thread.canReply ? (
        <Section>
          <div className={styles.tools}>
            <SheetTrigger label={t("thread.close")} title={t("thread.closeTitle")} closeLabel={t("thread.keep")} variant="quiet">
              <SpecForm action={closeEnquiryAction} hidden={hidden} fields={[]} submitLabel={t("thread.closeConfirm")} pendingLabel={t("thread.closing")} variant="danger" refreshOnSuccess block>
                <p>{t("thread.closeBody")}</p>
              </SpecForm>
            </SheetTrigger>
            <SheetTrigger label={t("thread.report")} title={t("thread.reportTitle")} closeLabel={tc("actions.close")} variant="quiet">
              <ReportForm enquiryId={thread.id} businessId={businessId} />
            </SheetTrigger>
          </div>
        </Section>
      ) : null}
    </>
  );
}
