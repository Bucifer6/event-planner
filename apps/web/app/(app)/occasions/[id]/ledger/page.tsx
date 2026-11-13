import { isManager } from "@ed/core/access";
import { getLedger, listParticipantCandidates } from "@ed/core/ledger";
import { getOccasionView } from "@ed/core/occasions";
import { instantToDay } from "@ed/core/templates";
import { formatDate, formatMoney } from "@ed/i18n/format";
import { Card, EmptyState, Figure, List, Notice, PageHeader, Row, Section, Stack, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { plural } from "../../_lib/plural";
import { formatDayKey, moneyParts } from "../budget/_lib/format";
import styles from "../budget/money.module.css";
import { AddParticipant, AddSharedCost, RecordTransfer, RemoveParticipant, VoidEntry } from "./LedgerForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ledger"))("title") };
}

/**
 * Shared costs (B3): one balanced ledger. Leads with the total shared so far and how many
 * payments settle it, then who owes whom per currency, the participants and every entry.
 * Finance-grant holders only (D2).
 */
export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("ledger");
  const ledger = await orNotFound(getLedger(ctx, id));
  const [candidates, { occasion, member }] = await Promise.all([listParticipantCandidates(ctx, id), getOccasionView(ctx, id)]);
  const locale = ctx.locale;
  const closed = occasion.status === "closed";
  const manager = isManager(member);
  const today = instantToDay(ctx.now, occasion.timezone);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const name = new Map(ledger.participants.map((p) => [p.id, p.name]));
  const people = ledger.participants.map((p) => ({ id: p.id, name: p.name }));
  const used = new Set(ledger.entries.flatMap((e) => [e.paidByParticipantId, ...e.shares.map((s) => s.participantId)]));

  const main = ledger.settlements[0];
  const total = moneyParts(main?.totalCostMinor ?? 0, main?.currency ?? "RON", locale);
  const transferCount = ledger.settlements.reduce((n, s) => n + s.transfers.length, 0);
  const liveEntries = ledger.entries.filter((e) => !e.voidedAt).length;
  const heroNote = transferCount === 0 ? t("hero.settled") : t(`hero.transfers.${plural(transferCount, locale)}`, { count: transferCount });

  const canAddCost = !closed && people.length >= 2;
  const addCost = (variant: "primary" | "secondary") => (canAddCost ? <AddSharedCost occasionId={id} participants={people} today={today} variant={variant} /> : null);
  const addPerson = (variant: "primary" | "secondary") =>
    closed ? null : <AddParticipant occasionId={id} members={candidates.members} households={candidates.households} variant={variant} />;

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} actions={addCost("primary")} />
      {closed ? <Notice>{t("closedNotice")}</Notice> : null}

      {people.length === 0 ? (
        <EmptyState title={t("participants.emptyTitle")} action={addPerson("primary")}>
          {t("participants.emptyBody")}
        </EmptyState>
      ) : (
        <>
          <Card framed className={styles.hero}>
            <Figure
              size="hero"
              label={t("hero.label", { date: formatDate(ctx.now, locale, occasion.timezone) })}
              value={total.value}
              unit={total.unit}
              note={`${heroNote} ${t("hero.entries", { count: liveEntries })}`}
            />
          </Card>

          {ledger.settlements.length === 0 ? (
            <Section title={t("settlement.title")} level={3}>
              <EmptyState title={t("settlement.settledTitle")}>{t("settlement.settledBody")}</EmptyState>
            </Section>
          ) : (
            ledger.settlements.map((s) => (
              <Section key={s.currency} title={ledger.settlements.length > 1 ? t("settlement.titleCurrency", { currency: s.currency }) : t("settlement.title")} level={3}>
                <Stack gap={4}>
                  {s.transfers.length === 0 ? (
                    <EmptyState title={t("settlement.settledTitle")}>{t("settlement.settledBody")}</EmptyState>
                  ) : (
                    <List>
                      {s.transfers.map((tr) => (
                        <Row
                          key={`${tr.fromParticipantId}-${tr.toParticipantId}`}
                          title={t("settlement.pays", { from: name.get(tr.fromParticipantId) ?? "", to: name.get(tr.toParticipantId) ?? "" })}
                          meta={<span className={styles.amount}>{money(tr.amountMinor, s.currency)}</span>}
                          end={closed ? undefined : <RecordTransfer occasionId={id} from={tr.fromParticipantId} to={tr.toParticipantId} amountMinor={tr.amountMinor} currency={s.currency} />}
                        />
                      ))}
                    </List>
                  )}
                  <div className={styles.narrow}>
                    <Table caption={t("settlement.balancesCaption", { currency: s.currency })}>
                      <thead>
                        <tr>
                          <th scope="col">{t("settlement.participant")}</th>
                          <th scope="col" data-num>
                            {t("settlement.balance")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...s.balances]
                          .sort((a, b) => b.balanceMinor - a.balanceMinor)
                          .map((b) => (
                            <tr key={b.participantId}>
                              <td>{name.get(b.participantId)}</td>
                              <td data-num>
                                {b.balanceMinor === 0
                                  ? t("settlement.even")
                                  : `${b.balanceMinor > 0 ? t("settlement.toReceive") : t("settlement.toPay")} ${money(Math.abs(b.balanceMinor), s.currency)}`}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </Table>
                    <p className={`ed-small ed-muted ${styles.legend}`}>{t("settlement.sumNote")}</p>
                  </div>
                </Stack>
              </Section>
            ))
          )}

          <Section title={t("participants.title")} level={3} actions={addPerson("secondary")}>
            <ul className={styles.people}>
              {ledger.participants.map((p) => (
                <li key={p.id} className={`${styles.person} ${used.has(p.id) || closed ? styles.personPlain : ""}`}>
                  <span>{p.name}</span>
                  {used.has(p.id) || closed ? null : <RemoveParticipant occasionId={id} participantId={p.id} name={p.name} />}
                </li>
              ))}
            </ul>
            {people.length < 2 && !closed ? <p className={`ed-small ed-muted ${styles.legend}`}>{t("entries.needTwo")}</p> : null}
          </Section>

          <Section title={t("entries.title")} level={3}>
            {ledger.entries.length === 0 ? (
              <EmptyState title={t("entries.emptyTitle")} action={addCost("secondary")}>
                {t("entries.emptyBody")}
              </EmptyState>
            ) : (
              <List>
                {ledger.entries.map((e) => {
                  const settlement = e.kind === "settlement";
                  const title = settlement
                    ? t("entries.settlementTitle", { from: name.get(e.paidByParticipantId) ?? "", to: name.get(e.shares[0]?.participantId ?? "") ?? "" })
                    : e.description;
                  const meta = settlement
                    ? t("entries.settlementMeta", { date: formatDayKey(e.occurredOn, locale) })
                    : t("entries.meta", { date: formatDayKey(e.occurredOn, locale), payer: name.get(e.paidByParticipantId) ?? "", count: e.shares.length });
                  return (
                    <Row
                      key={e.id}
                      title={<span className={e.voidedAt ? styles.voided : undefined}>{title}</span>}
                      meta={meta}
                      end={
                        <div className={styles.amountEnd}>
                          <span className={`${styles.amount} ${e.voidedAt ? styles.voided : ""}`}>{money(e.amountMinor, e.currency)}</span>
                          {e.voidedAt ? <Tag>{t("entries.voided")}</Tag> : manager && !closed ? <VoidEntry occasionId={id} entryId={e.id} name={settlement ? t("entries.settlementName") : e.description} /> : null}
                        </div>
                      }
                    />
                  );
                })}
              </List>
            )}
          </Section>
        </>
      )}
    </>
  );
}
