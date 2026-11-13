"use client";

import { Button, FocusFirstError, Notice, Sheet, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteOccasionAction, proposeMoveDateAction, saveOccasionDetails } from "@/app/actions/occasions";
import { DateFields, type DateMode } from "../../_components/DateFields";
import { useForm } from "../../_components/useForm";

type Details = { title: string; venueName: string; venueAddress: string; purpose: string; priorities: string[] };

/** Title, venue and the event brief (A11) in one form — one save, one primary button. */
export function DetailsForm({ occasionId, initial }: { occasionId: string; initial: Details }) {
  const t = useTranslations("occasions");
  const c = useTranslations("common");
  const f = useForm(saveOccasionDetails, { refresh: true });
  const fields = ["title", "venueName", "venueAddress", "purpose", "priority0", "priority1", "priority2"];
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.ok ? <Notice tone="success" role="status">{t("settings.saved")}</Notice> : null}
      {f.error && f.formLevel(fields) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextField id="s-title" name="title" label={t("fields.title")} maxLength={120} required defaultValue={f.value("title", initial.title)} error={f.fieldError("title")} />
      <TextField id="s-venueName" name="venueName" label={t("fields.venueName")} optionalLabel={c("optional")} maxLength={160} defaultValue={f.value("venueName", initial.venueName)} error={f.fieldError("venueName")} />
      <TextField id="s-venueAddress" name="venueAddress" label={t("fields.venueAddress")} optionalLabel={c("optional")} maxLength={300} defaultValue={f.value("venueAddress", initial.venueAddress)} error={f.fieldError("venueAddress")} />
      <div id="brief" className="ed-form" style={{ scrollMarginTop: "var(--s-7)" }}>
        <div>
          <p className="ed-label">{t("brief.title")}</p>
          <p className="ed-small ed-muted">{t("brief.intro")}</p>
        </div>
        <TextareaField id="s-purpose" name="purpose" label={t("brief.purpose")} hint={t("brief.purposeHint")} optionalLabel={c("optional")} rows={3} maxLength={600} defaultValue={f.value("purpose", initial.purpose)} error={f.fieldError("purpose")} />
        {[0, 1, 2].map((i) => (
          <TextField
            key={i}
            id={`s-priority${i}`}
            name={`priority${i}`}
            label={t("brief.priority", { number: i + 1 })}
            optionalLabel={c("optional")}
            maxLength={200}
            defaultValue={f.value(`priority${i}`, initial.priorities[i] ?? "")}
            error={f.fieldError(`priority${i}`)}
          />
        ))}
      </div>
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={c("status.saving")}>{t("settings.save")}</SubmitButton>
      </div>
    </form>
  );
}

/** A2: a new date is only ever proposed here; the preview lists every task that would shift. */
export function MoveDateForm({ occasionId, mode, startsOn, endsOn }: { occasionId: string; mode: DateMode; startsOn: string; endsOn: string }) {
  const t = useTranslations("occasions");
  const f = useForm(proposeMoveDateAction);
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.error && f.formLevel(["startsOn", "endsOn"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <DateFields
        mode={(f.value("dateMode", mode) as DateMode) || mode}
        startsOn={f.value("startsOn", startsOn)}
        endsOn={f.value("endsOn", endsOn)}
        errors={{ startsOn: f.fieldError("startsOn"), endsOn: f.fieldError("endsOn") }}
      />
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={t("move.submitting")}>
          {t("move.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}

/** D6: the danger button names the occasion; the sheet repeats what happens and offers "keep". */
export function DeleteOccasion({ occasionId, title, days }: { occasionId: string; title: string; days: number }) {
  const t = useTranslations("occasions.deletion");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(deleteOccasionAction, { refresh: true, onSuccess: () => setOpen(false) });
  return (
    <>
      <Button type="button" variant="danger-quiet" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("confirmTitle")} closeLabel={c("actions.close")}>
        <p>{t("confirmBody", { title, days })}</p>
        {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
        <form action={f.formAction} className="ed-form">
          <input type="hidden" name="occasionId" value={occasionId} />
          <Button type="button" block onClick={() => setOpen(false)}>
            {t("keep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={c("status.deleting")}>
            {t("submit")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
