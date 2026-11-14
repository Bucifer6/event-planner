"use client";

import { Checkbox, FocusFirstError, SelectField, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { sendEnquiryAction } from "@/app/actions/enquiries";
import { FormError } from "@/app/(auth)/_components/forms";
import { FileField } from "@/components/upload/FileField";
import styles from "../../../_slots/slots.module.css";

export type EnquiryFormProps = {
  mode: "enquiry" | "quote";
  occasionId: string;
  listingId: string;
  idempotencyKey: string;
  hasEmail: boolean;
  /** Upload purpose for the photo / sketch (quote requests). */
  attachmentPurpose: string;
  kinds: Array<{ value: string; label: string }>;
  counties: Array<{ code: string; name: string }>;
  localities: Array<{ id: string; countyCode: string; name: string }>;
  budgets: Array<{ value: string; label: string }>;
  defaults: { occasionKind: string; date: string; guests: string; countyCode: string; localityId: string };
};

/**
 * The enquiry form (P8, P9) and its flower-quote variant (F4, F5). Every field arrives
 * pre-filled from the plan and stays editable; what is on screen is exactly what is sent.
 * A failed submit keeps everything typed and puts each error beside its field.
 */
export function EnquiryForm({ mode, occasionId, listingId, idempotencyKey, hasEmail, attachmentPurpose, kinds, counties, localities, budgets, defaults }: EnquiryFormProps) {
  const t = useTranslations("enquiries");
  const [state, formAction] = useActionState(sendEnquiryAction, null);
  const error = state && !state.ok ? state.error : null;
  const err = (name: string) => error?.fieldErrors?.[name]?.[0];
  const val = (name: string, fallback: string) => error?.values?.[name] ?? fallback;
  const [county, setCounty] = useState(val("countyCode", defaults.countyCode));
  const [locality, setLocality] = useState(val("localityId", defaults.localityId));
  const places = localities.filter((l) => l.countyCode === county);
  const quote = mode === "quote";

  return (
    <form action={formAction} className="ed-form" noValidate>
      <FormError state={state} skipFields={["occasionKind", "date", "guests", "countyCode", "localityId", "budgetBand", "message", "description", "imageAssetId", "shareEmail"]} />
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {quote ? (
        <>
          <TextareaField
            id="enq-description"
            name="description"
            label={t("form.arrangement")}
            hint={t("form.arrangementHint")}
            rows={5}
            maxLength={4000}
            required
            defaultValue={val("description", "")}
            error={err("description") ?? err("arrangement.description")}
          />
          <FileField label={t("form.image")} purpose={attachmentPurpose} ownerId={occasionId} name="imageAssetId" optionalLabel={t("form.optional")} />
        </>
      ) : (
        <SelectField id="enq-kind" name="occasionKind" label={t("form.kind")} defaultValue={val("occasionKind", defaults.occasionKind)} error={err("occasionKind")}>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectField>
      )}

      <div className={styles.pair}>
        <TextField id="enq-date" name="date" type="date" label={t("form.date")} hint={t("form.dateHint")} optionalLabel={t("form.optional")} defaultValue={val("date", defaults.date)} error={err("date")} />
        <TextField
          id="enq-guests"
          name="guests"
          type="text"
          inputMode="numeric"
          label={t("form.guests")}
          hint={t("form.guestsHint")}
          optionalLabel={t("form.optional")}
          maxLength={6}
          defaultValue={val("guests", defaults.guests)}
          error={err("guests")}
        />
      </div>

      {quote ? null : (
        <>
          <div className={styles.pair}>
            <SelectField
              id="enq-county"
              name="countyCode"
              label={t("form.county")}
              optionalLabel={t("form.optional")}
              value={county}
              onChange={(e) => {
                setCounty(e.currentTarget.value);
                setLocality("");
              }}
              error={err("countyCode")}
            >
              <option value="">{t("form.anyCounty")}</option>
              {counties.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="enq-locality"
              name="localityId"
              label={t("form.locality")}
              optionalLabel={t("form.optional")}
              value={locality}
              onChange={(e) => setLocality(e.currentTarget.value)}
              disabled={!county}
              error={err("localityId")}
            >
              <option value="">{t("form.anyLocality")}</option>
              {places.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
          </div>
          <SelectField id="enq-budget" name="budgetBand" label={t("form.budget")} hint={t("form.budgetHint")} optionalLabel={t("form.optional")} defaultValue={val("budgetBand", "")} error={err("budgetBand")}>
            <option value="">{t("form.budgetNone")}</option>
            {budgets.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </SelectField>
        </>
      )}

      <TextareaField
        id="enq-message"
        name="message"
        label={t("form.message")}
        hint={t("form.messageHint")}
        optionalLabel={quote ? t("form.optional") : undefined}
        rows={6}
        maxLength={4000}
        required={!quote}
        defaultValue={val("message", "")}
        error={err("message")}
      />

      {hasEmail ? (
        <div>
          <Checkbox
            key={`share:${error ? (error.values?.shareEmail ?? "off") : "initial"}`}
            name="shareEmail"
            label={t("form.shareEmail")}
            hint={t("form.shareEmailHint")}
            defaultChecked={error ? error.values?.shareEmail === "on" : false}
          />
          {err("shareEmail") ? (
            <span className="ed-field__error" role="alert">
              {err("shareEmail")}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="ed-small ed-muted">{t("form.shareEmailNoEmail")}</p>
      )}

      <div className={styles.shared}>
        <span className="ed-label">{t("form.sharedTitle")}</span>
        <p className="ed-small">{quote ? t("form.sharedBodyQuote") : t("form.sharedBody")}</p>
      </div>

      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div className="ed-actionbar">
        <SubmitButton pendingLabel={t("form.submitting")}>{quote ? t("form.submitQuote") : t("form.submit")}</SubmitButton>
      </div>
    </form>
  );
}
