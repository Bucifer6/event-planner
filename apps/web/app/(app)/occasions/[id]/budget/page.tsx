import { isManager } from "@ed/core/access";
import { getBudget, presetsForKind, type BudgetRow, type BudgetTotals } from "@ed/core/budget";
import { listExpenses, RECEIPT_RETENTION_YEARS } from "@ed/core/expenses";
import { getOccasionView } from "@ed/core/occasions";
import { instantToDay } from "@ed/core/templates";
import { formatDate, formatMoney } from "@ed/i18n/format";
import { BarList, Card, EmptyState, Figure, Figures, List, Notice, PageHeader, Section, Table, Tag, Unknown, type Tone } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { AddExpense, CategorySheet, PresetChips } from "./BudgetForms";
import { formatDayKey, moneyParts } from "./_lib/format";
import { amountFieldValue } from "./_lib/money";
import styles from "./money.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("budget"))("title") };
}

const APPROVAL_TONE: Record<string, Tone> = { pending: "attention", approved: "success", rejected: "danger" };

/**
 * Budget (B1) and expenses (B2). Finance-grant holders only: anyone else gets "not found"
 * (D2). Leads with the one number — paid so far out of the estimate — then the other amounts,
 * always separate: estimate, committed, invoiced, paid, forecast.
 */
