import { isManager } from "@ed/core/access";
import { listCategories } from "@ed/core/budget";
import { getExpense, getReceiptUrl, listExpenseCorrections, RECEIPT_RETENTION_YEARS } from "@ed/core/expenses";
import { getOccasionView } from "@ed/core/occasions";
import { instantToDay } from "@ed/core/templates";
import { formatDateTime, formatMoney } from "@ed/i18n/format";
import { Card, DescriptionList, ExternalLink, Figure, Notice, PageHeader, Section, Stack, Tag, type Tone } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../../_lib/load";
import { ApprovalButtons, CorrectPaid, DeleteExpense, EditExpense, MarkPaid } from "../../BudgetForms";
import { formatDayKey, moneyParts } from "../../_lib/format";
import { amountFieldValue } from "../../_lib/money";
import styles from "../../money.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("budget"))("expenses.detailEyebrow") };
}

const APPROVAL_TONE: Record<string, Tone> = { pending: "attention", approved: "success", rejected: "danger" };

/**
 * One expense (B2): its two independent states, the receipt, and — once paid — the correction
 * path with its history (principle 4). Finance-grant holders only.
 */
export default async function ExpensePage({ params }: { params: Promise<{ id: string; expenseId: string }> }) {
  const { id, expenseId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("budget.expenses");
  const k = await getTranslations("corrections");
  const expense = await orNotFound(getExpense(ctx, expenseId));
  if (expense.occasionId !== id) notFound();
  const [{ occasion, member }, categories, corrections, receiptUrl] = await Promise.all([
    getOccasionView(ctx, id),
    listCategories(ctx, id),
    listExpenseCorrections(ctx, expense.id),
    getReceiptUrl(ctx, expense.id).catch(() => null),
  ]);
  const locale = ctx.locale;
  const closed = occasion.status === "closed";
  const manager = isManager(member);
  const paid = expense.paymentState === "paid";
  const today = instantToDay(ctx.now, occasion.timezone);
  const amount = moneyParts(expense.amountMinor, expense.currency, locale);
  const category = categories.find((cat) => cat.id === expense.categoryId);

  const correctionValue = (field: string, value: unknown): string => {
    if (field === "amountMinor" && typeof value === "number") return formatMoney(value, expense.currency, locale);
    if (field === "paymentState" && value && typeof value === "object") {
      return (value as { paymentState?: string }).paymentState === "paid" ? t("correct.wasPaid") : t("correct.nowUnpaid");
    }
    return String(value ?? "");
  };

  return (
    <div className={styles.narrow}>
      <p style={{ marginBottom: "var(--s-3)" }}>
        <Link href={`/occasions/${id}/budget#expenses`}>{t("back")}</Link>
      </p>
      <PageHeader level={2} eyebrow={t("detailEyebrow")} title={expense.description} />

      <Card framed className={styles.hero}>
        <Stack gap={3}>
          <Figure
            label={`${t("fields.amount")} · ${formatDayKey(expense.spentOn, locale)}`}
            value={amount.value}
            unit={amount.unit}
            note={paid && expense.paidOn ? t("paidOn", { date: formatDayKey(expense.paidOn, locale) }) : t("payment.unpaid")}
            noteTone={paid ? "success" : undefined}
          />
          <div className="ed-cluster">
            <Tag tone={APPROVAL_TONE[expense.approvalState]}>{t(`approval.${expense.approvalState}`)}</Tag>
            <Tag tone={paid ? "success" : "neutral"}>{t(`payment.${expense.paymentState}`)}</Tag>
          </div>
        </Stack>
      </Card>

      <DescriptionList
        cols={2}
        items={[
          { term: t("fields.category"), value: category?.name ?? t("noCategory") },
          { term: t("fields.supplier"), value: expense.supplierLabel ?? "—" },
        ]}
      />

      <Section title={t("receipt")} level={3}>
        <Stack gap={2}>
          {receiptUrl ? (
            <p>
              <ExternalLink href={receiptUrl}>{t("receiptDownload")}</ExternalLink>
            </p>
          ) : (
            <p className="ed-muted">{t("receiptNone")}</p>
          )}
          <p className="ed-small ed-muted">{t("receiptRetention", { years: RECEIPT_RETENTION_YEARS })}</p>
        </Stack>
      </Section>

      {closed ? null : (
        <>
          <Section title={t("paymentLabel")} level={3}>
            {paid ? (
              <Stack gap={3}>
                <p style={{ maxWidth: "var(--measure)" }}>{t("correct.intro")}</p>
                {manager ? (
                  <div>
                    <CorrectPaid occasionId={id} expenseId={expense.id} amount={amountFieldValue(expense.amountMinor, locale)} />
                  </div>
                ) : null}
              </Stack>
            ) : (
              <MarkPaid occasionId={id} expenseId={expense.id} today={today} />
            )}
          </Section>

          <Section title={t("approvalLabel")} level={3}>
            <Stack gap={3}>
              <p className="ed-small ed-muted" style={{ maxWidth: "var(--measure)" }}>
                {t("independent")}
              </p>
              {manager ? <ApprovalButtons occasionId={id} expenseId={expense.id} state={expense.approvalState} /> : <Notice>{t("approvalManagersOnly")}</Notice>}
            </Stack>
          </Section>
        </>
      )}

      {corrections.length > 0 || paid ? (
        <Section title={t("correct.historyTitle")} level={3}>
          {corrections.length === 0 ? (
            <p className="ed-muted">{t("correct.historyEmpty")}</p>
          ) : (
            <ul className={styles.history}>
              {corrections.map((cor) => (
                <li key={cor.id}>
                  <Stack gap={1}>
                    <span className="ed-label">{cor.field === "amountMinor" ? t("correct.fieldAmount") : t("correct.fieldPayment")}</span>
                    <span>
                      <span className={styles.voided}>{correctionValue(cor.field, cor.before)}</span> → <strong>{correctionValue(cor.field, cor.after)}</strong>
                    </span>
                    <span>
                      {k("reason")}: {cor.reason}
                    </span>
                    <span className="ed-small ed-muted">{k("by", { date: formatDateTime(cor.createdAt, locale) })}</span>
                  </Stack>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {closed ? null : (
        <Section level={3}>
          <div className="ed-cluster">
            <EditExpense
              occasionId={id}
              categories={categories.map((cat) => ({ id: cat.id, name: cat.name }))}
              canUpload={manager}
              retentionYears={RECEIPT_RETENTION_YEARS}
              expense={{
                id: expense.id,
                description: expense.description,
                amount: amountFieldValue(expense.amountMinor, locale),
                spentOn: expense.spentOn,
                categoryId: expense.categoryId ?? "",
                supplierLabel: expense.supplierLabel ?? "",
                paid,
                hasReceipt: !!expense.receiptAssetId,
              }}
            />
            {paid ? null : <DeleteExpense occasionId={id} expenseId={expense.id} name={expense.description} />}
          </div>
        </Section>
      )}
    </div>
  );
}
