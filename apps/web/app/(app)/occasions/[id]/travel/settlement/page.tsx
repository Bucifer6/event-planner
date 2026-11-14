import { getOccasionView } from "@ed/core/occasions";
import { getTripSettlement, TRIP_CURRENCIES } from "@ed/core/subgroups";
import { instantToDay } from "@ed/core/templates";
import { formatMoney } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Notice, PageHeader, Section, Table } from "@ed/ui";
import { IconArrowRight, IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { addTripCostAction, setExchangeNoteAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { SheetForm } from "../_components/forms";
import { Tabs, travelTabs } from "../_components/Tabs";
import styles from "../_components/travel.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("settlement.title") };
}

/**
 * D-05: who paid, who owes and who gives whom — per participant AND per currency, from the one
 * ledger. Currencies are never merged: an exchange-rate note is only an annotation. Without the
 * finance grant a member sees their own line only (D2).
 */
export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const { occasion } = await orNotFound(getOccasionView(ctx, id));
  const s = await getTripSettlement(ctx, id);
  const all = s.scope === "all";
  const open = occasion.status !== "closed";
  const money = (minor: number, currency: string) => formatMoney(minor, currency, ctx.locale);
  const net = (minor: number, currency: string) => (minor === 0 ? t("settlement.even") : minor > 0 ? t("settlement.toReceive", { amount: money(minor, currency) }) : t("settlement.toPay", { amount: money(-minor, currency) }));
  const ledgerLink = (
    <Link href={`/occasions/${id}/ledger`} className={buttonClassName({ variant: "secondary" })}>
      {t("settlement.openLedger")} <IconArrowRight />
    </Link>
  );
  const addCost =
    all && open && s.participants.length >= 2 ? (
      <SheetForm
        label={t("settlement.addCost")}
        title={t("settlement.addCostTitle")}
        closeLabel={tc("actions.close")}
        variant="primary"
        icon={<IconPlus />}
        form={{
          id: "trip-cost",
          action: addTripCostAction,
          hidden: { occasionId: id },
          idempotencyField: "idempotencyKey",
          optionalLabel: tc("optional"),
          pendingLabel: tc("status.saving"),
          submitLabel: t("settlement.addCostSubmit"),
          fields: [
            { name: "description", label: t("settlement.what"), required: true, maxLength: 200, placeholder: t("settlement.whatExample") },
            { name: "amount", label: t("settlement.amount"), type: "decimal", required: true, maxLength: 14 },
            { name: "currency", label: t("settlement.currency"), type: "select", defaultValue: "RON", options: TRIP_CURRENCIES.map((c) => ({ value: c, label: c })) },
            { name: "currencyOther", label: t("settlement.currencyOther"), hint: t("settlement.currencyOtherHint"), maxLength: 3, placeholder: "CHF" },
            { name: "paidBy", label: t("settlement.paidBy"), type: "select", options: s.participants.map((p) => ({ value: p.id, label: p.name })) },
            { name: "occurredOn", label: t("settlement.date"), type: "date", required: true, defaultValue: instantToDay(ctx.now, occasion.timezone) },
            { name: "participantIds", label: t("settlement.for"), hint: t("settlement.forHint"), type: "checks", options: s.participants.map((p) => ({ value: p.id, label: p.name })), defaultChecked: s.participants.map((p) => p.id) },
          ],
        }}
      />
    ) : null;

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("settlement.title")} description={all ? t("settlement.description") : t("settlement.descriptionOwn")} actions={addCost ?? undefined} />
      <Tabs items={travelTabs(id, t)} current="settlement" label={t("tabs.label")} />
      {!all ? <Notice>{t("settlement.ownNotice")}</Notice> : null}
      {s.currencies.length > 1 ? <Notice>{t("settlement.separateNotice", { count: s.currencies.length })}</Notice> : null}

      {s.currencies.length === 0 ? (
        <EmptyState title={all ? (s.participants.length < 2 ? t("settlement.noPeopleTitle") : t("settlement.emptyTitle")) : s.isParticipant ? t("settlement.emptyTitle") : t("settlement.notParticipantTitle")} action={all ? (s.participants.length < 2 ? ledgerLink : (addCost ?? undefined)) : undefined}>
          {all ? (s.participants.length < 2 ? t("settlement.noPeopleBody") : t("settlement.emptyBody")) : s.isParticipant ? t("settlement.emptyBodyOwn") : t("settlement.notParticipantBody")}
        </EmptyState>
      ) : (
        s.currencies.map((c) => (
          <Section key={c.currency} title={t("settlement.currencyTitle", { currency: c.currency })} eyebrow={c.totalCostMinor !== undefined ? t("settlement.total", { amount: money(c.totalCostMinor, c.currency) }) : undefined}>
            {c.exchangeNote ? (
              <p className={styles.note}>
                <span className="ed-label">{t("settlement.noteLabel")}</span>
                <br />
                {c.exchangeNote} — {t("settlement.noteOnly")}
              </p>
            ) : null}
            <Table caption={t("settlement.tableCaption", { currency: c.currency })}>
              <thead>
                <tr>
                  <th scope="col">{t("settlement.cols.who")}</th>
                  {all ? (
                    <>
                      <th scope="col" className="ed-right">
                        {t("settlement.cols.paid")}
                      </th>
                      <th scope="col" className="ed-right">
                        {t("settlement.cols.owes")}
                      </th>
                    </>
                  ) : null}
                  <th scope="col" className="ed-right">
                    {t("settlement.cols.net")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.participantId}>
                    <th scope="row">
                      {l.name}
                      {l.isMe && all ? <span className="ed-small ed-muted"> · {t("settlement.you")}</span> : null}
                    </th>
                    {all ? (
                      <>
                        <td className={`ed-right ${styles.amount}`}>{money(l.paidMinor ?? 0, c.currency)}</td>
                        <td className={`ed-right ${styles.amount}`}>{money(l.owesMinor ?? 0, c.currency)}</td>
                      </>
                    ) : null}
                    <td className="ed-right">{net(l.netMinor, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <h4 className="ed-label">{t("settlement.whoPaysWhom")}</h4>
            {c.transfers.length === 0 ? (
              <p className="ed-muted">{t("settlement.settled")}</p>
            ) : (
              <ul className={styles.people}>
                {c.transfers.map((x, i) => (
                  <li key={i}>
                    <span className={styles.transfer}>{t("settlement.transfer", { from: x.from, to: x.to })}</span>
                    <strong className={styles.amount}>{money(x.amountMinor, c.currency)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {all && open ? (
              <div className={styles.rowActions}>
                <SheetForm
                  label={c.exchangeNote ? t("settlement.editNote") : t("settlement.addNote")}
                  title={t("settlement.noteTitle", { currency: c.currency })}
                  closeLabel={tc("actions.close")}
                  variant="quiet"
                  intro={t("settlement.noteIntro")}
                  form={{
                    id: `note-${c.currency}`,
                    action: setExchangeNoteAction,
                    hidden: { occasionId: id, currency: c.currency },
                    optionalLabel: tc("optional"),
                    pendingLabel: tc("status.saving"),
                    submitLabel: tc("actions.save"),
                    fields: [{ name: "note", label: t("settlement.noteField"), maxLength: 200, defaultValue: c.exchangeNote ?? "", placeholder: t("settlement.noteExample") }],
                  }}
                />
              </div>
            ) : null}
          </Section>
        ))
      )}
      {all && s.currencies.length > 0 ? <div>{ledgerLink}</div> : null}
    </div>
  );
}
