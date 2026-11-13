"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { IconCheck, IconClose, IconCopy, IconMinus, IconPlus } from "./icons";
import { cx, type ButtonVariant } from "./components";

/**
 * Submit button for a <form action={serverAction}>.
 * While the action runs it is disabled and says what is happening ("Se salvează…") — so a
 * double tap cannot send twice (Q4) and the user gets feedback at once.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  block,
  className,
  pending: pendingProp,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  pendingLabel: string;
  variant?: ButtonVariant;
  block?: boolean;
  /** for non-form usage (useTransition): overrides the form status */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      className={cx("ed-btn", variant !== "secondary" && `ed-btn--${variant}`, block && "ed-btn--block", className)}
      aria-disabled={pending || rest.disabled ? true : undefined}
      data-pending={pending ? "true" : undefined}
      onClick={(e) => {
        if (pending) e.preventDefault();
        rest.onClick?.(e);
      }}
      {...rest}
      disabled={rest.disabled}
    >
      {pending ? <span className="ed-spinner" aria-hidden /> : null}
      <span aria-live="polite">{pending ? pendingLabel : children}</span>
    </button>
  );
}

/**
 * Bottom sheet on phones, side panel on desktop. Built on <dialog>: focus moves in on open,
 * returns to the opener on close, Escape closes.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
  /** Buttons. On phones they stack with the primary action lowest (put it LAST in the fragment). */
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
    const o = opener.current;
    if (o instanceof HTMLElement) o.focus();
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="ed-sheet"
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="ed-sheet__head">
        <h2 className="ed-sheet__title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="ed-btn ed-btn--icon" aria-label={closeLabel} onClick={() => ref.current?.close()}>
          <IconClose />
        </button>
      </div>
      <div className="ed-sheet__body">{children}</div>
      {footer ? <div className="ed-sheet__foot">{footer}</div> : null}
    </dialog>
  );
}

/** A button that opens a Sheet. `children` receives `close`. Keeps simple cases free of state plumbing. */
export function SheetTrigger({
  label,
  title,
  closeLabel,
  variant = "secondary",
  icon,
  children,
  footer,
  block,
}: {
  label: ReactNode;
  title: ReactNode;
  closeLabel: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
  block?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
  footer?: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        className={cx("ed-btn", variant !== "secondary" && `ed-btn--${variant}`, block && "ed-btn--block")}
        onClick={() => setOpen(true)}
      >
        {icon}
        {label}
      </button>
      <Sheet open={open} onClose={close} title={title} closeLabel={closeLabel} footer={typeof footer === "function" ? footer(close) : footer}>
        {typeof children === "function" ? children(close) : children}
      </Sheet>
    </>
  );
}

/** Number stepper with 48px buttons. Posts its value under `name`. */
export function Stepper({
  name,
  label,
  defaultValue = 0,
  min = 0,
  max = 99,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  name: string;
  label: ReactNode;
  defaultValue?: number;
  min?: number;
  max?: number;
  decreaseLabel: string;
  increaseLabel: string;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const id = useId();
  const set = (v: number) => {
    const next = Math.max(min, Math.min(max, v));
    setValue(next);
    onChange?.(next);
  };
  return (
    <div className="ed-field">
      <span className="ed-field__label" id={id}>
        {label}
      </span>
      <div className="ed-stepper" role="group" aria-labelledby={id}>
        <button type="button" aria-label={decreaseLabel} disabled={value <= min} onClick={() => set(value - 1)}>
          <IconMinus />
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={increaseLabel} disabled={value >= max} onClick={() => set(value + 1)}>
          <IconPlus />
        </button>
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

/** Copies `text` and confirms in words for two seconds. */
export function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="ed-btn ed-btn--sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard unavailable: the text is still visible beside the button */
        }
      }}
    >
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}

/** Moves focus to the first invalid field after a failed submit. Render inside the form with the current error map. */
export function FocusFirstError({ errors }: { errors?: Record<string, unknown> | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!errors || Object.keys(errors).length === 0) return;
    const form = ref.current?.closest("form");
    const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  }, [errors]);
  return <span ref={ref} hidden />;
}
