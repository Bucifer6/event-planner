import { listDeliveries, type DeliveryItemView, type DeliveryView } from "@ed/core/deliveries";
import { getOccasion } from "@ed/core/occasions";
import { instantToDay } from "@ed/core/templates";
import { formatDateTime, formatMoney, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { EmptyState, PageHeader, Tag, type Tone } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  addDeliveryItemAction,
  correctDepositRecoveredAction,
  correctReceivedQtyAction,
  correctReturnedQtyAction,
  createDeliveryAction,
  deleteDeliveryAction,
  markDepositRecoveredAction,
  recordReceiptAction,
  recordReturnAction,
  removeDeliveryItemAction,
} from "@/app/actions/deliveries";
import { requireCtx } from "@/lib/ctx";
import { FormSheet, PlannerForm } from "../guests/_components/form";
import { orNotFound } from "../../_lib/load";
import styles from "../suppliers/_components/suppliers.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("deliveries"))("title") };
}

const STATE_TONE: Record<DeliveryView["state"], Tone> = { expected: "neutral", partial: "attention", received: "success", returned: "success" };

/**
 * B6: deliveries, hired items and returns. What arrived is recorded once; after that the
 * number changes only through "Corectează cantitatea primită" — a correction with a reason,
 * whose history stays visible on the item (principle 4).
 */
