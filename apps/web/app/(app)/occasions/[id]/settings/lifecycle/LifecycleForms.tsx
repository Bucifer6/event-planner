"use client";

import { FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { proposeCancelAction, proposeCloseAction, proposePostponeAction, saveLessonAction } from "@/app/actions/lifecycle";
import { useForm } from "../../../_components/useForm";

/** B9: a new date only ever opens a preview of everything that changes. */
export function PostponeForm({ occasionId, min }: { occasionId: string; min: string }) {
  const t = useTranslations("lifecycle.settings");
  const f = useForm(proposePostponeAction);
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.error && f.formLevel(["startsOn"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextField id="lc-postpone-date" name="startsOn" type="date" label={t("newDate")} min={min} required defaultValue={f.value("startsOn")} error={f.fieldError("startsOn")} />
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={t("postponeSubmitting")}>
          {t("postponeSubmit")}
        </SubmitButton>
      </div>
    </form>
  );
}

/** B9: cancelling also starts with the preview; nothing is cancelled here. */
export function CancelForm({ occasionId }: { occasionId: string }) {
  const t = useTranslations("lifecycle.settings");
  const f = useForm(proposeCancelAction);
  return (
    <form action={f.formAction} className="ed-form">
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <div>
        <SubmitButton variant="danger-quiet" pendingLabel={t("cancelSubmitting")}>
          {t("cancelSubmit")}
        </SubmitButton>
      </div>
    </form>
  );
}

/** B10: "Închide ocazia" — the one primary action of the closeout page; opens a preview. */
export function CloseForm({ occasionId }: { occasionId: string }) {
  const t = useTranslations("lifecycle.closeout");
  const f = useForm(proposeCloseAction);
  return (
    <form action={f.formAction} className="ed-form">
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <div className="ed-actionbar">
        <SubmitButton pendingLabel={t("closeSubmitting")}>{t("closeSubmit")}</SubmitButton>
      </div>
    </form>
  );
}

/** B10: lessons learned, saved to the signed-in account. */
export function LessonForm({ occasionId, initial }: { occasionId: string; initial: string }) {
  const t = useTranslations("lifecycle.lessons");
  const f = useForm(saveLessonAction, { refresh: true });
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.ok ? (
        <Notice tone="success" role="status">
          {t("saved")}
        </Notice>
      ) : null}
      {f.error && f.formLevel(["body"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextareaField id="lc-lesson" name="body" label={t("label")} hint={t("hint")} rows={5} maxLength={4000} defaultValue={f.value("body", initial)} error={f.fieldError("body")} />
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={t("saving")}>
          {t("save")}
        </SubmitButton>
      </div>
    </form>
  );
}
