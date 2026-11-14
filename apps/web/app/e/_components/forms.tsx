"use client";

import { CopyButton, ExternalLink, FocusFirstError, Notice, Stepper, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { IconAlert } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { setMealChoicesAction } from "@/app/actions/menus";
import { cancelOwnRegistrationAction, registerPublicAction } from "@/app/actions/publicpage";
import { submitGuestRequestAction, submitRegistrantRequestAction } from "@/app/actions/requests";
import styles from "./event.module.css";
import { useKeptSubmit } from "./kept-form";

// The small client forms of the guest event page. Wording arrives through props in the page's
// language; every form carries the SEC11 bot guard (hidden stamp + honeypot). Choices that
// decide what else is shown are kept in state, so a failed submit never loses them.

/** Hidden fields every form posts, plus the honeypot. */
export type FormGuard = {
  hidden: Record<string, string>;
  stamp: string;
  stampField: string;
  honeypotField: string;
  honeypotLabel: string;
};

function Guard({ guard }: { guard: FormGuard }) {
  return (
    <>
      {Object.entries(guard.hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name={guard.stampField} value={guard.stamp} />
      <div className="ed-vh" aria-hidden="true">
        <label>
          {guard.honeypotLabel}
          <input type="text" name={guard.honeypotField} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
    </>
  );
}

function clock(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ro-RO", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Bucharest" }).format(new Date(iso));
}

function FormProblem({ error, retryAtText, lang, tone = "danger" }: { error: { message: string; retryAt?: string }; retryAtText: string; lang: string; tone?: "danger" | "attention" }) {
  return (
    <Notice tone={tone} title={error.message} role="alert">
      {error.retryAt ? retryAtText.replace("{time}", clock(error.retryAt, lang)) : null}
    </Notice>
  );
}

/** Controlled radio chips (same look as ChoiceChips) — the selection survives a failed submit. */
function Chips({ name, legend, options, value, onChange, error, stack }: { name: string; legend: string; options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void; error?: string; stack?: boolean }) {
  return (
    <fieldset className="ed-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="ed-field__label">{legend}</legend>
      <div className="ed-chips" data-stack={stack ? "" : undefined}>
        {options.map((o) => (
          <label className="ed-chip" key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <span className="ed-field__error" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
        </span>
      ) : null}
    </fieldset>
  );
}

/* ── Registration (public page) ──────────────────────────────────────────── */

export type RegistrationQuestion = {
  id: string;
  field: string;
  text: string;
  kind: "choice" | "text";
  options: Array<{ id: string; label: string }>;
  required: boolean;
  showIf: { questionId: string; optionId: string } | null;
};

export type RegistrationLabels = {
  name: string;
  email: string;
  emailHint: string;
  adults: string;
  children: string;
  childrenHint: string;
  decrease: string;
  increase: string;
  optional: string;
  consent: string;
  privacy: string;
  submit: string;
  sending: string;
  retryAt: string;
  registeredEyebrow: string;
  registeredTitle: string;
  waitlistedEyebrow: string;
  /** contains {n} */
  waitlistedTitle: string;
  waitlistedBody: string;
  linkTitle: string;
  linkBody: string;
  linkOpen: string;
  linkCopy: string;
  linkCopied: string;
  replayed: string;
};

export function RegistrationForm({
  guard,
  lang,
  idempotencyKey,
  questions,
  privacyUrl,
  maxAdults,
  maxChildren,
  labels,
}: {
  guard: FormGuard;
  lang: "ro" | "en";
  idempotencyKey: string;
  questions: RegistrationQuestion[];
  privacyUrl: string;
  maxAdults: number;
  maxChildren: number;
  labels: RegistrationLabels;
}) {
  const [state, formAction, pending] = useActionState(registerPublicAction, null);
  const keptSubmit = useKeptSubmit(formAction);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [origin, setOrigin] = useState("");
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (state?.ok) resultRef.current?.focus();
  }, [state]);

  if (state?.ok) {
    const r = state.data;
    const url = r.managePath ? `${origin}${r.managePath}?lang=${lang}` : null;
    return (
      <div className={styles.result} role="status">
        <p className="ed-label">{r.status === "registered" ? labels.registeredEyebrow : labels.waitlistedEyebrow}</p>
        <h3 className={styles.resultTitle} tabIndex={-1} ref={resultRef}>
          {r.status === "registered" ? labels.registeredTitle : labels.waitlistedTitle.replace("{n}", String(r.position ?? 1))}
        </h3>
        {r.status === "waitlisted" ? <p className="ed-muted">{labels.waitlistedBody}</p> : null}
        {url ? (
          <div className={styles.linkBox}>
            <Notice title={labels.linkTitle}>
              <p>{labels.linkBody}</p>
              <p className={`ed-small ed-num ${styles.wrap}`}>{url}</p>
            </Notice>
            <div className={styles.actions}>
              <a className="ed-btn ed-btn--primary" href={`${r.managePath}?lang=${lang}`}>
                {labels.linkOpen}
              </a>
              <CopyButton text={url} label={labels.linkCopy} copiedLabel={labels.linkCopied} />
            </div>
          </div>
        ) : (
          <p className="ed-muted">{labels.replayed}</p>
        )}
      </div>
    );
  }

  const error = state && !state.ok ? state.error : null;
  const fe = error?.fieldErrors ?? {};
  const values = error?.values ?? {};
  const besideField = !!error && error.code === "VALIDATION" && Object.keys(fe).length > 0;
  const visible = (q: RegistrationQuestion) => !q.showIf || choices[q.showIf.questionId] === q.showIf.optionId;

  return (
    <form action={formAction} onSubmit={keptSubmit} className="ed-form" noValidate>
      <Guard guard={guard} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {error && !besideField ? <FormProblem error={error} retryAtText={labels.retryAt} lang={lang} /> : null}
      <TextField id="reg-name" name="name" label={labels.name} autoComplete="name" maxLength={120} required defaultValue={values.name ?? ""} error={fe.name?.[0]} />
      <TextField id="reg-email" name="email" type="email" inputMode="email" label={labels.email} hint={labels.emailHint} autoComplete="email" maxLength={254} required defaultValue={values.email ?? ""} error={fe.email?.[0]} />
      <div className={styles.pair}>
        <Stepper name="adults" label={labels.adults} defaultValue={1} min={1} max={maxAdults} decreaseLabel={labels.decrease} increaseLabel={labels.increase} />
        <Stepper name="children" label={labels.children} defaultValue={0} min={0} max={maxChildren} decreaseLabel={labels.decrease} increaseLabel={labels.increase} />
      </div>
      <p className="ed-small ed-muted">{labels.childrenHint}</p>

      {questions.filter(visible).map((q) =>
        q.kind === "choice" ? (
          <Chips
            key={q.id}
            name={q.field}
            legend={q.required ? q.text : `${q.text} (${labels.optional})`}
            options={q.options.map((o) => ({ value: o.id, label: o.label }))}
            value={choices[q.id] ?? ""}
            onChange={(v) => setChoices((c) => ({ ...c, [q.id]: v }))}
            error={fe[q.field]?.[0]}
            stack={q.options.length > 3}
          />
        ) : (
          <TextareaField key={q.id} id={`reg-${q.id}`} name={q.field} label={q.text} optionalLabel={q.required ? undefined : labels.optional} rows={2} maxLength={1000} defaultValue={values[q.field] ?? ""} error={fe[q.field]?.[0]} />
        ),
      )}

      <div className="ed-field">
        <label className="ed-check">
          <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={fe.consent ? true : undefined} />
          <span className="ed-check__text">
            <span>{labels.consent}</span>
            <span className="ed-check__hint">
              <ExternalLink href={privacyUrl}>{labels.privacy}</ExternalLink>
            </span>
          </span>
        </label>
        {fe.consent ? (
          <span className="ed-field__error" role="alert">
            <IconAlert size={16} />
            <span>{fe.consent[0]}</span>
          </span>
        ) : null}
      </div>
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <div className="ed-actionbar">
        <SubmitButton pendingLabel={labels.sending} pending={pending}>
          {labels.submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/* ── Cancel (manage link) ────────────────────────────────────────────────── */

export function CancelRegistrationForm({ slug, token, lang, doneHref, labels }: { slug: string; token: string; lang: "ro" | "en"; doneHref: string; labels: { submit: string; cancelling: string; retryAt: string } }) {
  const [state, formAction] = useActionState(cancelOwnRegistrationAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.replace(doneHref);
  }, [state, router, doneHref]);
  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />
      {state && !state.ok ? <FormProblem error={state.error} retryAtText={labels.retryAt} lang={lang} /> : null}
      <SubmitButton variant="danger" pendingLabel={labels.cancelling}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}

/* ── Private request (guest link and manage link) ────────────────────────── */

export type RequestLabels = {
  kind: string;
  kindDietary: string;
  kindAccess: string;
  kindOther: string;
  dietTag: string;
  dietTagNone: string;
  body: string;
  bodyHint: string;
  optional: string;
  /** The translated child-details error, to recognise the gentle warning. */
  childDetailsMessage: string;
  childWarningTitle: string;
  childWarningBody: string;
  sendAnyway: string;
  send: string;
  sending: string;
  sent: string;
  retryAt: string;
};

export function PrivateRequestForm({ mode, guard, lang, dietTags, labels }: { mode: "guest" | "registrant"; guard: FormGuard; lang: "ro" | "en"; dietTags: Array<{ value: string; label: string }>; labels: RequestLabels }) {
  const [state, formAction, pending] = useActionState(mode === "guest" ? submitGuestRequestAction : submitRegistrantRequestAction, null);
  const keptSubmit = useKeptSubmit(formAction);
  const [kind, setKind] = useState("");
  const [dietTag, setDietTag] = useState("");
  const [body, setBody] = useState("");
  const [warned, setWarned] = useState(false);
  const router = useRouter();
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      setKind("");
      setDietTag("");
      setBody("");
      setWarned(false);
      router.refresh();
    } else if (state.error.message === labels.childDetailsMessage) {
      setWarned(true);
    }
  }, [state, router, labels.childDetailsMessage]);

  const error = state && !state.ok ? state.error : null;
  const childWarning = !!error && error.message === labels.childDetailsMessage;
  const fe = error?.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={keptSubmit} className="ed-form" noValidate>
      <Guard guard={guard} />
      <input type="hidden" name="childDetailsAcknowledged" value={warned ? "1" : ""} />
      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.sent}
        </Notice>
      ) : null}
      {childWarning ? (
        <Notice tone="attention" title={labels.childWarningTitle} role="alert">
          {labels.childWarningBody}
        </Notice>
      ) : error && !(error.code === "VALIDATION" && (fe.kind || fe.body)) ? (
        <FormProblem error={error} retryAtText={labels.retryAt} lang={lang} />
      ) : null}
      <Chips
        name="kind"
        legend={labels.kind}
        value={kind}
        onChange={(v) => {
          setKind(v);
          if (v !== "dietary") setDietTag("");
        }}
        options={[
          { value: "dietary", label: labels.kindDietary },
          { value: "access", label: labels.kindAccess },
          { value: "other", label: labels.kindOther },
        ]}
        error={fe.kind?.[0]}
      />
      {kind === "dietary" ? (
        <div className="ed-field">
          <label className="ed-field__label" htmlFor={`${mode}-diet`}>
            {labels.dietTag}
          </label>
          <select className="ed-select" id={`${mode}-diet`} name="dietTag" value={dietTag} onChange={(e) => setDietTag(e.target.value)}>
            <option value="">{labels.dietTagNone}</option>
            {dietTags.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <TextareaField
        id={`${mode}-request-body`}
        name="body"
        label={labels.body}
        hint={labels.bodyHint}
        optionalLabel={kind === "dietary" && dietTag ? labels.optional : undefined}
        rows={3}
        maxLength={1000}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setWarned(false);
        }}
        error={childWarning ? undefined : fe.body?.[0]}
      />
      <FocusFirstError errors={childWarning ? null : (error?.fieldErrors ?? null)} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.sending} pending={pending}>
          {warned && childWarning ? labels.sendAnyway : labels.send}
        </SubmitButton>
      </div>
    </form>
  );
}

