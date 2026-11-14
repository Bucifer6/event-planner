"use client";

import { ChoiceChips, DescriptionList, Notice, StepProgress, Stepper, SubmitButton, Textarea, VisuallyHidden } from "@ed/ui";
import { IconAlert, IconArrowLeft } from "@ed/ui/icons";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { submitRsvpAction } from "@/app/actions/rsvp";
import styles from "./guest.module.css";

// The RSVP as one question per screen (A6, Q3, Q4).
// - All wording arrives through `labels` in the LINK's language (the guest page never depends
//   on the account/cookie language), so this file ships no message catalogue.
// - Answers live in component state: they survive back / forward (history entries per step)
//   and a failed submit. Nothing is sent until "Trimite răspunsul" on the last screen.
// - The final submit is a single form action; the server applies it once however often it
//   arrives (one answer and one capacity claim per household).

export type WizardQuestion = {
  id: string;
  field: string;
  text: string;
  answerType: "choice" | "text";
  options: Array<{ id: string; label: string }>;
  required: boolean;
};

export type WizardLabels = {
  progress: string; // "Întrebarea {current} din {total}"
  optional: string;
  continue: string;
  back: string;
  send: string;
  sending: string;
  attendingQuestion: string;
  attendingYes: string;
  attendingMaybe: string;
  attendingNo: string;
  chooseAttending: string;
  adultsQuestion: string;
  adultsHint: string;
  childrenQuestion: string;
  childrenHint: string;
  decrease: string;
  increase: string;
  atLeastOneAdult: string;
  answerRequired: string;
  chooseOption: string;
  textHint: string;
  childDetailsTitle: string;
  childDetailsBody: string;
  emailQuestion: string;
  emailHint: string;
  emailHintOnFile: string;
  emailLabel: string;
  emailInvalid: string;
  reviewProgress: string;
  reviewTitle: string;
  reviewIntro: string;
  reviewAttending: string;
  reviewAdults: string;
  reviewChildren: string;
  reviewEmail: string;
  reviewEmailNone: string;
  reviewEmailKept: string;
  noAnswer: string;
  honeypot: string;
  retryAt: string; // "…după {time}"
};

type Values = {
  attending: "" | "yes" | "maybe" | "no";
  adults: number;
  children: number;
  answers: Record<string, string>;
  email: string;
};

type Step =
  | { kind: "attending" }
  | { kind: "adults" }
  | { kind: "children" }
  | { kind: "question"; q: WizardQuestion }
  | { kind: "email" }
  | { kind: "review" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
}

