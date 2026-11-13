import { BOOKING_PATH, getQuoteLink, listBookingEvents, QUOTE_UPLOAD_PURPOSE } from "@ed/core/bookings";
import { BRIEFING_FIELDS, listBriefingVersions } from "@ed/core/briefings";
import { getOrderState } from "@ed/core/orders";
import { listBookingPayments, type PaymentView } from "@ed/core/payments";
import { getSupplier, getSupplierLinkMeta } from "@ed/core/suppliers";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { formatDateTime, formatMoney } from "@ed/i18n/format";
import { DeltaList, DescriptionList, ExternalLink, List, Notice, PageHeader, Row, Section, Tag, Unknown } from "@ed/ui";
import { IconArrowLeft, IconDownload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addPaymentDeadlineAction,
  correctPaymentPaidAction,
  createSupplierLinkAction,
  deleteSupplierAction,
  markPaymentPaidAction,
  proposeMovePaymentAction,
  publishBriefingAction,
  removePaymentDeadlineAction,
  removeQuoteAction,
  revokeSupplierLinkAction,
  updateBookingTermsAction,
  updateSupplierAction,
} from "@/app/actions/suppliers";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { FormSheet, PlannerForm } from "../../guests/_components/form";
import { BookingStepper } from "../_components/BookingStepper";
import { OrderEditor } from "../_components/OrderEditor";
import { QuoteUpload } from "../_components/QuoteUpload";
import styles from "../_components/suppliers.module.css";
import { dayText, STATE_TONE } from "../_components/tones";
import { SupplierEnquiries } from "../enquiries/_components/SupplierEnquiries"; // P-05: enquiry threads of this supplier (P10)

type Props = {
  params: Promise<{ id: string; supplierId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("suppliers"))("detail.metaTitle") };
}

/**
 * B4, B5, B12: one supplier — booking state (every transition recorded), quote, versioned
 * briefing with acknowledgements, the final order and what changed since, payment deadlines
 * (finance grant) and the scoped supplier link.
 */
