import { listPaymentDeadlines, type PaymentView } from "@ed/core/payments";
import { listSuppliers } from "@ed/core/suppliers";
import { formatMoney } from "@ed/i18n/format";
import { EmptyState, List, PageHeader, Section, Tag, Unknown } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createSupplierAction } from "@/app/actions/suppliers";
import { requireCtx } from "@/lib/ctx";
import { FormSheet } from "../guests/_components/form";
import { orNotFound } from "../../_lib/load";
import styles from "./_components/suppliers.module.css";
import { STATE_TONE } from "./_components/tones";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("suppliers"))("title") };
}

const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** B4, B12: every supplier with the state of its booking, the agreed amount and the next payment. */
export default async function SuppliersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("suppliers");
  const tc = await getTranslations("common");
  const list = await orNotFound(listSuppliers(ctx, id));
  const payments: PaymentView[] = list.canSeeMoney ? (await listPaymentDeadlines(ctx, id)).filter((p) => p.overdue || p.soon) : [];
  const base = `/occasions/${id}/suppliers`;

  const add = list.canManage ? (
    <FormSheet
      label={t("list.add")}
      title={t("list.addTitle")}
      closeLabel={tc("actions.close")}
      variant="primary"
      icon={<IconPlus size={18} />}
      form={{
        id: "add-supplier",
        action: createSupplierAction,
        hidden: { occasionId: id },
        optionalLabel: tc("optional"),
        submitLabel: t("list.addSubmit"),
        pendingLabel: tc("status.saving"),
        redirectTo: `${base}/{supplierId}`,
        fields: [
          { name: "name", label: t("fields.name"), required: true, maxLength: 160 },
          { name: "categoryLabel", label: t("fields.category"), hint: t("fields.categoryHint"), maxLength: 80 },
          { name: "contactName", label: t("fields.contactName"), maxLength: 160, autoComplete: "off" },
          { name: "contactPhone", label: t("fields.contactPhone"), maxLength: 40 },
          { name: "contactEmail", label: t("fields.contactEmail"), type: "email", maxLength: 254 },
        ],
      }}
    />
  ) : null;

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("list.description")} actions={list.items.length > 0 ? add : null} />

      {payments.length > 0 ? (
        <Section title={t("payments.attentionTitle")} level={3}>
          <List>
            {payments.map((p) => (
              <li key={p.id} className="ed-row">
                <Link href={`${base}/${p.supplierId}#plati`} className={styles.rowLink}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{p.supplierName}</span>
                    <span className={styles.rowMeta}>
                      {t(`payments.kinds.${p.kind}`)} · {t("payments.dueOn", { date: day(p.dueOn) })}
                    </span>
                  </span>
                  <span className={styles.rowEnd}>
                    <Tag tone={p.overdue ? "danger" : "attention"}>{t(p.overdue ? "payments.overdue" : "payments.soon")}</Tag>
                    <span className={styles.amount}>{p.amountMinor === null ? <Unknown label={tc("unknown")} /> : formatMoney(p.amountMinor, p.currency, ctx.locale)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </List>
        </Section>
      ) : null}

      {list.items.length === 0 ? (
        <EmptyState title={t("list.emptyTitle")} action={add}>
          {list.canManage ? t("list.emptyBody") : t("list.emptyBodyReadOnly")}
        </EmptyState>
      ) : (
        <Section title={payments.length > 0 ? t("list.allTitle") : undefined} level={3}>
        <List>
          {list.items.map((s) => (
            <li key={s.id} className="ed-row">
              <Link href={`${base}/${s.id}`} className={styles.rowLink}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{s.name}</span>
                  <span className={styles.rowMeta}>{[s.categoryLabel, s.contactName, s.contactPhone].filter(Boolean).join(" · ") || t("list.noContact")}</span>
                  <span className={styles.rowMeta}>
                    {s.briefing.latestVersion === null
                      ? t("list.noBriefing")
                      : s.briefing.acknowledgedVersion === s.briefing.latestVersion
                        ? t("list.briefingAcked", { version: s.briefing.latestVersion })
                        : t("list.briefingNotAcked", { version: s.briefing.latestVersion })}
                  </span>
                  {s.nextPayment ? (
                    <span className={styles.rowMeta}>
                      {t(s.nextPayment.overdue ? "list.paymentOverdue" : "list.nextPayment", { date: day(s.nextPayment.dueOn) })}
                      {s.nextPayment.amountMinor !== null ? ` · ${formatMoney(s.nextPayment.amountMinor, s.nextPayment.currency, ctx.locale)}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className={styles.rowEnd}>
                  <Tag tone={STATE_TONE[s.booking.state]}>{t(`states.${s.booking.state}`)}</Tag>
                  {s.booking.agreedMinor !== undefined ? (
                    <span className={styles.amount}>
                      {s.booking.agreedMinor === null ? <Unknown label={tc("unknown")} /> : formatMoney(s.booking.agreedMinor, s.booking.currency, ctx.locale)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </List>
        </Section>
      )}
    </>
  );
}
