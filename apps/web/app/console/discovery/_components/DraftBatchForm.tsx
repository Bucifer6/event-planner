"use client";

import { ChoiceChips, ExternalLink, FocusFirstError, SubmitButton, Table, Tag, TextareaField } from "@ed/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState } from "react";
import { decideDraftsAction } from "@/app/actions/discovery";
import { FormError } from "@/app/(auth)/_components/forms";
import styles from "../discovery.module.css";

export type DraftRowView = {
  id: string;
  name: string;
  category: string | null;
  categoryText: string | null;
  area: string | null;
  areaText: string | null;
  contact: string;
  hasEmail: boolean;
  sourceName: string;
  sourceUrl: string;
  collected: string;
  duplicate: { kind: "listing" | "draft"; name: string } | null;
  approvable: boolean;
};

/**
 * W5: the drafts of one state as a table with a tick per row, and ONE decision with ONE
 * recorded reason for everything ticked. Ticks live in state, so a refused batch (a draft
 * still without a category, a reason too short) keeps the selection and the typed reason.
 */
export function DraftBatchForm({ rows, state, canApprove }: { rows: DraftRowView[]; state: string; canApprove: boolean }) {
  const t = useTranslations("discovery");
  const [result, formAction] = useActionState(decideDraftsAction, null);
  const [picked, setPicked] = useState<string[]>([]);
  const error = result && !result.ok ? result.error : null;
  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const actions = (canApprove ? (["approve", "reject", "discard"] as const) : (["reject", "discard"] as const)).map((a) => ({ value: a, label: t(`drafts.actions.${a}`) }));

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="state" value={state} />
      <div className={styles.rel}>
        <Table caption={t("tabs.drafts")}>
          <thead>
            <tr>
              <th scope="col">
                <span className="ed-vh">{t("drafts.cols.select")}</span>
              </th>
              <th scope="col">{t("drafts.cols.name")}</th>
              <th scope="col">{t("drafts.cols.category")}</th>
              <th scope="col">{t("drafts.cols.area")}</th>
              <th scope="col">{t("drafts.cols.contact")}</th>
              <th scope="col">{t("drafts.cols.source")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <label className={styles.pick}>
                    <input type="checkbox" name="draftIds" value={r.id} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={t("drafts.selectNamed", { name: r.name })} />
                  </label>
                </td>
                <td className={styles.subject}>
                  <strong>{r.name}</strong>
                  {r.duplicate ? <span className={styles.small}>{t(r.duplicate.kind === "listing" ? "drafts.duplicateOfListing" : "drafts.duplicateOfDraft", { name: r.duplicate.name })}</span> : null}
                  <Link href={`/console/discovery/drafts/${r.id}`} className={styles.small} aria-label={t("drafts.fixNamed", { name: r.name })}>
                    {t("drafts.fix")}
                  </Link>
                </td>
                <td className={styles.narrowCell}>
                  {r.category ?? <Tag tone="attention">{t("drafts.guessMissing")}</Tag>}
                  {r.categoryText && !r.category ? <span className={styles.small}>{r.categoryText}</span> : null}
                </td>
                <td className={styles.narrowCell}>
                  {r.area ?? <Tag tone="attention">{t("drafts.guessMissing")}</Tag>}
                  {r.areaText && !r.area ? <span className={styles.small}>{r.areaText}</span> : null}
                </td>
                <td className={styles.narrowCell}>
                  {r.contact}
                  <span className={styles.small}>{r.hasEmail ? t("drafts.emailYes") : t("drafts.emailNo")}</span>
                </td>
                <td className={styles.narrowCell}>
                  {r.sourceName}
                  <span className={styles.small}>
                    {/^https?:\/\//.test(r.sourceUrl) ? <ExternalLink href={r.sourceUrl}>{t("drafts.sourceLink")}</ExternalLink> : r.sourceUrl} · <span className="ed-num">{r.collected}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className={`ed-form ${styles.batch}`}>
        <h3>{t("drafts.batchTitle")}</h3>
        <p className="ed-muted">{t("drafts.batchBody")}</p>
        <FormError state={result} skipFields={["reason", "action", "draftIds"]} />
        {error?.fieldErrors?.draftIds?.[0] ? (
          <span className="ed-field__error" role="alert">
            {error.fieldErrors.draftIds[0]}
          </span>
        ) : null}
        <ChoiceChips key={`action:${error?.values?.action ?? ""}`} name="action" legend={t("drafts.action")} options={actions} defaultValue={error?.values?.action} required stack error={error?.fieldErrors?.action?.[0]} />
        {canApprove ? null : <p className="ed-small ed-muted">{t("drafts.needModerator")}</p>}
        <TextareaField id="batch-reason" name="reason" label={t("drafts.reason")} hint={t("drafts.reasonHint")} rows={3} maxLength={1000} required defaultValue={error?.values?.reason ?? ""} error={error?.fieldErrors?.reason?.[0]} />
        <FocusFirstError errors={error?.fieldErrors ?? null} />
        <div>
          <SubmitButton pendingLabel={t("drafts.submitting")}>{t("drafts.submit")}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
