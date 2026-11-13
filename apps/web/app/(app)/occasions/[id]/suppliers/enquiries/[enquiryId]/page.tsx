import { getPlannerThread, type BudgetBand } from "@ed/core/enquiries";
import { formatDate, formatMoney } from "@ed/i18n/format";
import { DeltaList, Notice, PageHeader, Section, SheetTrigger } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptQuoteAction, closeEnquiryAction, replyPlannerAction, resendEnquiryAction } from "@/app/actions/enquiries";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "../_components/enquiries.module.css";
import { Letters, SharedFacts, StateTag, statusLine } from "../_components/Thread";
import { ReportForm } from "../_components/ThreadForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("enquiries"))("title") };
}

type Props = { params: Promise<{ id: string; enquiryId: string }>; searchParams: Promise<{ sent?: string }> };

/**
 * One enquiry as the planner reads it (P33): what was sent, the correspondence, the state in
 * words with its date, the single re-send after 7 days, close / report, and — for a PDF the
 * business marked as its quote — "Acceptă oferta" (P12, F6).
 */
export default async function PlannerThreadPage({ params, searchParams }: Props) {
  const [{ id, enquiryId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("enquiries");
  const to = await getTranslations("occasions");
  const tc = await getTranslations("common");
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const thread = await getPlannerThread(ctx, enquiryId).catch(() => null);
  if (!thread || thread.occasionId !== id) notFound();
  const base = `/occasions/${id}/suppliers`;
  const hidden = { enquiryId: thread.id, occasionId: id };
  const open = thread.state !== "closed";
  const link = thread.quoteLink;
  const kindLabel = thread.shared.kind === "enquiry" && to.has(`kinds.${thread.shared.occasionKind}` as never) ? to(`kinds.${thread.shared.occasionKind}` as never) : undefined;
  const money = (minor: string | null) => (minor === null ? tc("unknown") : formatMoney(Number(minor), link?.current.currency ?? "RON", ctx.locale));

  return (
    <>
      <Link href={`${base}/enquiries`} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("planner.backToList")}
      </Link>
      <PageHeader
        level={2}
        eyebrow={t(`kinds.${thread.kind}`)}
        title={thread.listingName}
        description={
          <span className={styles.inline}>
            <StateTag t={tt} state={thread.state} viewer="planner" />
            <span>{statusLine(tt, thread, ctx.locale, "planner")}</span>
          </span>
        }
        actions={
          thread.supplierId ? (
            <Link href={`${base}/${thread.supplierId}`} className="ed-btn">
              {t("planner.supplier")}
            </Link>
          ) : undefined
        }
      />

      <div className={styles.notices}>
      {sp.sent ? <Notice tone="success" title={t("status.sentOn", { date: formatDate(thread.sentAt, ctx.locale) })} /> : null}
      {thread.reportedAt ? <Notice tone="attention" title={t("thread.reportedOn", { date: formatDate(thread.reportedAt, ctx.locale) })} /> : null}

      {link ? (
        <Notice tone="success" title={t("thread.accepted")}>
          <p>{t("thread.acceptedOn", { date: formatDate(link.current.acceptedAt, ctx.locale), version: link.current.version })}</p>
          {link.current.agreedMinor !== undefined ? (
            <p>{t("thread.acceptedAmount", { amount: link.current.agreedMinor === null ? tc("unknown") : formatMoney(link.current.agreedMinor, link.current.currency, ctx.locale) })}</p>
          ) : null}
          {link.designChangedSinceQuote ? <p>{t("thread.designChanged")}</p> : null}
        </Notice>
      ) : null}
      </div>
      {link && link.changes.length > 0 ? (
        <Section title={t("thread.changes")}>
          <DeltaList
            rows={link.changes.map((c) => ({
              key: c.field,
              what: t(c.field === "design" ? "thread.changeDesign" : c.field === "quote" ? "thread.changeQuote" : "thread.changeAmount"),
              before: c.field === "amount" ? money(c.before) : c.field === "quote" ? undefined : (c.before ?? tc("unknown")),
              after: c.field === "amount" ? money(c.after) : c.field === "quote" ? undefined : (c.after ?? tc("unknown")),
            }))}
          />
        </Section>
      ) : null}

      <Section title={t("thread.shared")}>
        <SharedFacts t={tt} shared={thread.shared} kindLabel={kindLabel} budgetLabel={(b: BudgetBand) => t(`budget.${b}`)} email={thread.sharedEmail} locale={ctx.locale} viewer="planner" />
      </Section>

      <Section title={t("thread.messages")}>
        <Letters
          t={tt}
          messages={thread.messages}
          viewer="planner"
          locale={ctx.locale}
          quoteAction={
            thread.canManage && thread.bookingId
              ? (m) =>
                  link?.current.quoteMessageId === m.id ? (
                    <span className="ed-label">{t("thread.accepted")}</span>
                  ) : (
                    <SheetTrigger label={t("thread.accept")} title={t("thread.acceptTitle")} closeLabel={tc("actions.close")}>
                      <SpecForm
                        action={acceptQuoteAction}
                        hidden={{ ...hidden, messageId: m.id }}
                        fields={thread.canSeeMoney ? [{ kind: "text", name: "agreedAmount", label: t("thread.acceptAmount"), hint: t("thread.acceptAmountHint"), maxLength: 30, optionalLabel: t("form.optional") }] : []}
                        submitLabel={t("thread.acceptConfirm")}
                        pendingLabel={t("thread.accepting")}
                        success={t("thread.accepted")}
                        replaceOnSuccess
                        refreshOnSuccess
                        block
                      >
                        <p>{t("thread.acceptBody")}</p>
                        {thread.canSeeMoney ? null : <p className="ed-small ed-muted">{t("thread.acceptNoFinance")}</p>}
                      </SpecForm>
                    </SheetTrigger>
                  )
              : undefined
          }
        />

        {open && thread.canManage ? (
          <div className={styles.replyForm}>
            <SpecForm
              action={replyPlannerAction}
              hidden={hidden}
              fields={[{ kind: "textarea", name: "body", label: t("thread.reply"), hint: t("thread.replyHint"), required: true, maxLength: 4000, rows: 5 }]}
              submitLabel={t("thread.send")}
              pendingLabel={t("thread.sending")}
              success={t("thread.sent")}
              refreshOnSuccess
            />
          </div>
        ) : null}
        {!open ? <Notice title={t("thread.closedNotice")} /> : null}
        {open && !thread.canManage ? <p className="ed-small ed-muted">{t("thread.readOnly")}</p> : null}
      </Section>

      {open && thread.canManage ? (
        <Section>
          {thread.canResend ? (
            <Notice tone="attention" title={t("thread.resendTitle")}>
              <p>{t("thread.resendBody")}</p>
              <SpecForm action={resendEnquiryAction} hidden={hidden} fields={[]} submitLabel={t("thread.resend")} pendingLabel={t("thread.resending")} variant="secondary" refreshOnSuccess />
            </Notice>
          ) : thread.resentAt ? (
            <p className="ed-small ed-muted">{t("thread.resent", { date: formatDate(thread.resentAt, ctx.locale) })}</p>
          ) : thread.resendFrom ? (
            <p className="ed-small ed-muted">{t("thread.resendFrom", { date: formatDate(thread.resendFrom, ctx.locale) })}</p>
          ) : null}
          <div className={styles.tools}>
            <SheetTrigger label={t("thread.close")} title={t("thread.closeTitle")} closeLabel={t("thread.keep")} variant="quiet">
              <SpecForm action={closeEnquiryAction} hidden={hidden} fields={[]} submitLabel={t("thread.closeConfirm")} pendingLabel={t("thread.closing")} variant="danger" refreshOnSuccess block>
                <p>{t("thread.closeBody")}</p>
              </SpecForm>
            </SheetTrigger>
            <SheetTrigger label={t("thread.report")} title={t("thread.reportTitle")} closeLabel={tc("actions.close")} variant="quiet">
              <ReportForm enquiryId={thread.id} occasionId={id} />
            </SheetTrigger>
          </div>
        </Section>
      ) : null}
    </>
  );
}
