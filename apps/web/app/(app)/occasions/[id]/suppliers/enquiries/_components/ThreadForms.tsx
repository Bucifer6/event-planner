"use client";

import { FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { reportEnquiryAction } from "@/app/actions/enquiries";
import { FormError } from "@/app/(auth)/_components/forms";
import { SpecForm } from "@/app/console/_components/SpecForm";
import type { ActionResult } from "@/lib/action-core";
import styles from "./enquiries.module.css";

const REASONS = ["illegal_content", "fraud", "intellectual_property", "privacy", "false_information", "offensive", "other"] as const;

/** P11: either side reports the thread; on success the form is replaced by the case reference. */
export function ReportForm({ enquiryId, occasionId, businessId }: { enquiryId: string; occasionId?: string; businessId?: string }) {
  const t = useTranslations("enquiries");
  return (
    <SpecForm
      action={reportEnquiryAction}
      hidden={{ enquiryId, ...(occasionId ? { occasionId } : {}), ...(businessId ? { businessId } : {}) }}
      replaceOnSuccess
      refreshOnSuccess
      successRender={(data) => t("thread.reported", { reference: data.reference })}
      fields={[
        { kind: "select", name: "reasonCategory", label: t("thread.reportReason"), required: true, placeholder: t("thread.reportReasonPlaceholder"), options: REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) })) },
        { kind: "textarea", name: "description", label: t("thread.reportDescription"), required: true, maxLength: 4000, rows: 5 },
      ]}
      submitLabel={t("thread.reportSubmit")}
      pendingLabel={t("thread.reportSubmitting")}
      variant="secondary"
      block
    >
      <p className="ed-small ed-muted">{t("thread.reportBody")}</p>
    </SpecForm>
  );
}

/**
 * The business's reply: text and, optionally, a PDF marked as the quote (P12). A PDF can be
 * 10 MB, more than a Server Action accepts, so the form posts to the thread's own route
 * handler. Errors appear beside their field; the typed text is never cleared on failure.
 */
export function BusinessReplyForm({ businessId, enquiryId }: { businessId: string; enquiryId: string }) {
  const t = useTranslations("enquiries");
  const router = useRouter();
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionResult<{ messageId: string }> | null>(null);
  const error = state && !state.ok ? state.error : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = new FormData(e.currentTarget);
      const file = body.get("quoteFile");
      if (file instanceof File && file.size === 0) body.delete("quoteFile");
      const res = await fetch(`/business/${businessId}/enquiries/${enquiryId}/reply`, { method: "POST", body, credentials: "same-origin" });
      const result = (await res.json()) as ActionResult<{ messageId: string }>;
      setState(result);
      if (result.ok) {
        form.current?.reset();
        router.refresh();
      }
    } catch {
      setState({ ok: false, error: { code: "UNEXPECTED", message: t("thread.sendFailed") } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} className={`ed-form ${styles.replyForm}`} noValidate>
      <FormError state={state} skipFields={["body", "quoteFile"]} />
      {state?.ok ? (
        <Notice tone="success" role="status">
          {t("thread.sent")}
        </Notice>
      ) : null}
      <TextareaField id={`${uid}-body`} name="body" label={t("thread.reply")} hint={t("thread.replyBusinessHint")} rows={5} maxLength={4000} error={error?.fieldErrors?.body?.[0]} />
      <TextField
        id={`${uid}-quoteFile`}
        name="quoteFile"
        type="file"
        accept="application/pdf"
        label={t("thread.quoteFile")}
        hint={t("thread.quoteFileHint")}
        optionalLabel={t("form.optional")}
        error={error?.fieldErrors?.quoteFile?.[0]}
      />
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={t("thread.answering")} pending={busy}>
        {t("thread.answer")}
      </SubmitButton>
    </form>
  );
}