/* ── Meal choices (guest link) ───────────────────────────────────────────── */

export type MealChoiceGroup = {
  key: string;
  legend: string;
  party: number;
  partyText: string;
  options: Array<{ itemId: string; name: string; note: string | null; count: number }>;
};

export function MealChoiceForm({ guard, lang, groups, labels }: { guard: FormGuard; lang: "ro" | "en"; groups: MealChoiceGroup[]; labels: { decrease: string; increase: string; save: string; saving: string; saved: string; retryAt: string } }) {
  const [state, formAction] = useActionState(setMealChoicesAction, null);
  const router = useRouter();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const fe = error?.fieldErrors ?? {};
  const groupError = (key: string) => fe[`group_${key}`]?.[0];
  const general = error && !groups.some((g) => groupError(g.key));
  return (
    <form action={formAction} className="ed-form" noValidate>
      <Guard guard={guard} />
      <div>
        {groups.map((g) => (
          <fieldset className={`ed-fieldset ${styles.choiceGroup}`} key={g.key} aria-invalid={groupError(g.key) ? true : undefined}>
            <legend className="ed-field__label">
              {g.legend} <span className="ed-muted">· {g.partyText}</span>
            </legend>
            {g.options.map((o) => (
              <div className={styles.option} key={o.itemId}>
                <Stepper name={`choice_${o.itemId}`} label={o.note ? `${o.name} — ${o.note}` : o.name} defaultValue={o.count} min={0} max={g.party} decreaseLabel={`${labels.decrease}: ${o.name}`} increaseLabel={`${labels.increase}: ${o.name}`} />
              </div>
            ))}
            {groupError(g.key) ? (
              <span className="ed-field__error" role="alert">
                <IconAlert size={16} />
                <span>{groupError(g.key)}</span>
              </span>
            ) : null}
          </fieldset>
        ))}
      </div>
      {state?.ok ? (
        <Notice tone="success" role="status">
          {labels.saved}
        </Notice>
      ) : null}
      {general && error ? <FormProblem error={error} retryAtText={labels.retryAt} lang={lang} /> : null}
      <div>
        <SubmitButton variant="secondary" pendingLabel={labels.saving}>
          {labels.save}
        </SubmitButton>
      </div>
    </form>
  );
}