export default async function SupplierPage({ params, searchParams }: Props) {
  const [{ id, supplierId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("suppliers");
  const tb = await getTranslations("briefing");
  const tc = await getTranslations("common");
  const detail = await getSupplier(ctx, supplierId).catch(() => null);
  if (!detail || detail.supplier.occasionId !== id) notFound();
  const { supplier: s, booking: b, canManage, canSeeMoney } = detail;
  const base = `/occasions/${id}/suppliers`;
  const self = `${base}/${s.id}`;
  const hidden = { occasionId: id, bookingId: b.id };

  const [events, versions, order, link, quote, payments] = await Promise.all([
    listBookingEvents(ctx, b.id),
    listBriefingVersions(ctx, b.id),
    getOrderState(ctx, b.id),
    getSupplierLinkMeta(ctx, b.id),
    getQuoteLink(ctx, b.id),
    canSeeMoney ? listBookingPayments(ctx, b.id) : Promise.resolve<PaymentView[]>([]),
  ]);
  const previewId = typeof sp.preview === "string" ? sp.preview : null;
  const preview = previewId ? await getPreview(ctx, previewId).catch(() => null) : null;
  const latest = versions[0] ?? null;
  const nextVersion = (latest?.version ?? 0) + 1;
  const unknown = tc("unknown");
  const linkOnce = { title: t("link.onceTitle"), body: t("link.onceBody"), copy: t("link.copy"), copied: t("link.copied") };
  const stateLabels = Object.fromEntries(([...BOOKING_PATH, "cancelled"] as const).map((x) => [x, t(`states.${x}`)])) as Record<(typeof BOOKING_PATH)[number] | "cancelled", string>;
  const counts = (c: { adults: number; children: number; total: number }) => t("order.counts", c);

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("detail.back")}
      </Link>
      <PageHeader
        level={2}
        title={s.name}
        description={
          <span className={styles.inline}>
            <Tag tone={STATE_TONE[b.state]}>{t(`states.${b.state}`)}</Tag>
            {s.categoryLabel ? <span>{s.categoryLabel}</span> : null}
          </span>
        }
        actions={
          canManage ? (
            <FormSheet
              label={tc("actions.edit")}
              title={t("detail.editTitle")}
              closeLabel={tc("actions.close")}
              form={{
                id: "edit-supplier",
                action: updateSupplierAction,
                hidden: { occasionId: id, supplierId: s.id },
                optionalLabel: tc("optional"),
                submitLabel: tc("actions.save"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
                fields: [
                  { name: "name", label: t("fields.name"), required: true, defaultValue: s.name, maxLength: 160 },
                  { name: "categoryLabel", label: t("fields.category"), hint: t("fields.categoryHint"), defaultValue: s.categoryLabel ?? "", maxLength: 80 },
                  { name: "contactName", label: t("fields.contactName"), defaultValue: s.contactName ?? "", maxLength: 160 },
                  { name: "contactPhone", label: t("fields.contactPhone"), defaultValue: s.contactPhone ?? "", maxLength: 40 },
                  { name: "contactEmail", label: t("fields.contactEmail"), type: "email", defaultValue: s.contactEmail ?? "", maxLength: 254 },
                  { name: "notes", label: t("fields.notes"), type: "textarea", defaultValue: s.notes ?? "", maxLength: 2000 },
                ],
              }}
            />
          ) : null
        }
      />

      {preview ? <PreviewPanel preview={toPreviewView(preview)} appliedHref={`${self}#plati`} discardedHref={`${self}#plati`} /> : null}

      <Section title={t("detail.contactTitle")}>
        <DescriptionList
          cols={3}
          items={[
            { term: t("fields.contactName"), value: s.contactName ?? <Unknown label={unknown} /> },
            { term: t("fields.contactPhone"), value: s.contactPhone ? <a href={`tel:${s.contactPhone.replace(/[^+0-9]/g, "")}`}>{s.contactPhone}</a> : <Unknown label={unknown} /> },
            { term: t("fields.contactEmail"), value: s.contactEmail ? <a href={`mailto:${s.contactEmail}`} className={styles.wrap}>{s.contactEmail}</a> : <Unknown label={unknown} /> },
          ]}
        />
        {s.notes ? <p className={styles.pre}>{s.notes}</p> : null}
      </Section>

      {/* P-05 (enquiries agent): the enquiry / quote threads that sit in this supplier record (P10, P33). Renders nothing when there is none. */}
      <SupplierEnquiries occasionId={id} bookingId={b.id} />

      <Section title={t("booking.title")}>
        <BookingStepper
          occasionId={id}
          bookingId={b.id}
          state={b.state}
          path={BOOKING_PATH}
          canManage={canManage}
          labels={{
            states: stateLabels,
            current: t("booking.current"),
            cancel: t("booking.cancel"),
            reopen: t("booking.reopen"),
            saving: tc("status.saving"),
            cancelledNote: t("booking.cancelledNote"),
          }}
        />
        <details className={styles.version}>
          <summary>
            <span className="ed-label">{t("booking.history", { count: events.length })}</span>
          </summary>
          <div className={styles.versionBody}>
            <ol className={styles.history}>
              {events.map((e) => (
                <li key={e.id}>
                  {formatDateTime(e.at, ctx.locale)} · {e.fromState ? `${t(`states.${e.fromState}`)} → ` : ""}
                  {t(`states.${e.toState}`)}
                </li>
              ))}
            </ol>
          </div>
        </details>
      </Section>

      <Section title={t("terms.title")}>
        <DescriptionList
          cols={2}
          items={[
            ...(canSeeMoney
              ? [{ term: t("terms.agreed"), value: b.agreedMinor == null ? <Unknown label={unknown} /> : <span className={styles.amount}>{formatMoney(b.agreedMinor, b.currency, ctx.locale)}</span> }]
              : []),
            {
              term: t("terms.quote"),
              value: quote ? (
                <ExternalLink href={quote.url}>
                  <IconDownload size={16} /> {quote.name}
                </ExternalLink>
              ) : (
                <span className="ed-muted">{t("terms.noQuote")}</span>
              ),
            },
          ]}
        />
        {b.notes ? <p className={styles.pre}>{b.notes}</p> : null}
        {canManage ? (
          <div className={styles.inline}>
            <FormSheet
              label={t("terms.edit")}
              title={t("terms.editTitle")}
              closeLabel={tc("actions.close")}
              form={{
                id: "terms",
                action: updateBookingTermsAction,
                hidden,
                optionalLabel: tc("optional"),
                submitLabel: tc("actions.save"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
                fields: [
                  ...(canSeeMoney
                    ? [{ name: "agreedAmount", label: t("terms.agreedField"), hint: t("terms.agreedHint"), defaultValue: b.agreedMinor == null ? "" : String(b.agreedMinor / 100).replace(".", ","), maxLength: 20 }]
                    : []),
                  { name: "notes", label: t("terms.notes"), type: "textarea" as const, defaultValue: b.notes ?? "", maxLength: 2000 },
                ],
              }}
            />
            {quote ? (
              <PlannerForm id="rm-quote" action={removeQuoteAction} hidden={hidden} variant="quiet" submitLabel={t("terms.removeQuote")} pendingLabel={tc("status.saving")} />
            ) : null}
          </div>
        ) : null}
        {canManage ? (
          <QuoteUpload
            occasionId={id}
            bookingId={b.id}
            purpose={QUOTE_UPLOAD_PURPOSE}
            labels={{ field: quote ? t("terms.replaceQuote") : t("terms.uploadQuote"), hint: t("terms.uploadHint"), attaching: t("terms.attaching"), attached: t("terms.attached") }}
          />
        ) : null}
      </Section>

      <Section title={tb("title")} id="briefing">
        {latest ? (
          <Notice tone={latest.ack ? "success" : "attention"} title={latest.ack ? tb("status.acked", { version: latest.version }) : tb("status.notAcked", { version: latest.version })}>
            {latest.ack ? tb("status.ackedBy", { name: latest.ack.name, date: formatDateTime(latest.ack.at, ctx.locale) }) : link?.state === "active" ? tb("status.waiting") : tb("status.needsLink")}
          </Notice>
        ) : (
          <p className="ed-muted">{canManage ? tb("empty") : tb("emptyReadOnly")}</p>
        )}
        {versions.map((v, i) => (
          <details key={v.id} className={styles.version} open={i === 0}>
            <summary>
              <span className={styles.versionNo}>v{v.version}</span>
              <span className="ed-small ed-muted">{tb("publishedOn", { date: formatDateTime(v.createdAt, ctx.locale) })}</span>
              {v.ack ? <Tag tone="success">{tb("acked")}</Tag> : <Tag tone="attention">{tb("notAcked")}</Tag>}
            </summary>
            <div className={styles.versionBody}>
              {BRIEFING_FIELDS.filter((f) => v.content[f]).map((f) => (
                <div key={f} className={styles.fieldBlock}>
                  <span className="ed-label">{tb(`fields.${f}`)}</span>
                  <p>{v.content[f]}</p>
                </div>
              ))}
              <p className="ed-small ed-muted">
                {v.ack ? tb("status.ackedBy", { name: v.ack.name, date: formatDateTime(v.ack.at, ctx.locale) }) : tb("status.noAckYet")}
              </p>
            </div>
          </details>
        ))}
        {canManage ? (
          <div>
          <FormSheet
            label={latest ? tb("editor.openNext", { version: nextVersion }) : tb("editor.openFirst")}
            title={tb("editor.title", { version: nextVersion })}
            closeLabel={tc("actions.close")}
            variant="primary"
            intro={<p className="ed-muted">{latest ? tb("editor.introNext") : tb("editor.introFirst")}</p>}
            form={{
              id: "briefing",
              action: publishBriefingAction,
              hidden,
              optionalLabel: tc("optional"),
              submitLabel: tb("editor.publish", { version: nextVersion }),
              pendingLabel: tb("editor.publishing"),
              success: tb("editor.published"),
              fields: [
                { name: "what", label: tb("fields.what"), hint: tb("hints.what"), type: "textarea", rows: 3, defaultValue: latest?.content.what ?? "", maxLength: 2000 },
                { name: "when", label: tb("fields.when"), hint: tb("hints.when"), defaultValue: latest?.content.when ?? "", maxLength: 500 },
                { name: "where", label: tb("fields.where"), hint: tb("hints.where"), defaultValue: latest?.content.where ?? "", maxLength: 500 },
                { name: "contacts", label: tb("fields.contacts"), hint: tb("hints.contacts"), type: "textarea", rows: 2, defaultValue: latest?.content.contacts ?? "", maxLength: 1000 },
                { name: "specialNotes", label: tb("fields.specialNotes"), hint: tb("hints.specialNotes"), type: "textarea", rows: 3, defaultValue: latest?.content.specialNotes ?? "", maxLength: 2000 },
                { name: "freeText", label: tb("fields.freeText"), type: "textarea", rows: 5, defaultValue: latest?.content.freeText ?? "", maxLength: 6000 },
              ],
            }}
          />
          </div>
        ) : null}
      </Section>

      <Section title={t("order.title")} id="comanda">
        {order.latest ? (
          <>
            <p className="ed-small ed-muted">
              {t("order.fixed", { version: order.latest.version, date: formatDateTime(order.latest.createdAt, ctx.locale) })} · {t("order.basedOn")} {counts(order.latest.basedOn)}
            </p>
            <List>
              {order.latest.items.map((item, i) => (
                <Row key={i} title={item.label} meta={item.note ?? undefined} end={<span className={styles.amount}>{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>} />
              ))}
            </List>
            <Section title={t("order.deltasTitle")} level={3}>
              {order.openDeltas.length === 0 ? (
                <p className="ed-muted">{t("order.noDeltas")}</p>
              ) : (
                <>
                  <Notice tone="attention" title={t("order.deltasNotice", { count: order.openDeltas.length })}>
                    {t("order.nowConfirmed")} {counts(order.current)}
                  </Notice>
                  <DeltaList
                    rows={order.openDeltas.map((d) => ({
                      key: d.id,
                      kind: formatDateTime(d.createdAt, ctx.locale),
                      what: d.householdName ?? t("order.householdRemoved"),
                      before: t("order.deltaCounts", d.before),
                      after: t("order.deltaCounts", d.after),
                    }))}
                  />
                </>
              )}
            </Section>
            {order.versions.length > 1 ? (
              <details className={styles.version}>
                <summary>
                  <span className="ed-label">{t("order.olderVersions", { count: order.versions.length - 1 })}</span>
                </summary>
                <div className={styles.versionBody}>
                  {order.versions.slice(1).map((v) => (
                    <div key={v.id} className={styles.fieldBlock}>
                      <span className="ed-label">
                        v{v.version} · {formatDateTime(v.createdAt, ctx.locale)} · {counts(v.basedOn)}
                      </span>
                      <p>{v.items.map((i) => `${i.quantity}${i.unit ? ` ${i.unit}` : ""} × ${i.label}`).join("\n")}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <p className="ed-muted">
            {t("order.empty")} {t("order.nowConfirmed")} {counts(order.current)}
          </p>
        )}
        {canManage ? (
          <details className={styles.version}>
            <summary>
              <span className="ed-label">{order.latest ? t("order.newVersion", { version: order.latest.version + 1 }) : t("order.first")}</span>
            </summary>
            <div className={styles.versionBody}>
              <p className="ed-small ed-muted">{order.latest ? t("order.newVersionHint") : t("order.firstHint")}</p>
              <OrderEditor
                key={order.latest?.id ?? "none"}
                occasionId={id}
                bookingId={b.id}
                initial={order.latest?.items ?? []}
                labels={{
                  item: t("order.item"),
                  quantity: t("order.quantity"),
                  unit: t("order.unit"),
                  unitHint: t("order.unitHint"),
                  addRow: t("order.addRow"),
                  removeRow: t("order.removeRow"),
                  submit: order.latest ? t("order.submitNext", { version: order.latest.version + 1 }) : t("order.submitFirst"),
                  pending: tc("status.saving"),
                  done: t("order.done"),
                  optional: tc("optional"),
                }}
              />
            </div>
          </details>
        ) : null}
      </Section>

      {canSeeMoney ? (
        <Section title={t("payments.title")} id="plati">
          {payments.length === 0 ? (
            <p className="ed-muted">{t("payments.empty")}</p>
          ) : (
            <List>
              {payments.map((p) => (
                <Row
                  key={p.id}
                  title={
                    <span className={styles.inline}>
                      {t(`payments.kinds.${p.kind}`)}
                      {p.paidAt ? <Tag tone="success">{t("payments.paid")}</Tag> : p.overdue ? <Tag tone="danger">{t("payments.overdue")}</Tag> : p.soon ? <Tag tone="attention">{t("payments.soon")}</Tag> : null}
                    </span>
                  }
                  meta={
                    <>
                      {t("payments.dueOn", { date: dayText(p.dueOn) })}
                      {p.paidAt ? ` · ${t("payments.paidOn", { date: formatDateTime(p.paidAt, ctx.locale) })}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </>
                  }
                  end={<span className={styles.amount}>{p.amountMinor === null ? <Unknown label={unknown} /> : formatMoney(p.amountMinor, p.currency, ctx.locale)}</span>}
                >
                  <div className={styles.inline}>
                    {p.paidAt ? (
                      <FormSheet
                        label={t("payments.unmark")}
                        title={t("payments.unmarkTitle")}
                        closeLabel={tc("actions.close")}
                        variant="quiet"
                        intro={<p className="ed-muted">{t("payments.unmarkIntro")}</p>}
                        form={{
                          id: `unpay-${p.id}`,
                          action: correctPaymentPaidAction,
                          hidden: { occasionId: id, deadlineId: p.id },
                          submitLabel: t("payments.unmarkSubmit"),
                          pendingLabel: tc("status.saving"),
                          fields: [{ name: "reason", label: t("payments.reason"), hint: t("payments.reasonHint"), type: "textarea", required: true, maxLength: 1000 }],
                        }}
                      />
                    ) : (
                      <>
                        <PlannerForm id={`pay-${p.id}`} action={markPaymentPaidAction} hidden={{ occasionId: id, deadlineId: p.id }} variant="secondary" submitLabel={t("payments.markPaid")} pendingLabel={tc("status.saving")} />
                        <FormSheet
                          label={t("payments.move")}
                          title={t("payments.moveTitle")}
                          closeLabel={tc("actions.close")}
                          variant="quiet"
                          intro={<p className="ed-muted">{t("payments.moveIntro")}</p>}
                          form={{
                            id: `move-${p.id}`,
                            action: proposeMovePaymentAction,
                            hidden: { occasionId: id, deadlineId: p.id },
                            submitLabel: t("payments.moveSubmit"),
                            pendingLabel: t("payments.movePending"),
                            redirectTo: `${self}?preview={previewId}`,
                            fields: [{ name: "dueOn", label: t("payments.newDueOn"), type: "date", required: true, defaultValue: p.dueOn }],
                          }}
                        />
                        <PlannerForm id={`rm-pay-${p.id}`} action={removePaymentDeadlineAction} hidden={{ occasionId: id, deadlineId: p.id }} variant="danger-quiet" submitLabel={t("payments.remove")} pendingLabel={tc("status.deleting")} />
                      </>
                    )}
                  </div>
                </Row>
              ))}
            </List>
          )}
          <div>
            <FormSheet
              label={t("payments.add")}
              title={t("payments.addTitle")}
              closeLabel={tc("actions.close")}
              form={{
                id: "add-payment",
                action: addPaymentDeadlineAction,
                hidden,
                optionalLabel: tc("optional"),
                submitLabel: t("payments.addSubmit"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
                fields: [
                  {
                    name: "kind",
                    label: t("payments.kind"),
                    type: "select",
                    defaultValue: payments.length === 0 ? "advance" : "instalment",
                    options: (["advance", "instalment", "final"] as const).map((k) => ({ value: k, label: t(`payments.kinds.${k}`) })),
                  },
                  { name: "dueOn", label: t("payments.dueField"), type: "date", required: true },
                  { name: "amount", label: t("payments.amount"), hint: t("payments.amountHint"), maxLength: 20 },
                  { name: "note", label: t("payments.note"), maxLength: 300 },
                ],
              }}
            />
          </div>
        </Section>
      ) : null}

      <Section title={t("link.title")} id="link">
        <p className="ed-small ed-muted">{t("link.description")}</p>
        {link ? (
          <DescriptionList
            cols={3}
            items={[
              { term: t("link.state"), value: <Tag tone={link.state === "active" ? "success" : "attention"}>{t(`link.states.${link.state}`)}</Tag> },
              { term: t("link.language"), value: tc(`languages.${link.language}`) },
              { term: t("link.lastViewed"), value: link.lastViewedAt ? formatDateTime(link.lastViewedAt, ctx.locale) : t("link.neverViewed") },
            ]}
          />
        ) : (
          <p className="ed-muted">{t("link.none")}</p>
        )}
        {link ? <p className="ed-small ed-muted">{t("link.hashedNote")}</p> : null}
        {canManage ? (
          <div className={styles.stackTight}>
            <PlannerForm
              id="link-new"
              action={createSupplierLinkAction}
              hidden={hidden}
              variant="secondary"
              submitLabel={link ? t("link.regenerate") : t("link.create")}
              pendingLabel={t("link.creating")}
              linkOnce={linkOnce}
              fields={[
                {
                  name: "language",
                  label: t("link.languageField"),
                  type: "select",
                  defaultValue: link?.language ?? "ro",
                  options: [
                    { value: "ro", label: tc("languages.ro") },
                    { value: "en", label: tc("languages.en") },
                  ],
                },
              ]}
            />
            {link?.state === "active" ? (
              <div>
                <FormSheet
                  label={t("link.revoke")}
                  title={t("link.revokeTitle")}
                  closeLabel={tc("actions.close")}
                  variant="danger-quiet"
                  intro={<p>{t("link.revokeBody")}</p>}
                  form={{ id: "link-revoke", action: revokeSupplierLinkAction, hidden, variant: "danger", submitLabel: t("link.revokeSubmit"), pendingLabel: tc("status.saving") }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      {canManage ? (
        <Section title={t("remove.title")}>
          <p className="ed-small ed-muted">{t("remove.body")}</p>
          <div>
            <FormSheet
              label={t("remove.open", { name: s.name })}
              title={t("remove.confirmTitle")}
              closeLabel={tc("actions.close")}
              variant="danger-quiet"
              intro={<p>{t("remove.confirmBody", { name: s.name })}</p>}
              form={{ id: "rm-supplier", action: deleteSupplierAction, hidden: { occasionId: id, supplierId: s.id }, variant: "danger", submitLabel: t("remove.submit"), pendingLabel: tc("status.deleting"), redirectTo: base }}
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}
