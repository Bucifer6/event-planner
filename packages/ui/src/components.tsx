import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { IconAlert, IconExternal, IconInfo, IconSuccess } from "./icons";

/**
 * Maison components. All are server-safe (no hooks); interactive ones live in ./client.
 * None contains user-facing copy: every string arrives through props from @ed/i18n.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Gap = 1 | 2 | 3 | 4 | 5 | 6;
type DivProps = HTMLAttributes<HTMLDivElement>;

/* ── Layout ─────────────────────────────────────────────────────────────── */

export function Page({ narrow, className, ...rest }: DivProps & { narrow?: boolean }) {
  return <div className={cx("ed-page", narrow && "ed-page--narrow", className)} {...rest} />;
}

export function Stack({ gap = 3, className, ...rest }: DivProps & { gap?: Gap }) {
  return <div className={cx("ed-stack", className)} data-gap={gap} {...rest} />;
}

export function Cluster({
  gap = 2,
  justify,
  align,
  className,
  ...rest
}: DivProps & { gap?: 2 | 3 | 4; justify?: "between" | "end"; align?: "start" | "baseline" }) {
  return <div className={cx("ed-cluster", className)} data-gap={gap} data-justify={justify} data-align={align} {...rest} />;
}

export function Grid({ cols = 2, className, ...rest }: DivProps & { cols?: 2 | 3 | 4 | "aside" }) {
  return <div className={cx("ed-grid", className)} data-cols={cols} {...rest} />;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ed-vh">{children}</span>;
}

/* ── Type ───────────────────────────────────────────────────────────────── */

export function Eyebrow({ plain, className, children }: { plain?: boolean; className?: string; children: ReactNode }) {
  return (
    <p className={cx("ed-eyebrow", className)} data-plain={plain ? "" : undefined}>
      {children}
    </p>
  );
}

export function Lead({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx("ed-lead", className)} {...rest} />;
}

/** Principle 5: a missing price, dimension or confirmation is shown as the word, never as zero. */
export function Unknown({ label }: { label: string }) {
  return <span className="ed-unknown">{label}</span>;
}

/** Renders `value` or the italic "unknown" when it is null/undefined. Zero is a real value. */
export function ValueOrUnknown({ value, unknownLabel }: { value: ReactNode | null | undefined; unknownLabel: string }) {
  if (value === null || value === undefined || value === "") return <Unknown label={unknownLabel} />;
  return <>{value}</>;
}