export function RsvpWizard({
  token,
  lang,
  stamp,
  stampField,
  honeypotField,
  doneHref,
  questions,
  initial,
  hasEmail,
  labels,
  intro,
  after,
}: {
  token: string;
  lang: "ro" | "en";
  stamp: string;
  stampField: string;
  honeypotField: string;
  doneHref: string;
  questions: WizardQuestion[];
  initial: Values;
  hasEmail: boolean;
  labels: WizardLabels;
  /** Shown above the first question only (the invitation plate). */
  intro?: ReactNode;
  /** Shown under the first question only (other sections of the link). */
  after?: ReactNode;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [childWarning, setChildWarning] = useState<string | null>(null); // field that was warned
  const [childAck, setChildAck] = useState(false);
  const [state, formAction] = useActionState(submitRsvpAction, null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const handled = useRef<unknown>(null);
  const moved = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [{ kind: "attending" }];
    if (values.attending === "yes" || values.attending === "maybe") {
      list.push({ kind: "adults" }, { kind: "children" });
      for (const q of questions) list.push({ kind: "question", q });
      list.push({ kind: "email" });
    }
    list.push({ kind: "review" });
    return list;
  }, [values.attending, questions]);
  // before the first answer the path is not known yet: count the full path
  const total = values.attending === "" ? questions.length + 5 : steps.length;
  const step = steps[Math.min(index, steps.length - 1)]!;

  const go = useCallback((next: number, push = true) => {
    setError(null);
    setIndex(next);
    moved.current = true;
    if (push) window.history.pushState({ edRsvpStep: next }, "");
  }, []);

  // browser back / forward walk the steps; answers stay in state
  useEffect(() => {
    window.history.replaceState({ edRsvpStep: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { edRsvpStep?: number } | null)?.edRsvpStep;
      setError(null);
      setIndex(typeof s === "number" ? s : 0);
      moved.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [index]);

  // the server's verdict on the final submit
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      router.replace(doneHref);
      router.refresh();
      return;
    }
    const fieldErrors = state.error.fieldErrors ?? {};
    const fields = Object.keys(fieldErrors);
    if (fields.length === 0) return; // form-level error: shown on the review screen
    const first = fields[0]!;
    const target = steps.findIndex(
      (s) =>
        (s.kind === "question" && s.q.field === first) ||
        (s.kind === "adults" && first === "adultsCount") ||
        (s.kind === "children" && first === "childrenCount") ||
        (s.kind === "attending" && first === "attending") ||
        (s.kind === "email" && first === "email"),
    );
    if (target < 0) return;
    const isChildWarning = state.error.message === labels.childDetailsTitle || fieldErrors[first]?.[0] === labels.childDetailsTitle;
    go(target);
    if (isChildWarning) {
      setChildWarning(first);
      setChildAck(true); // warned once: the next send goes through if the guest insists
    } else {
      setError(fieldErrors[first]?.[0] ?? state.error.message);
    }
  }, [state, steps, go, router, doneHref, labels.childDetailsTitle]);

  /** Reads the visible control into the answers. Returns the problem to show, if any. */
  function collect(fd: FormData): { next: Values; problem: string | null } {
    const next = { ...values, answers: { ...values.answers } };
    let problem: string | null = null;
    if (step.kind === "attending") {
      const v = fd.get("attending");
      if (v === "yes" || v === "maybe" || v === "no") {
        next.attending = v;
        if (v === "yes" && next.adults < 1) next.adults = 1;
      } else problem = labels.chooseAttending;
    } else if (step.kind === "adults") {
      next.adults = Number(fd.get("adultsCount") ?? 0);
      if (next.attending === "yes" && next.adults < 1) problem = labels.atLeastOneAdult;
    } else if (step.kind === "children") {
      next.children = Number(fd.get("childrenCount") ?? 0);
    } else if (step.kind === "question") {
      const v = String(fd.get(step.q.field) ?? "").trim();
      if (!v && step.q.required) problem = step.q.answerType === "choice" ? labels.chooseOption : labels.answerRequired;
      if (v !== (values.answers[step.q.id] ?? "") && childWarning === step.q.field) {
        // the text was edited after the warning: let the server look at it afresh
        setChildWarning(null);
        setChildAck(false);
      }
      next.answers[step.q.id] = v;
    } else if (step.kind === "email") {
      const v = String(fd.get("email") ?? "").trim();
      if (v && !EMAIL_RE.test(v)) problem = labels.emailInvalid;
      next.email = v;
    }
    return { next, problem };
  }

  function onStepSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { next, problem } = collect(new FormData(e.currentTarget));
    if (problem) return setError(problem);
    setValues(next);
    go(index + 1);
  }

  /** Going back keeps whatever is on the screen, valid or not yet. */
  function onBack() {
    if (formRef.current && step.kind !== "review" && step.kind !== "attending") {
      setValues(collect(new FormData(formRef.current)).next);
    }
    window.history.back();
  }

  const optionLabel = (q: WizardQuestion, id: string) => q.options.find((o) => o.id === id)?.label ?? "";
  const attendingLabel = { yes: labels.attendingYes, maybe: labels.attendingMaybe, no: labels.attendingNo, "": "" }[values.attending];
  const progressLabel =
    step.kind === "review" ? labels.reviewProgress : fill(labels.progress, { current: Math.min(index + 1, total), total });
  const headingId = "rsvp-question";
  const serverError = state && !state.ok ? state.error : null;

  const head = (title: string, optional?: boolean) => (
    <div className={styles.stepHead}>
      <StepProgress current={index + 1} total={total} label={progressLabel} />
      <p className="ed-label" aria-hidden>
        {progressLabel}
        {optional ? ` · ${labels.optional}` : ""}
      </p>
      <h2 className={styles.question} id={headingId} ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
    </div>
  );

  const errorLine = error ? (
    <p className="ed-field__error" role="alert">
      <IconAlert size={16} />
      <span>{error}</span>
    </p>
  ) : null;

  const bar = (primary: ReactNode) => (
    <div className="ed-actionbar">
      {primary}
      {index > 0 ? (
        <button type="button" className="ed-btn ed-btn--quiet" onClick={onBack}>
          <IconArrowLeft size={16} />
          {labels.back}
        </button>
      ) : null}
    </div>
  );
  const next = (
    <button type="submit" className="ed-btn ed-btn--primary">
      {labels.continue}
    </button>
  );

  if (step.kind === "review") {
    const rows: Array<{ term: ReactNode; value: ReactNode }> = [{ term: labels.reviewAttending, value: attendingLabel }];
    if (values.attending !== "no") {
      rows.push({ term: labels.reviewAdults, value: <span className="ed-num">{values.adults}</span> });
      rows.push({ term: labels.reviewChildren, value: <span className="ed-num">{values.children}</span> });
      for (const q of questions) {
        const v = values.answers[q.id] ?? "";
        rows.push({
          term: q.text,
          value: v ? (q.answerType === "choice" ? optionLabel(q, v) : v) : <span className="ed-unknown">{labels.noAnswer}</span>,
        });
      }
      rows.push({
        term: labels.reviewEmail,
        value: values.email || (hasEmail ? labels.reviewEmailKept : <span className="ed-unknown">{labels.reviewEmailNone}</span>),
      });
    }
    return (
      <form action={formAction} className={styles.step} noValidate>
        {head(labels.reviewTitle)}
        <p className="ed-muted">{labels.reviewIntro}</p>
        {serverError && Object.keys(serverError.fieldErrors ?? {}).length === 0 ? (
          <Notice tone="danger" title={serverError.message}>
            {serverError.retryAt
              ? fill(labels.retryAt, {
                  time: new Date(serverError.retryAt).toLocaleTimeString(lang === "ro" ? "ro-RO" : "en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })
              : null}
          </Notice>
        ) : null}
        <DescriptionList items={rows} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name={stampField} value={stamp} />
        <div className="ed-vh" aria-hidden="true">
          <label>
            {labels.honeypot}
            <input type="text" name={honeypotField} tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <input type="hidden" name="attending" value={values.attending} />
        <input type="hidden" name="adultsCount" value={values.attending === "no" ? 0 : values.adults} />
        <input type="hidden" name="childrenCount" value={values.attending === "no" ? 0 : values.children} />
        {values.attending !== "no"
          ? questions.map((q) => <input key={q.id} type="hidden" name={q.field} value={values.answers[q.id] ?? ""} />)
          : null}
        <input type="hidden" name="email" value={values.attending === "no" ? "" : values.email} />
        <input type="hidden" name="childAck" value={childAck ? "1" : "0"} />
        {bar(<SubmitButton pendingLabel={labels.sending}>{labels.send}</SubmitButton>)}
      </form>
    );
  }

  return (
    <>
      {index === 0 ? intro : null}
      <form ref={formRef} onSubmit={onStepSubmit} className={styles.step} noValidate key={`${step.kind}-${step.kind === "question" ? step.q.id : ""}`}>
        {step.kind === "attending" ? (
          <>
            {head(labels.attendingQuestion)}
            <ChoiceChips
              name="attending"
              stack
              legend={<VisuallyHidden>{labels.attendingQuestion}</VisuallyHidden>}
              defaultValue={values.attending || undefined}
              options={[
                { value: "yes", label: labels.attendingYes },
                { value: "maybe", label: labels.attendingMaybe },
                { value: "no", label: labels.attendingNo },
              ]}
            />
          </>
        ) : null}

        {step.kind === "adults" ? (
          <>
            {head(labels.adultsQuestion)}
            <p className="ed-muted">{labels.adultsHint}</p>
            <div className={styles.stepper}>
              <Stepper
                name="adultsCount"
                label={<VisuallyHidden>{labels.adultsQuestion}</VisuallyHidden>}
                defaultValue={values.adults}
                min={values.attending === "yes" ? 1 : 0}
                max={30}
                decreaseLabel={labels.decrease}
                increaseLabel={labels.increase}
              />
            </div>
          </>
        ) : null}

        {step.kind === "children" ? (
          <>
            {head(labels.childrenQuestion)}
            <p className="ed-muted">{labels.childrenHint}</p>
            <div className={styles.stepper}>
              <Stepper
                name="childrenCount"
                label={<VisuallyHidden>{labels.childrenQuestion}</VisuallyHidden>}
                defaultValue={values.children}
                min={0}
                max={30}
                decreaseLabel={labels.decrease}
                increaseLabel={labels.increase}
              />
            </div>
          </>
        ) : null}

        {step.kind === "question" ? (
          <>
            {head(step.q.text, !step.q.required)}
            {childWarning === step.q.field ? (
              <Notice tone="attention" title={labels.childDetailsTitle} role="alert">
                {labels.childDetailsBody}
              </Notice>
            ) : null}
            {step.q.answerType === "choice" ? (
              <ChoiceChips
                name={step.q.field}
                stack
                legend={<VisuallyHidden>{step.q.text}</VisuallyHidden>}
                defaultValue={values.answers[step.q.id] || undefined}
                options={step.q.options.map((o) => ({ value: o.id, label: o.label }))}
              />
            ) : (
              <div className="ed-field">
                <Textarea
                  name={step.q.field}
                  rows={4}
                  maxLength={1000}
                  aria-labelledby={headingId}
                  aria-describedby="rsvp-text-hint"
                  aria-invalid={error || childWarning === step.q.field ? true : undefined}
                  defaultValue={values.answers[step.q.id] ?? ""}
                />
                <span className="ed-field__hint" id="rsvp-text-hint">
                  {labels.textHint}
                </span>
              </div>
            )}
          </>
        ) : null}

        {step.kind === "email" ? (
          <>
            {head(labels.emailQuestion, true)}
            <p className="ed-muted">{hasEmail ? labels.emailHintOnFile : labels.emailHint}</p>
            <div className="ed-field">
              <label className="ed-field__label" htmlFor="rsvp-email">
                {labels.emailLabel}
              </label>
              <input
                id="rsvp-email"
                className="ed-input"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                aria-invalid={error ? true : undefined}
                defaultValue={values.email}
              />
            </div>
          </>
        ) : null}

        {errorLine}
        {bar(next)}
      </form>
      {index === 0 ? after : null}
    </>
  );
}