export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("budget");
  const c = await getTranslations("common");
  const budget = await orNotFound(getBudget(ctx, id));
  const [expenses, { occasion, member }] = await Promise.all([listExpenses(ctx, id), getOccasionView(ctx, id)]);
  const locale = ctx.locale;
  const closed = occasion.status === "closed";
  const today = instantToDay(ctx.now, occasion.timezone);
  const todayText = formatDate(ctx.now, locale, occasion.timezone);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const orUnknown = (minor: number | null, currency: string) => (minor === null ? <Unknown label={c("unknown")} /> : money(minor, currency));

  const main = budget.totals[0]!;
  const others = budget.totals.slice(1);
  const categories = budget.categories.map((cat) => ({ id: cat.id, name: cat.name }));
  const categoryName = new Map(categories.map((cat) => [cat.id, cat.name]));
  const usedPresets = new Set(budget.categories.map((cat) => cat.presetKey));
  const usedNames = new Set(budget.categories.map((cat) => cat.name.toLowerCase()));
  const presetOptions = presetsForKind(occasion.kind)
    .filter((key) => !usedPresets.has(key) && !usedNames.has(t(`presets.${key}`).toLowerCase()))
    .map((key) => ({ value: key, label: t(`presets.${key}`) }));

  const paid = moneyParts(main.paidMinor, main.currency, locale);
  const heroNote =
    main.estimateMinor === null
      ? t("hero.noEstimate")
      : main.estimateUnknown > 0
        ? t("hero.ofEstimatePartial", { estimate: money(main.estimateMinor, main.currency), count: main.estimateUnknown })
        : t("hero.ofEstimate", { estimate: money(main.estimateMinor, main.currency) });

  const unpaidInvoiced = main.invoicedMinor - main.paidMinor;
  const forecastDiff = main.forecastMinor !== null && main.estimateMinor !== null ? main.forecastMinor - main.estimateMinor : null;
  const forecastNote =
    main.forecastMinor === null
      ? t("figures.forecastUnknown")
      : forecastDiff === null
        ? main.forecastUnknown > 0
          ? t("figures.forecastPartial", { count: main.forecastUnknown })
          : undefined
        : forecastDiff > 0
          ? t("figures.forecastOver", { amount: money(forecastDiff, main.currency) })
          : forecastDiff < 0
            ? t("figures.forecastUnder", { amount: money(-forecastDiff, main.currency) })
            : t("figures.forecastEqual");

  const figure = (minor: number | null, currency: string) => {
    if (minor === null) return { value: <Unknown label={c("unknown")} />, unit: undefined };
    return moneyParts(minor, currency, locale);
  };
  const estimate = figure(main.estimateMinor, main.currency);
  const forecast = figure(main.forecastMinor, main.currency);
  const committed = moneyParts(main.committedMinor, main.currency, locale);
  const invoiced = moneyParts(main.invoicedMinor, main.currency, locale);

  const bars = budget.rows
    .filter((r) => r.categoryId !== null && r.estimateMinor !== null && r.estimateMinor > 0 && r.currency === main.currency)
    .map((r) => ({ key: r.categoryId!, label: r.name, value: r.estimateMinor!, display: money(r.estimateMinor!, r.currency) }));
  const largest = bars.reduce((m, b) => Math.max(m, b.value), 0);

  const rowLabel = (r: BudgetRow) => (r.name ?? t("table.uncategorised")) + (r.currency !== main.currency ? ` · ${r.currency}` : "");
  const totalRow = (tot: BudgetTotals) => (
    <tr key={tot.currency}>
      <td>{budget.totals.length > 1 ? `${t("table.total")} · ${tot.currency}` : t("table.total")}</td>
      <td data-num>{orUnknown(tot.estimateMinor, tot.currency)}</td>
      <td data-num>{money(tot.committedMinor, tot.currency)}</td>
      <td data-num>{money(tot.invoicedMinor, tot.currency)}</td>
      <td data-num>{money(tot.paidMinor, tot.currency)}</td>
      <td data-num>{orUnknown(tot.forecastMinor, tot.currency)}</td>
      <td />
    </tr>
  );

  const addExpense = (variant: "primary" | "secondary") =>
    closed ? null : (
      <AddExpense occasionId={id} categories={categories} today={today} canUpload={isManager(member)} retentionYears={RECEIPT_RETENTION_YEARS} variant={variant} />
    );

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} actions={addExpense("primary")} />
      {closed ? <Notice>{t("closedNotice")}</Notice> : null}

      <Card framed className={styles.hero}>
        <Figure size="hero" label={t("hero.label", { date: todayText })} value={paid.value} unit={paid.unit} note={heroNote} />
      </Card>
      <Figures>
        <Figure
          size="sm"
          label={t("figures.estimate")}
          value={estimate.value}
          unit={estimate.unit}
          note={budget.categories.length === 0 ? undefined : main.estimateUnknown > 0 ? t("figures.estimatePartial", { count: main.estimateUnknown }) : t("figures.estimateAll")}
        />
        <Figure size="sm" label={t("figures.committed")} value={committed.value} unit={committed.unit} note={t("figures.committedNote")} />
        <Figure
          size="sm"
          label={t("figures.invoiced")}
          value={invoiced.value}
          unit={invoiced.unit}
          note={unpaidInvoiced > 0 ? t("figures.invoicedUnpaid", { amount: money(unpaidInvoiced, main.currency) }) : main.invoicedMinor > 0 ? t("figures.invoicedAllPaid") : undefined}
        />
        <Figure
          size="sm"
          label={t("figures.forecast")}
          value={forecast.value}
          unit={forecast.unit}
          note={forecastNote}
          noteTone={forecastDiff !== null && forecastDiff > 0 ? "danger" : forecastDiff !== null && forecastDiff < 0 ? "success" : undefined}
        />
      </Figures>
      {others.map((tot) => (
        <p key={tot.currency} className="ed-small ed-muted">
          {t("figures.otherCurrency", { currency: tot.currency })}: {t("table.committed")} {money(tot.committedMinor, tot.currency)} · {t("table.invoiced")}{" "}
          {money(tot.invoicedMinor, tot.currency)} · {t("table.paid")} {money(tot.paidMinor, tot.currency)}
        </p>
      ))}

      <Section title={t("table.title")} level={3} actions={closed ? undefined : <CategorySheet occasionId={id} label={t("categories.new")} />}>
        {budget.rows.length === 0 ? (
          <EmptyState title={t("categories.emptyTitle")}>{t("categories.emptyBody")}</EmptyState>
        ) : (
          <>
            <Table caption={t("table.caption")}>
              <thead>
                <tr>
                  <th scope="col">{t("table.category")}</th>
                  <th scope="col" data-num>
                    {t("table.estimate")}
                  </th>
                  <th scope="col" data-num>
                    {t("table.committed")}
                  </th>
                  <th scope="col" data-num>
                    {t("table.invoiced")}
                  </th>
                  <th scope="col" data-num>
                    {t("table.paid")}
                  </th>
                  <th scope="col" data-num>
                    {t("table.forecast")}
                  </th>
                  <th scope="col">
                    <span className="ed-vh">{t("table.edit")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.rows.map((r) => {
                  const own = r.categoryId !== null && budget.categories.find((cat) => cat.id === r.categoryId)?.currency === r.currency;
                  const cat = own ? budget.categories.find((x) => x.id === r.categoryId)! : null;
                  return (
                    <tr key={`${r.categoryId ?? "none"}-${r.currency}`}>
                      <td>
                        <span className={styles.catName}>{rowLabel(r)}</span>
                      </td>
                      <td data-num>{own ? orUnknown(r.estimateMinor, r.currency) : null}</td>
                      <td data-num>{money(r.committedMinor, r.currency)}</td>
                      <td data-num>{money(r.invoicedMinor, r.currency)}</td>
                      <td data-num>{money(r.paidMinor, r.currency)}</td>
                      <td data-num>
                        {own ? orUnknown(r.forecastMinor, r.currency) : null}
                        {r.overrunMinor !== null ? <span className={styles.rowNote}>{t("table.overrun", { amount: money(r.overrunMinor, r.currency) })}</span> : null}
                      </td>
                      <td>
                        {cat && !closed ? (
                          <CategorySheet
                            occasionId={id}
                            label={t("table.edit")}
                            variant="quiet"
                            category={{ id: cat.id, name: cat.name, estimate: amountFieldValue(cat.estimateMinor, locale), forecast: amountFieldValue(cat.forecastMinor, locale) }}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>{budget.totals.map(totalRow)}</tfoot>
            </Table>
            <p className={`ed-small ed-muted ${styles.legend}`}>{t("table.legend")}</p>
          </>
        )}
      </Section>

      {bars.length >= 2 ? (
        <Section title={t("bars.title")} level={3}>
          <div className={styles.narrow}>
            <BarList items={bars.map((b) => ({ ...b, highlight: b.value === largest }))} />
            <p className={`ed-small ed-muted ${styles.legend}`}>{t("bars.note")}</p>
          </div>
        </Section>
      ) : null}

      {!closed && presetOptions.length > 0 ? (
        <Section title={t("categories.addTitle")} level={3}>
          <PresetChips occasionId={id} options={presetOptions} />
        </Section>
      ) : null}

      <Section title={t("expenses.title")} level={3} id="expenses">
        {expenses.length === 0 ? (
          <EmptyState title={t("expenses.emptyTitle")} action={addExpense("secondary")}>
            {t("expenses.emptyBody")}
          </EmptyState>
        ) : (
          <>
            <List>
              {expenses.map((e) => (
                <li className="ed-row" key={e.id}>
                  <div className="ed-row__main">
                    <Link href={`/occasions/${id}/budget/expenses/${e.id}`} className={styles.rowLink}>
                      <span className={`ed-row__title ${styles.rowTitle ?? ""}`}>{e.description}</span>
                    </Link>
                    <span className="ed-row__meta">
                      {[formatDayKey(e.spentOn, locale), e.categoryId ? categoryName.get(e.categoryId) : t("expenses.noCategory"), e.supplierLabel].filter(Boolean).join(" · ")}
                    </span>
                    <span className={styles.tagsStart}>
                      <Tag tone={APPROVAL_TONE[e.approvalState]}>{t(`expenses.approval.${e.approvalState}`)}</Tag>
                      <Tag tone={e.paymentState === "paid" ? "success" : "neutral"}>{t(`expenses.payment.${e.paymentState}`)}</Tag>
                    </span>
                  </div>
                  <div className="ed-row__end">
                    <span className={styles.amount}>{money(e.amountMinor, e.currency)}</span>
                  </div>
                </li>
              ))}
            </List>
            <p className={`ed-small ed-muted ${styles.legend}`}>{t("expenses.independent")}</p>
          </>
        )}
      </Section>
    </>
  );
}