/* ── Page furniture ─────────────────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  level = 1,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2;
}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <header className="ed-pagehead">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <div className="ed-pagehead__row">
        <H>{title}</H>
        {actions ? <div className="ed-cluster">{actions}</div> : null}
      </div>
      {description ? <p className="ed-pagehead__desc">{description}</p> : null}
    </header>
  );
}

export function Section({
  title,
  eyebrow,
  actions,
  children,
  id,
  level = 2,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section className="ed-section" id={id}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      {title || actions ? (
        <div className="ed-section__head">
          {title ? <H>{title}</H> : <span />}
          {actions ? <div className="ed-cluster">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({
  framed,
  tone,
  pad,
  className,
  ...rest
}: DivProps & { framed?: boolean; tone?: "sunken" | "plain"; pad?: 3 }) {
  return <div className={cx("ed-card", framed && "ed-card--framed", className)} data-tone={tone} data-pad={pad} {...rest} />;
}

export function GiltRule() {
  return <hr className="ed-rule-gilt" />;
}

/* ── Buttons & links ────────────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-quiet";
type ButtonLook = { variant?: ButtonVariant; block?: boolean; size?: "sm" | "md" };

function buttonClass({ variant = "secondary", block, size }: ButtonLook, className?: string) {
  return cx(
    "ed-btn",
    variant !== "secondary" && `ed-btn--${variant}`,
    block && "ed-btn--block",
    size === "sm" && "ed-btn--sm",
    className,
  );
}

/** One `variant="primary"` per view. Label says what happens ("Trimite invitațiile"). */
export function Button({
  variant,
  block,
  size,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook) {
  return <button type={type} className={buttonClass({ variant, block, size }, className)} {...rest} />;
}

/** An anchor that looks like a button. Pass `href`; compose with next/link via `legacyBehavior`-free `<Link className={buttonClassName()}>`. */
export function LinkButton({ variant, block, size, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonLook) {
  return <a className={buttonClass({ variant, block, size }, className)} {...rest} />;
}

/** For `next/link`: `<Link href className={buttonClassName({ variant: "primary" })}>`. */
export function buttonClassName(look: ButtonLook = {}, className?: string) {
  return buttonClass(look, className);
}

export function IconButton({
  label,
  className,
  type = "button",
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string }) {
  return (
    <button type={type} className={cx("ed-btn ed-btn--icon", className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/** SEC7: every external link carries rel="noopener noreferrer". */
export function ExternalLink({ children, className, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "rel" | "target">) {
  return (
    <a className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
      <IconExternal size={14} style={{ display: "inline", marginLeft: 4, verticalAlign: "-1px" }} />
    </a>
  );
}

/* ── Forms ──────────────────────────────────────────────────────────────── */

export type FieldProps = {
  /** id of the control inside; the label, hint and error are wired to it */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Words that say how to fix it. Shown beside the field with an icon — never colour alone. */
  error?: ReactNode;
  optionalLabel?: string;
  children: ReactNode;
};

/**
 * Label above, hint below the label, error under the control.
 * Give the control `id`, `aria-describedby={fieldDescribedBy(id, {hint, error})}` and
 * `aria-invalid` — or simply use <TextField>/<SelectField>/<TextareaField>.
 */
export function Field({ id, label, hint, error, optionalLabel, children }: FieldProps) {
  return (
    <div className="ed-field">
      <label className="ed-field__label" htmlFor={id}>
        {label}
        {optionalLabel ? <span className="ed-field__optional"> · {optionalLabel}</span> : null}
      </label>
      {hint ? (
        <span className="ed-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="ed-field__error" id={`${id}-error`} role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}

export function fieldDescribedBy(id: string, has: { hint?: unknown; error?: unknown }): string | undefined {
  const ids = [has.hint ? `${id}-hint` : null, has.error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

type FieldWiring = { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; optionalLabel?: string };

export function TextField({
  id,
  label,
  hint,
  error,
  optionalLabel,
  className,
  code,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & FieldWiring & { code?: boolean }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <input
        id={id}
        className={cx("ed-input", code && "ed-input--code", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, { hint, error })}
        {...rest}
      />
    </Field>
  );
}

export function TextareaField({
  id,
  label,
  hint,
  error,
  optionalLabel,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & FieldWiring) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <textarea
        id={id}
        className={cx("ed-textarea", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, { hint, error })}
        {...rest}
      />
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  optionalLabel,
  className,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & FieldWiring) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <select
        id={id}
        className={cx("ed-select", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, { hint, error })}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("ed-input", className)} {...rest} />;
}
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("ed-select", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("ed-textarea", className)} {...rest} />;
}

export function Checkbox({
  label,
  hint,
  type = "checkbox",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; hint?: ReactNode; type?: "checkbox" | "radio" }) {
  return (
    <label className="ed-check">
      <input type={type} {...rest} />
      <span className="ed-check__text">
        <span>{label}</span>
        {hint ? <span className="ed-check__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

export type ChipOption = { value: string; label: ReactNode; disabled?: boolean };

/** Radio (or checkbox) group drawn as ≥48px chips — the phone-first answer control. */
export function ChoiceChips({
  name,
  legend,
  options,
  defaultValue,
  multiple,
  stack,
  required,
  error,
}: {
  name: string;
  legend: ReactNode;
  options: ChipOption[];
  defaultValue?: string | string[];
  multiple?: boolean;
  stack?: boolean;
  required?: boolean;
  error?: ReactNode;
}) {
  const selected = new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []);
  return (
    <fieldset className="ed-fieldset" aria-invalid={error ? true : undefined}>
      <legend className="ed-field__label">{legend}</legend>
      <div className="ed-chips" data-stack={stack ? "" : undefined}>
        {options.map((o) => (
          <label className="ed-chip" key={o.value}>
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name}
              value={o.value}
              defaultChecked={selected.has(o.value)}
              disabled={o.disabled}
              required={required && !multiple}
            />
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

/* ── Status ─────────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "success" | "danger" | "attention" | "accent";

/** A state in words (plus a diamond mark) — colour is never the only signal. */
export function Tag({ tone = "neutral", plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) {
  return (
    <span className="ed-tag" data-tone={tone === "neutral" ? undefined : tone} data-plain={plain ? "" : undefined}>
      {children}
    </span>
  );
}

/** A system-stated fact (e.g. "Verificat: înregistrare ONRC"). Never styled as endorsement. */
export function Fact({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="ed-fact">
      {icon}
      {children}
    </span>
  );
}

/** P14: the paid-placement label, set in the same weight and size as the business name. */
export function PaidLabel({ children }: { children: ReactNode }) {
  return <span className="ed-paid">{children}</span>;
}

export function Notice({
  tone = "neutral",
  title,
  children,
  actions,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status";
}) {
  const icon =
    tone === "danger" || tone === "attention" ? <IconAlert /> : tone === "success" ? <IconSuccess /> : <IconInfo />;
  return (
    <div className="ed-notice" data-tone={tone === "neutral" ? undefined : tone} role={role ?? (tone === "danger" ? "alert" : "status")}>
      {icon}
      <div className="ed-notice__body">
        {title ? <span className="ed-notice__title">{title}</span> : null}
        {children ? <div>{children}</div> : null}
        {actions ? <div className="ed-cluster">{actions}</div> : null}
      </div>
    </div>
  );
}

/* ── Data ───────────────────────────────────────────────────────────────── */

/** The one number that matters. Always give it a `label` with its period and, when known, a `note` with the change. */
export function Figure({
  label,
  value,
  unit,
  note,
  noteTone,
  size,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  noteTone?: "danger" | "success";
  size?: "hero" | "sm";
}) {
  return (
    <div className="ed-figure" data-size={size}>
      <span className="ed-figure__label">{label}</span>
      <span className="ed-figure__value">
        {value}
        {unit ? <span className="ed-figure__unit">{unit}</span> : null}
      </span>
      {note ? (
        <span className="ed-figure__note" data-tone={noteTone}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

export function Figures({ children }: { children: ReactNode }) {
  return <div className="ed-figures">{children}</div>;
}

/** Progress as a hairline. `value`/`max` are real numbers; the label carries the words. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: ReactNode; tone?: "danger" | "success" }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="ed-meter" data-tone={tone}>
      <span className="ed-small ed-muted">{label}</span>
      <div className="ed-meter__track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="ed-meter__fill" style={{ transform: `scaleX(${ratio})` }} />
      </div>
    </div>
  );
}

export type BarItem = { key: string; label: ReactNode; value: number; display: ReactNode; highlight?: boolean };

/** Sorted horizontal bars from zero — use instead of a pie for more than three parts. */
export function BarList({ items, sort = true }: { items: BarItem[]; sort?: boolean }) {
  const rows = sort ? [...items].sort((a, b) => b.value - a.value) : items;
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="ed-bars">
      {rows.map((r) => (
        <li className="ed-bars__row" key={r.key} data-highlight={r.highlight ? "" : undefined}>
          <span>{r.label}</span>
          <span className="ed-bars__value">{r.display}</span>
          <div className="ed-bars__track">
            <div className="ed-bars__fill" style={{ transform: `scaleX(${max > 0 ? r.value / max : 0})` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function List({ flush, className, ...rest }: HTMLAttributes<HTMLUListElement> & { flush?: boolean }) {
  return <ul className={cx("ed-list", className)} data-flush={flush ? "" : undefined} {...rest} />;
}

/** A list row: optional italic index, title + meta, trailing slot. Wrap in <a className="ed-row"> yourself for links. */
export function Row({
  index,
  title,
  meta,
  end,
  children,
}: {
  index?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="ed-row">
      {index !== undefined ? <span className="ed-row__index">{index}</span> : null}
      <div className="ed-row__main">
        <span className="ed-row__title">{title}</span>
        {meta ? <span className="ed-row__meta">{meta}</span> : null}
        {children}
      </div>
      {end ? <div className="ed-row__end">{end}</div> : null}
    </li>
  );
}

export function DescriptionList({ cols, items }: { cols?: 2 | 3; items: Array<{ term: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="ed-dl" data-cols={cols}>
      {items.map((it, i) => (
        <div key={i}>
          <dt>{it.term}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Scrolls sideways on a phone instead of breaking the page. Put a plain <table className="ed-table"> inside via <Table>. */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="ed-tablewrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="ed-table">
        <caption className="ed-vh">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ed-empty">
      <span className="ed-empty__title">{title}</span>
      {children ? <p className="ed-empty__text">{children}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ width, height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className="ed-skeleton" style={{ width: width ?? "100%", height }} aria-hidden />;
}

/* ── What-if ────────────────────────────────────────────────────────────── */

export type DeltaRow = { key: string; what: ReactNode; kind?: ReactNode; before?: ReactNode; after?: ReactNode; note?: ReactNode };

/** Principle 3: shows what will change, before → after. Nothing is applied until the user confirms. */
export function DeltaList({ rows }: { rows: DeltaRow[] }) {
  return (
    <ul className="ed-delta">
      {rows.map((r) => (
        <li className="ed-delta__row" key={r.key}>
          {r.kind ? <span className="ed-delta__kind">{r.kind}</span> : null}
          <span className="ed-delta__what">{r.what}</span>
          {r.before !== undefined || r.after !== undefined ? (
            <span className="ed-delta__change">
              {r.before !== undefined ? <span className="ed-delta__before">{r.before}</span> : null}
              {r.after !== undefined ? <span className="ed-delta__after">{r.after}</span> : null}
            </span>
          ) : null}
          {r.note ? <span className="ed-small ed-muted">{r.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Brand ──────────────────────────────────────────────────────────────── */

/** The house seal: E·D inside a gilt ring. */
export function Seal({ size = 32 }: { size?: number }) {
  return (
    <svg className="ed-seal" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden focusable="false">
      <circle className="ed-seal__ring" cx="20" cy="20" r="19" strokeWidth="1" />
      <circle className="ed-seal__ring" cx="20" cy="20" r="16" strokeWidth="0.5" />
      <text
        x="20"
        y="25.5"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize="15"
        fontStyle="italic"
        fill="currentColor"
        letterSpacing="-0.5"
      >
        ed
      </text>
    </svg>
  );
}

export function Wordmark({ href = "/", label }: { href?: string; label: string }) {
  return (
    <a className="ed-wordmark" href={href} aria-label={label}>
      <Seal />
      <span>
        Event<em>Desk</em>
      </span>
      <span className="ed-wordmark__tld">.ro</span>
    </a>
  );
}

/** Guest-facing invitation plate. */
export function Invitation({
  kicker,
  title,
  meta,
  children,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="ed-invite">
      {kicker ? <span className="ed-invite__kicker">{kicker}</span> : null}
      <h1 className="ed-invite__title">{title}</h1>
      <svg className="ed-invite__ornament" width={96} height={12} viewBox="0 0 96 12" fill="none" stroke="currentColor" aria-hidden focusable="false">
        <path d="M0 6h38M58 6h38" />
        <path d="M48 1l5 5-5 5-5-5z" />
      </svg>
      {meta ? <p className="ed-invite__meta">{meta}</p> : null}
      {children}
    </div>
  );
}

/** "Question 2 of 5" as hairlines; pass the words in `label` for screen readers. */
export function StepProgress({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="ed-progress-steps" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-done={i < current ? "" : undefined} />
      ))}
    </div>
  );
}
