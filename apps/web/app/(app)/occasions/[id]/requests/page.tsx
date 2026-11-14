import { getPrivateRequestCounts, listPrivateRequests } from "@ed/core/requests";
import { listSuppliers } from "@ed/core/suppliers";
import { formatDate } from "@ed/i18n/format";
import { EmptyState, Figure, Notice, PageHeader, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { setRequestStatusAction, shareRequestCountsAction } from "@/app/actions/requests";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { FormSheet } from "../guests/_components/form";
import styles from "../programme/_components/programme.module.css";
import { ResultForm } from "../programme/_components/ResultForm";

// Private requests (C-07, D2). Only members holding the `privateRequests` grant get past the
// first read: everyone else — managers without the grant included — gets "not found", and the
// nav item is not listed for them (occasion layout). Suppliers only ever receive the anonymous
// counts a holder shares from the last section.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("requests"))("title") };
}

export default async function PrivateRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("requests");
  const tm = await getTranslations("menus");
  const tc = await getTranslations("common");
  const { requests, canManageBriefings } = await orNotFound(listPrivateRequests(ctx, id));
  const counts = await getPrivateRequestCounts(ctx, id);
  const suppliers = canManageBriefings ? await listSuppliers(ctx, id).catch(() => null) : null;
  const tz = undefined;
  const untagged = counts.byKind.dietary - counts.byDietTag.reduce((s, x) => s + x.count, 0);
  const shareable = counts.byDietTag.length > 0 || counts.byKind.access > 0;

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />

      {requests.length === 0 ? (
        <Section>
          <EmptyState title={t("empty.title")} action={<Link href={`/occasions/${id}/guests`}>{t("empty.action")}</Link>}>
            {t("empty.body")}
          </EmptyState>
          <p className="ed-small ed-muted">{t("retention")}</p>
        </Section>
      ) : (
        <>
          <Section>
            <Figure size="hero" label={t("hero.label")} value={counts.open} note={t("hero.note", { total: counts.total })} noteTone={counts.open === 0 ? "success" : undefined} />
            <p className="ed-small ed-muted">{t("retention")}</p>
          </Section>

          <Section title={t("list.title")}>
            <div>
              {requests.map((r) => (
                <div className={styles.item} key={r.id}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{r.from.type === "household" ? t("list.from", { name: r.from.name }) : t("list.fromPublic", { name: r.from.name })}</span>
                    <span className={styles.inline}>
                      <Tag plain>{t(`kinds.${r.kind}`)}</Tag>
                      <Tag tone={r.status === "handled" ? "success" : "attention"}>{t(`status.${r.status}`)}</Tag>
                    </span>
                  </div>
                  {r.dietTag ? (
                    <p>
                      <strong>{tm(`diet.${r.dietTag}`)}</strong>
                    </p>
                  ) : null}
                  {r.body ? <p className={styles.request}>{r.body}</p> : <p className="ed-small ed-muted">{t("list.noText")}</p>}
                  <p className="ed-small ed-muted">{t("list.received", { date: formatDate(r.createdAt, ctx.locale, tz) })}</p>
                  {r.note ? <p className="ed-small">{t("list.note", { note: r.note })}</p> : null}
                  <div>
                    <FormSheet
                      label={r.status === "handled" ? t("list.reopen") : t("list.handle")}
                      title={t("list.handleTitle", { name: r.from.name })}
                      closeLabel={tc("actions.close")}
                      intro={r.body ? <p className={styles.request}>{r.body}</p> : undefined}
                      form={{
                        id: `req-${r.id}`,
                        action: setRequestStatusAction,
                        hidden: { occasionId: id, requestId: r.id, status: r.status === "handled" ? "open" : "handled" },
                        optionalLabel: tc("optional"),
                        fields: [{ name: "note", label: t("list.noteLabel"), hint: t("list.noteHint"), type: "textarea", rows: 3, defaultValue: r.note ?? "", maxLength: 1000 }],
                        submitLabel: r.status === "handled" ? t("list.saveOpen") : t("list.saveHandled"),
                        pendingLabel: tc("status.saving"),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("counts.title")}>
            <ul className={styles.cueList}>
              {counts.byDietTag.map((x) => (
                <li key={x.tag}>
                  <span className="ed-num">{x.count}</span> × {tm(`diet.${x.tag}`)}
                </li>
              ))}
              {untagged > 0 ? (
                <li>
                  <span className="ed-num">{untagged}</span> × {t("counts.untagged")}
                </li>
              ) : null}
              {counts.byKind.access > 0 ? (
                <li>
                  <span className="ed-num">{counts.byKind.access}</span> × {t("counts.access")}
                </li>
              ) : null}
              {counts.byKind.other > 0 ? (
                <li>
                  <span className="ed-num">{counts.byKind.other}</span> × {t("counts.other")}
                </li>
              ) : null}
            </ul>
          </Section>

          <Section title={t("share.title")}>
            <p className={`ed-muted ${styles.narrow}`}>{t("share.intro")}</p>
            {!canManageBriefings ? (
              <Notice>{t("share.managersOnly")}</Notice>
            ) : !shareable ? (
              <Notice>{t("share.nothing")}</Notice>
            ) : !suppliers || suppliers.items.length === 0 ? (
              <Notice>{t("share.noSuppliers")}</Notice>
            ) : (
              <div className={styles.narrow}>
                <ResultForm action={shareRequestCountsAction} hidden={{ occasionId: id }} submitLabel={t("share.submit")} pendingLabel={t("share.sending")} successTemplate={t.raw("share.sent") as string}>
                  <div className="ed-field">
                    <label className="ed-field__label" htmlFor="share-booking">
                      {t("share.booking")}
                    </label>
                    <select className="ed-select" id="share-booking" name="bookingId" defaultValue={suppliers.items[0]!.booking.id}>
                      {suppliers.items.map((s) => (
                        <option key={s.id} value={s.booking.id}>
                          {s.categoryLabel ? `${s.name} — ${s.categoryLabel}` : s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <fieldset className="ed-fieldset">
                    <legend className="ed-field__label">{t("share.tags")}</legend>
                    <div className={styles.stackTight}>
                      {counts.byDietTag.map((x) => (
                        <label className="ed-check" key={x.tag}>
                          <input type="checkbox" name={`tag_${x.tag}`} defaultChecked />
                          <span className="ed-check__text">
                            <span>{t("share.tagLine", { count: x.count, tag: tm(`diet.${x.tag}`) })}</span>
                          </span>
                        </label>
                      ))}
                      {counts.byKind.access > 0 ? (
                        <label className="ed-check">
                          <input type="checkbox" name="access" />
                          <span className="ed-check__text">
                            <span>{t("share.access", { count: counts.byKind.access })}</span>
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </fieldset>
                </ResultForm>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
