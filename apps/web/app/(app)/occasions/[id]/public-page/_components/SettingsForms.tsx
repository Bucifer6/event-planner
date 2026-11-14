"use client";

import { FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { saveJourneyAction, savePublicPageAction } from "@/app/actions/publicpage";
import styles from "../../programme/_components/programme.module.css";

// The two long forms of the event-page settings: what the public page shows, and the
// accessible guest journey. Grouped with legends; errors beside their fields; typed input and
// every tick kept after a failed submit.

function Check({ name, label, hint, checked, onChange }: { name: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ed-check">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ed-check__text">
        <span>{label}</span>
        {hint ? <span className="ed-check__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export type PageSettingsValues = {
  slug: string;
  titleRo: string;
  titleEn: string;
  descriptionRo: string;
  descriptionEn: string;
  showDate: boolean;
  showVenue: boolean;
  showProgramme: boolean;
  showMenu: boolean;
  registrationEnabled: boolean;
  opensOn: string;
  closesOn: string;
  sharesCapacity: boolean;
  privacyUrl: string;
  published: boolean;
};

export type PageSettingsLabels = {
  optional: string;
  slug: string;
  slugHint: string;
  titleRo: string;
  titleEn: string;
  titleEnHint: string;
  descriptionRo: string;
  descriptionEn: string;
  descriptionHint: string;
  showLegend: string;
  showDate: string;
  showVenue: string;
  showProgramme: string;
  showMenu: string;
  registrationLegend: string;
  registrationEnabled: string;
  registrationHint: string;
  opensOn: string;
  closesOn: string;
  datesHint: string;
  sharesCapacity: string;
  sharesCapacityHint: string;
  privacyUrl: string;
  privacyUrlHint: string;
  published: string;
  publishedHint: string;
  save: string;
  saving: string;
  saved: string;
};

const FLAGS = ["showDate", "showVenue", "showProgramme", "showMenu", "registrationEnabled", "sharesCapacity", "published"] as const;

export function PageSettingsForm({ occasionId, initial, capacityNote, labels }: { occasionId: string; initial: PageSettingsValues; capacityNote: ReactNode; labels: PageSettingsLabels }) {
  const [state, formAction] = useActionState(savePublicPageAction, null);
  const [flags, setFlags] = useState<Record<(typeof FLAGS)[number], boolean>>(() => Object.fromEntries(FLAGS.map((f) => [f, initial[f]])) as Record<(typeof FLAGS)[number], boolean>);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const fe = error?.fieldErrors ?? {};
  const v = error?.values ?? {};
  const val = (name: keyof PageSettingsValues) => v[name] ?? String(initial[name] ?? "");
  const flag = (name: (typeof FLAGS)[number], label: string, hint?: string) => <Check name={name} label={label} hint={hint} checked={flags[name]} onChange={(on) => setFlags((f) => ({ ...f, [name]: on }))} />;
  const beside = !!error && Object.keys(fe).length > 0;

  return (
    <form action={formAction} className={`ed-form ${styles.narrow}`} noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {error && !beside ? <Notice tone="danger" title={error.message} role="alert" /> : null}
      <TextField id="pp-slug" name="slug" label={labels.slug} hint={labels.slugHint} required maxLength={60} autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue={val("slug")} error={fe.slug?.[0]} />
      <TextField id="pp-titleRo" name="titleRo" label={labels.titleRo} required maxLength={160} autoComplete="off" defaultValue={val("titleRo")} error={fe.titleRo?.[0]} />
      <TextField id="pp-titleEn" name="titleEn" label={labels.titleEn} hint={labels.titleEnHint} optionalLabel={labels.optional} maxLength={160} autoComplete="off" lang="en" defaultValue={val("titleEn")} error={fe.titleEn?.[0]} />
      <TextareaField id="pp-descriptionRo" name="descriptionRo" label={labels.descriptionRo} hint={labels.descriptionHint} optionalLabel={labels.optional} rows={3} maxLength={2000} defaultValue={val("descriptionRo")} error={fe.descriptionRo?.[0]} />
      <TextareaField id="pp-descriptionEn" name="descriptionEn" label={labels.descriptionEn} optionalLabel={labels.optional} rows={3} maxLength={2000} lang="en" defaultValue={val("descriptionEn")} error={fe.descriptionEn?.[0]} />

      <fieldset className="ed-fieldset">
        <legend className="ed-field__label">{labels.showLegend}</legend>
        <div className={styles.stackTight}>
          {flag("showDate", labels.showDate)}
          {flag("showVenue", labels.showVenue)}
          {flag("showProgramme", labels.showProgramme)}
          {flag("showMenu", labels.showMenu)}
        </div>
      </fieldset>

      <fieldset className="ed-fieldset">
        <legend className="ed-field__label">{labels.registrationLegend}</legend>
        <div className={styles.stack}>
          {flag("registrationEnabled", labels.registrationEnabled, labels.registrationHint)}
          {flags.registrationEnabled ? (
            <>
              <div className={styles.pair}>
                <TextField id="pp-opensOn" name="opensOn" type="date" label={labels.opensOn} optionalLabel={labels.optional} defaultValue={val("opensOn")} error={fe.opensOn?.[0]} />
                <TextField id="pp-closesOn" name="closesOn" type="date" label={labels.closesOn} optionalLabel={labels.optional} defaultValue={val("closesOn")} error={fe.closesOn?.[0]} />
              </div>
              <p className="ed-small ed-muted">{labels.datesHint}</p>
              {flag("sharesCapacity", labels.sharesCapacity, labels.sharesCapacityHint)}
              {flags.sharesCapacity ? <p className="ed-small ed-muted">{capacityNote}</p> : null}
              <TextField id="pp-privacyUrl" name="privacyUrl" type="url" inputMode="url" label={labels.privacyUrl} hint={labels.privacyUrlHint} optionalLabel={labels.optional} maxLength={500} autoComplete="off" placeholder="https://" defaultValue={val("privacyUrl")} error={fe.privacyUrl?.[0]} />
            </>
          ) : (
            <>
              {/* keep the stored values when the block is folded away */}
              <input type="hidden" name="opensOn" value={val("opensOn")} />
              <input type="hidden" name="closesOn" value={val("closesOn")} />
              <input type="hidden" name="privacyUrl" value={val("privacyUrl")} />
              {flags.sharesCapacity ? <input type="hidden" name="sharesCapacity" value="on" /> : null}
            </>
          )}
        </div>
      </fieldset>

      {flag("published", labels.published, labels.publishedHint)}

      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.saved}
        </Notice>
      ) : null}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div>
        <SubmitButton pendingLabel={labels.saving}>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}

/* ── Accessible guest journey ────────────────────────────────────────────── */

export type JourneyFactValue = { key: string; label: string; state: "yes" | "no" | "unknown"; noteRo: string; noteEn: string };
export type JourneyLabels = {
  optional: string;
  stateYes: string;
  stateNo: string;
  stateUnknown: string;
  noteRo: string;
  noteEn: string;
  noteHint: string;
  contactName: string;
  contactRoute: string;
  published: string;
  publishedHint: string;
  save: string;
  saving: string;
  saved: string;
};

export function JourneyForm({ occasionId, facts, contactName, contactRoute, published, labels }: { occasionId: string; facts: JourneyFactValue[]; contactName: string; contactRoute: string; published: boolean; labels: JourneyLabels }) {
  const [state, formAction] = useActionState(saveJourneyAction, null);
  const [states, setStates] = useState<Record<string, string>>(() => Object.fromEntries(facts.map((f) => [f.key, f.state])));
  const [isPublished, setPublished] = useState(published);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const v = error?.values ?? {};
  return (
    <form action={formAction} className={`ed-form ${styles.narrow}`} noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {error ? <Notice tone="danger" title={error.message} role="alert" /> : null}
      <div>
        {facts.map((f, n) => (
          <div className={styles.fieldGroup} key={f.key}>
            <fieldset className="ed-fieldset">
              <legend className="ed-field__label">{f.label}</legend>
              <div className="ed-chips">
                {(["yes", "no", "unknown"] as const).map((s) => (
                  <label className="ed-chip" key={s}>
                    <input type="radio" name={`fact_${f.key}_state`} value={s} checked={states[f.key] === s} onChange={() => setStates((prev) => ({ ...prev, [f.key]: s }))} />
                    <span>{s === "yes" ? labels.stateYes : s === "no" ? labels.stateNo : labels.stateUnknown}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={styles.pair}>
              <TextField id={`j-${f.key}-ro`} name={`fact_${f.key}_noteRo`} label={labels.noteRo} hint={n === 0 ? labels.noteHint : undefined} optionalLabel={labels.optional} maxLength={300} autoComplete="off" defaultValue={v[`fact_${f.key}_noteRo`] ?? f.noteRo} />
              <TextField id={`j-${f.key}-en`} name={`fact_${f.key}_noteEn`} label={labels.noteEn} optionalLabel={labels.optional} maxLength={300} autoComplete="off" lang="en" defaultValue={v[`fact_${f.key}_noteEn`] ?? f.noteEn} />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.pair}>
        <TextField id="j-contactName" name="contactName" label={labels.contactName} optionalLabel={labels.optional} maxLength={120} autoComplete="off" defaultValue={v.contactName ?? contactName} />
        <TextField id="j-contactRoute" name="contactRoute" label={labels.contactRoute} optionalLabel={labels.optional} maxLength={160} autoComplete="off" defaultValue={v.contactRoute ?? contactRoute} />
      </div>
      <Check name="published" label={labels.published} hint={labels.publishedHint} checked={isPublished} onChange={setPublished} />
      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.saved}
        </Notice>
      ) : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.saving}>
          {labels.save}
        </SubmitButton>
      </div>
    </form>
  );
}