export default async function DeliveriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("deliveries");
  const tc = await getTranslations("common");
  const [list, occasion] = await Promise.all([orNotFound(listDeliveries(ctx, id)), orNotFound(getOccasion(ctx, id))]);
  const tz = occasion.timezone;
  const occasionDay = occasion.startsAt ? instantToDay(occasion.startsAt, tz) : "";
  const hid = (extra: Record<string, string>) => ({ occasionId: id, ...extra });

  const add = list.canManage ? (
    <FormSheet
      label={t("add.open")}
      title={t("add.title")}
      closeLabel={tc("actions.close")}
      variant="primary"
      icon={<IconPlus size={18} />}
      form={{
        id: "add-delivery",
        action: createDeliveryAction,
        hidden: { occasionId: id },
        optionalLabel: tc("optional"),
        submitLabel: t("add.submit"),
        pendingLabel: tc("status.saving"),
        success: tc("status.saved"),
        fields: [
          { name: "title", label: t("fields.title"), hint: t("fields.titleHint"), required: true, maxLength: 200 },
          { name: "kind", label: t("fields.kind"), type: "select", defaultValue: "delivery", options: (["delivery", "hire", "return"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) })) },
          { name: "supplierId", label: t("fields.supplier"), type: "select", defaultValue: "", options: [{ value: "", label: t("fields.noSupplier") }, ...list.suppliers.map((s) => ({ value: s.id, label: s.name }))] },
          { name: "day", label: t("fields.day"), type: "date", defaultValue: occasionDay },
          { name: "fromTime", label: t("fields.fromTime"), hint: t("fields.timeHint"), maxLength: 5 },
          { name: "toTime", label: t("fields.toTime"), hint: t("fields.timeHint"), maxLength: 5 },
          { name: "place", label: t("fields.place"), hint: t("fields.placeHint"), maxLength: 300 },
          { name: "itemLabel", label: t("fields.itemLabel"), hint: t("fields.itemLabelHint"), maxLength: 200 },
          { name: "itemQty", label: t("fields.itemQty"), type: "number", maxLength: 7 },
          { name: "itemUnit", label: t("fields.itemUnit"), hint: t("fields.itemUnitHint"), maxLength: 30 },
          ...(list.canSeeMoney ? [{ name: "itemDeposit", label: t("fields.deposit"), hint: t("fields.depositHint"), maxLength: 20 }] : []),
        ],
      }}
    />
  ) : null;

  const slot = (d: DeliveryView) =>
    d.expectedFrom
      ? `${formatWeekdayDate(d.expectedFrom, ctx.locale, tz)}, ${formatTime(d.expectedFrom, ctx.locale, tz)}${d.expectedTo ? `–${formatTime(d.expectedTo, ctx.locale, tz)}` : ""}`
      : null;

  const qtyText = (n: number, unit: string | null) => (
    <>
      {n}
      {unit ? <small> {unit}</small> : null}
    </>
  );

  const item = (d: DeliveryView, i: DeliveryItemView) => {
    const short = i.receivedQty !== null && i.receivedQty < i.expectedQty;
    return (
      <li key={i.id} className={styles.item}>
        <div className={styles.itemHead}>
          <span className={styles.itemLabel}>{i.label}</span>
          {i.receivedQty === null ? <Tag>{t("item.notRecorded")}</Tag> : short ? <Tag tone="attention">{t("item.short", { missing: i.expectedQty - i.receivedQty })}</Tag> : <Tag tone="success">{t("item.complete")}</Tag>}
        </div>
        <dl className={styles.qty}>
          <div>
            <dt>{t("item.expected")}</dt>
            <dd>{qtyText(i.expectedQty, i.unit)}</dd>
          </div>
          <div>
            <dt>{t("item.received")}</dt>
            <dd>{i.receivedQty === null ? <em className="ed-muted">{tc("unknown")}</em> : qtyText(i.receivedQty, i.unit)}</dd>
          </div>
          {d.kind !== "delivery" ? (
            <div>
              <dt>{t("item.returned")}</dt>
              <dd>{i.returnedQty === null ? <em className="ed-muted">{tc("unknown")}</em> : qtyText(i.returnedQty, i.unit)}</dd>
            </div>
          ) : null}
          {i.depositMinor !== undefined && i.depositMinor !== null ? (
            <div>
              <dt>{t("item.deposit")}</dt>
              <dd>{formatMoney(i.depositMinor, i.currency, ctx.locale)}</dd>
            </div>
          ) : null}
        </dl>
        {i.receivedAt ? <p className="ed-small ed-muted">{t("item.receivedAt", { date: formatDateTime(i.receivedAt, ctx.locale) })}</p> : null}

        {i.receivedQty === null ? (
          <PlannerForm
            id={`rec-${i.id}`}
            action={recordReceiptAction}
            hidden={hid({ itemId: i.id })}
            variant="secondary"
            fields={[{ name: "quantity", label: t("item.recordLabel"), hint: t("item.recordHint"), type: "number", required: true, defaultValue: String(i.expectedQty), maxLength: 7 }]}
            submitLabel={t("item.record")}
            pendingLabel={tc("status.saving")}
          />
        ) : (
          <div className={styles.inline}>
            {list.canManage ? (
              <FormSheet
                label={t("correct.open")}
                title={t("correct.title")}
                closeLabel={tc("actions.close")}
                intro={<p className="ed-muted">{t("correct.intro", { label: i.label, current: i.receivedQty })}</p>}
                form={{
                  id: `cor-${i.id}`,
                  action: correctReceivedQtyAction,
                  hidden: hid({ itemId: i.id }),
                  submitLabel: t("correct.submit"),
                  pendingLabel: tc("status.saving"),
                  success: t("correct.done"),
                  fields: [
                    { name: "quantity", label: t("correct.quantity"), type: "number", required: true, defaultValue: String(i.receivedQty), maxLength: 7 },
                    { name: "reason", label: t("correct.reason"), hint: t("correct.reasonHint"), type: "textarea", required: true, maxLength: 1000 },
                  ],
                }}
              />
            ) : null}
            {d.kind !== "delivery" && i.returnedQty === null ? (
              <FormSheet
                label={t("return.open")}
                title={t("return.title")}
                closeLabel={tc("actions.close")}
                intro={<p className="ed-muted">{t("return.intro", { label: i.label, received: i.receivedQty })}</p>}
                form={{
                  id: `ret-${i.id}`,
                  action: recordReturnAction,
                  hidden: hid({ itemId: i.id }),
                  submitLabel: t("return.submit"),
                  pendingLabel: tc("status.saving"),
                  fields: [{ name: "quantity", label: t("return.quantity"), type: "number", required: true, defaultValue: String(i.receivedQty), maxLength: 7 }],
                }}
              />
            ) : null}
            {d.kind !== "delivery" && i.returnedQty !== null && list.canManage ? (
              <FormSheet
                label={t("correct.openReturn")}
                title={t("correct.titleReturn")}
                closeLabel={tc("actions.close")}
                variant="quiet"
                intro={<p className="ed-muted">{t("correct.introReturn", { label: i.label, current: i.returnedQty })}</p>}
                form={{
                  id: `corret-${i.id}`,
                  action: correctReturnedQtyAction,
                  hidden: hid({ itemId: i.id }),
                  submitLabel: t("correct.submit"),
                  pendingLabel: tc("status.saving"),
                  success: t("correct.done"),
                  fields: [
                    { name: "quantity", label: t("correct.quantityReturn"), type: "number", required: true, defaultValue: String(i.returnedQty), maxLength: 7 },
                    { name: "reason", label: t("correct.reason"), hint: t("correct.reasonHint"), type: "textarea", required: true, maxLength: 1000 },
                  ],
                }}
              />
            ) : null}
            {i.depositMinor != null && i.depositRecoveredAt === null ? (
              <PlannerForm id={`dep-${i.id}`} action={markDepositRecoveredAction} hidden={hid({ itemId: i.id })} variant="quiet" submitLabel={t("deposit.recover")} pendingLabel={tc("status.saving")} />
            ) : null}
            {i.depositMinor != null && i.depositRecoveredAt ? (
              <FormSheet
                label={t("deposit.undo")}
                title={t("deposit.undoTitle")}
                closeLabel={tc("actions.close")}
                variant="quiet"
                intro={<p className="ed-muted">{t("deposit.undoIntro")}</p>}
                form={{
                  id: `depundo-${i.id}`,
                  action: correctDepositRecoveredAction,
                  hidden: hid({ itemId: i.id }),
                  submitLabel: t("deposit.undoSubmit"),
                  pendingLabel: tc("status.saving"),
                  fields: [{ name: "reason", label: t("correct.reason"), hint: t("correct.reasonHint"), type: "textarea", required: true, maxLength: 1000 }],
                }}
              />
            ) : null}
          </div>
        )}
        {i.depositRecoveredAt ? <p className="ed-small ed-muted">{t("deposit.recoveredAt", { date: formatDateTime(i.depositRecoveredAt, ctx.locale) })}</p> : null}

        {i.corrections.length > 0 ? (
          <ol className={styles.corrections} aria-label={t("correct.history")}>
            <li className="ed-label">{t("correct.history")}</li>
            {i.corrections.map((c) => (
              <li key={c.id}>
                {formatDateTime(c.createdAt, ctx.locale)} · {t(`correct.fields.${c.field === "returnedQty" ? "returnedQty" : c.field === "depositRecoveredAt" ? "depositRecoveredAt" : "receivedQty"}`)}
                {c.field === "depositRecoveredAt" ? null : (
                  <>
                    : <s>{String(c.before)}</s> → <strong>{String(c.after)}</strong>
                  </>
                )}
                {" · "}
                {c.reason}
              </li>
            ))}
          </ol>
        ) : null}
        {list.canManage && i.receivedQty === null ? (
          <div>
            <PlannerForm id={`rmi-${i.id}`} action={removeDeliveryItemAction} hidden={hid({ itemId: i.id })} variant="danger-quiet" submitLabel={t("item.remove")} pendingLabel={tc("status.deleting")} />
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} actions={list.items.length > 0 ? add : null} />
      {list.items.length === 0 ? (
        <EmptyState title={t("empty.title")} action={add}>
          {list.canManage ? t("empty.body") : t("empty.bodyReadOnly")}
        </EmptyState>
      ) : (
        <div>
          {list.items.map((d) => (
            <article key={d.id} className={styles.delivery} aria-labelledby={`d-${d.id}`}>
              <div className={styles.deliveryHead}>
                <h3 className={styles.deliveryTitle} id={`d-${d.id}`}>
                  {d.title}
                </h3>
                <Tag tone={STATE_TONE[d.state]}>{t(`states.${d.state}`)}</Tag>
              </div>
              <p className="ed-small ed-muted">
                {t(`kinds.${d.kind}`)} · {slot(d) ?? <em>{t("slotUnknown")}</em>}
                {d.place ? ` · ${d.place}` : ""}
                {d.supplierId ? (
                  <>
                    {" · "}
                    <Link href={`/occasions/${id}/suppliers/${d.supplierId}`}>{d.supplierName}</Link>
                  </>
                ) : null}
              </p>
              {d.items.length === 0 ? <p className="ed-muted">{t("item.none")}</p> : <ul className={styles.itemList}>{d.items.map((i) => item(d, i))}</ul>}
              {list.canManage ? (
                <div className={styles.inline}>
                  <FormSheet
                    label={t("item.add")}
                    title={t("item.addTitle", { title: d.title })}
                    closeLabel={tc("actions.close")}
                    form={{
                      id: `addi-${d.id}`,
                      action: addDeliveryItemAction,
                      hidden: hid({ deliveryId: d.id }),
                      optionalLabel: tc("optional"),
                      submitLabel: t("item.addSubmit"),
                      pendingLabel: tc("status.saving"),
                      success: tc("status.saved"),
                      fields: [
                        { name: "label", label: t("fields.itemLabel"), required: true, maxLength: 200 },
                        { name: "expectedQty", label: t("fields.itemQty"), type: "number", required: true, defaultValue: "1", maxLength: 7 },
                        { name: "unit", label: t("fields.itemUnit"), hint: t("fields.itemUnitHint"), maxLength: 30 },
                        ...(list.canSeeMoney ? [{ name: "deposit", label: t("fields.deposit"), hint: t("fields.depositHint"), maxLength: 20 }] : []),
                      ],
                    }}
                  />
                  {d.items.every((i) => i.receivedQty === null) ? (
                    <FormSheet
                      label={t("remove.open")}
                      title={t("remove.title")}
                      closeLabel={tc("actions.close")}
                      variant="danger-quiet"
                      intro={<p>{t("remove.body", { title: d.title })}</p>}
                      form={{ id: `rmd-${d.id}`, action: deleteDeliveryAction, hidden: hid({ deliveryId: d.id }), variant: "danger", submitLabel: t("remove.submit"), pendingLabel: tc("status.deleting") }}
                    />
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
