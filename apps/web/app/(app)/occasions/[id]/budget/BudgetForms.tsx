"use client";

import { Button, Checkbox, ChoiceChips, FocusFirstError, Notice, SelectField, Sheet, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import {
  addCategory,
  addExpense,
  addPresetCategories,
  correctPaidExpense,
  decideExpense,
  deleteCategory,
  payExpense,
  removeExpense,
  saveCategory,
  saveExpense,
} from "@/app/actions/budget";
import { FileField } from "@/components/upload/FileField";
import { useForm } from "../../_components/useForm";
import styles from "./money.module.css";

/** A fresh idempotency key per form render; renewed after each successful submit (Q4). */
export function useIdempotencyKey(): [string, () => void] {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [key, setKey] = useState(make);
  const renew = useCallback(() => setKey(make()), []);
  return [key, renew];
}

export type CategoryOption = { id: string; name: string };

/** One-tap default categories for this kind of occasion. */
export function PresetChips({ occasionId, options }: { occasionId: string; options: Array<{ value: string; label: string }> }) {
  const t = useTranslations("budget.categories");
  const f = useForm(addPresetCategories, { refresh: true });
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {f.error && f.formLevel(["presets"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <ChoiceChips name="presets" legend={t("presetsLegend")} options={options} multiple error={f.fieldError("presets")} />
      <p className="ed-small ed-muted">{t("presetsHint")}</p>
      <div>
        <SubmitButton variant="secondary" pendingLabel={t("adding")}>
          {t("addPresets")}
        </SubmitButton>
      </div>
    </form>
  );
}

type CategoryValues = { id: string; name: string; estimate: string; forecast: string };

/** Create a category, or edit one: name plus the two ENTERED amounts (empty = unknown). */
export function CategorySheet({ occasionId, category, label, variant = "secondary" }: { occasionId: string; category?: CategoryValues; label: string; variant?: "secondary" | "quiet" }) {
  const t = useTranslations("budget.categories");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    setConfirmDelete(false);
  }, []);
  const create = useForm(addCategory, { refresh: true, onSuccess: close });
  const edit = useForm(saveCategory, { refresh: true, onSuccess: close });
  const save = category ? edit : create;
  const del = useForm(deleteCategory, { refresh: true, onSuccess: close });
  const uid = category?.id ?? "new";
  return (
    <>
      <Button type="button" variant={variant} size={variant === "quiet" ? "sm" : undefined} onClick={() => setOpen(true)} aria-label={category ? `${label}: ${category.name}` : undefined}>
        {label}
      </Button>
      <Sheet open={open} onClose={close} title={category ? t("editTitle") : t("newTitle")} closeLabel={c("actions.close")}>
        {confirmDelete && category ? (
          <form action={del.formAction} className="ed-form">
            <input type="hidden" name="occasionId" value={occasionId} />
            <input type="hidden" name="categoryId" value={category.id} />
            <p>{t("removeConfirm", { name: category.name })}</p>
            {del.error ? <Notice tone="danger">{del.error.message}</Notice> : null}
            <Button type="button" block onClick={() => setConfirmDelete(false)}>
              {t("keep")}
            </Button>
            <SubmitButton variant="danger" block pendingLabel={t("removing")}>
              {t("removeSubmit", { name: category.name })}
            </SubmitButton>
          </form>
        ) : (
          <form action={save.formAction} className="ed-form" noValidate>
            <input type="hidden" name="occasionId" value={occasionId} />
            {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
            {save.error && save.formLevel(["name", "estimate", "forecast"]) ? <Notice tone="danger">{save.error.message}</Notice> : null}
            <TextField id={`cat-name-${uid}`} name="name" label={t("name")} maxLength={80} required defaultValue={save.value("name", category?.name ?? "")} error={save.fieldError("name")} />
            <TextField id={`cat-est-${uid}`} name="estimate" label={t("estimate")} hint={t("estimateHint")} optionalLabel={c("optional")} inputMode="decimal" autoComplete="off" defaultValue={save.value("estimate", category?.estimate ?? "")} error={save.fieldError("estimate")} />
            <TextField id={`cat-fc-${uid}`} name="forecast" label={t("forecast")} hint={t("forecastHint")} optionalLabel={c("optional")} inputMode="decimal" autoComplete="off" defaultValue={save.value("forecast", category?.forecast ?? "")} error={save.fieldError("forecast")} />
            <FocusFirstError errors={save.error?.fieldErrors ?? null} />
            {category ? (
              <Button type="button" variant="danger-quiet" block onClick={() => setConfirmDelete(true)}>
                {t("remove")}
              </Button>
            ) : null}
            <SubmitButton block pendingLabel={c("status.saving")}>
              {category ? t("save") : t("create")}
            </SubmitButton>
          </form>
        )}
      </Sheet>
    </>
  );
}

type ExpenseValues = { id: string; description: string; amount: string; spentOn: string; categoryId: string; supplierLabel: string; paid: boolean; hasReceipt: boolean };

function ExpenseFields({
  f,
  uid,
  occasionId,
  categories,
  initial,
  canUpload,
  retentionYears,
}: {
  f: { value: (name: string, fallback?: string) => string; fieldError: (name: string) => string | undefined };
  uid: string;
  occasionId: string;
  categories: CategoryOption[];
  initial: Omit<ExpenseValues, "id">;
  canUpload: boolean;
  retentionYears: number;
}) {
  const t = useTranslations("budget.expenses");
  const c = useTranslations("common");
  return (
    <>
      <TextField id={`ex-desc-${uid}`} name="description" label={t("description")} placeholder={t("descriptionPlaceholder")} maxLength={200} required defaultValue={f.value("description", initial.description)} error={f.fieldError("description")} />
      {initial.paid ? (
        <p className="ed-small ed-muted">{t("amountLocked")}</p>
      ) : (
        <TextField id={`ex-amount-${uid}`} name="amount" label={t("amount")} hint={t("amountHint")} inputMode="decimal" autoComplete="off" required defaultValue={f.value("amount", initial.amount)} error={f.fieldError("amount")} />
      )}
      <TextField id={`ex-date-${uid}`} name="spentOn" type="date" label={t("date")} required defaultValue={f.value("spentOn", initial.spentOn)} error={f.fieldError("spentOn")} />
      <SelectField id={`ex-cat-${uid}`} name="categoryId" label={t("category")} defaultValue={f.value("categoryId", initial.categoryId)} error={f.fieldError("categoryId")}>
        <option value="">{t("noCategory")}</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </SelectField>
      <TextField id={`ex-sup-${uid}`} name="supplierLabel" label={t("supplier")} placeholder={t("supplierPlaceholder")} optionalLabel={c("optional")} maxLength={160} defaultValue={f.value("supplierLabel", initial.supplierLabel)} error={f.fieldError("supplierLabel")} />
      {canUpload ? (
        <FileField
          label={initial.hasReceipt ? t("receiptReplace") : t("receipt")}
          purpose="occasion.receipt"
          ownerId={occasionId}
          allowPdf
          name="receiptAssetId"
          optionalLabel={c("optional")}
        />
      ) : null}
      {f.fieldError("receiptAssetId") ? <Notice tone="danger">{f.fieldError("receiptAssetId")}</Notice> : null}
      <p className="ed-small ed-muted">{t("receiptRetention", { years: retentionYears })}</p>
    </>
  );
}

/** The page's one primary action: record an expense (pending approval, unpaid). */
export function AddExpense({
  occasionId,
  categories,
  today,
  canUpload,
  retentionYears,
  variant = "primary",
}: {
  occasionId: string;
  categories: CategoryOption[];
  today: string;
  canUpload: boolean;
  retentionYears: number;
  variant?: "primary" | "secondary";
}) {
  const t = useTranslations("budget.expenses");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [key, renew] = useIdempotencyKey();
  const f = useForm(addExpense, {
    refresh: true,
    onSuccess: () => {
      setOpen(false);
      renew();
    },
  });
  const fields = ["description", "amount", "spentOn", "categoryId", "supplierLabel", "receiptAssetId"];
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {t("add")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("addTitle")} closeLabel={c("actions.close")}>
        {/* keyed by the idempotency key: a fresh, empty form after each success */}
        <form key={key} action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          {f.error && f.formLevel(fields) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <ExpenseFields
            f={f}
            uid="new"
            occasionId={occasionId}
            categories={categories}
            canUpload={canUpload}
            retentionYears={retentionYears}
            initial={{ description: "", amount: "", spentOn: today, categoryId: "", supplierLabel: "", paid: false, hasReceipt: false }}
          />
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block pendingLabel={t("adding")}>
            {t("create")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function EditExpense({ occasionId, expense, categories, canUpload, retentionYears }: { occasionId: string; expense: ExpenseValues; categories: CategoryOption[]; canUpload: boolean; retentionYears: number }) {
  const t = useTranslations("budget.expenses");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(saveExpense, { refresh: true, onSuccess: () => setOpen(false) });
  const fields = ["description", "amount", "spentOn", "categoryId", "supplierLabel", "receiptAssetId"];
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("edit")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("editTitle")} closeLabel={c("actions.close")}>
        <form action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="expenseId" value={expense.id} />
          {f.error && f.formLevel(fields) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <ExpenseFields f={f} uid={expense.id} occasionId={occasionId} categories={categories} canUpload={canUpload} retentionYears={retentionYears} initial={expense} />
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block variant="secondary" pendingLabel={c("status.saving")}>
            {t("save")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

/** Approval: its own state, moved without touching payment. */
export function ApprovalButtons({ occasionId, expenseId, state }: { occasionId: string; expenseId: string; state: "pending" | "approved" | "rejected" }) {
  const t = useTranslations("budget.expenses");
  const f = useForm(decideExpense, { refresh: true });
  const button = (next: "pending" | "approved" | "rejected", label: string) => (
    <form action={f.formAction} key={next}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      <input type="hidden" name="state" value={next} />
      <SubmitButton variant="secondary" pendingLabel={t("deciding")}>
        {label}
      </SubmitButton>
    </form>
  );
  return (
    <div className="ed-stack" data-gap="2">
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <div className={styles.inlineForms}>
        {state !== "approved" ? button("approved", t("approve")) : null}
        {state !== "rejected" ? button("rejected", t("reject")) : null}
        {state !== "pending" ? button("pending", t("reopen")) : null}
      </div>
    </div>
  );
}

/** Payment: recording a fact. The primary action of an unpaid expense's page. */
export function MarkPaid({ occasionId, expenseId, today }: { occasionId: string; expenseId: string; today: string }) {
  const t = useTranslations("budget.expenses");
  const f = useForm(payExpense, { refresh: true });
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="expenseId" value={expenseId} />
      {f.error && f.formLevel(["paidOn"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextField id="pay-on" name="paidOn" type="date" label={t("paidOnField")} defaultValue={f.value("paidOn", today)} error={f.fieldError("paidOn")} />
      <div>
        <SubmitButton pendingLabel={t("markingPaid")}>{t("markPaid")}</SubmitButton>
      </div>
    </form>
  );
}

/** Principle 4: a paid expense changes only here, with a reason that is kept. */
export function CorrectPaid({ occasionId, expenseId, amount }: { occasionId: string; expenseId: string; amount: string }) {
  const t = useTranslations("budget.expenses.correct");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(correctPaidExpense, { refresh: true, onSuccess: () => setOpen(false) });
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("title")} closeLabel={c("actions.close")}>
        <form action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <p>{t("intro")}</p>
          {f.error && f.formLevel(["amount", "reason"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <TextField id="cor-amount" name="amount" label={t("amount")} hint={t("amountHint")} inputMode="decimal" autoComplete="off" defaultValue={f.value("amount", amount)} error={f.fieldError("amount")} />
          <Checkbox name="markUnpaid" label={t("markUnpaid")} hint={t("markUnpaidHint")} defaultChecked={f.value("markUnpaid") === "on"} />
          <TextareaField id="cor-reason" name="reason" label={t("reason")} hint={t("reasonHint")} rows={3} maxLength={1000} required defaultValue={f.value("reason")} error={f.fieldError("reason")} />
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block variant="secondary" pendingLabel={t("submitting")}>
            {t("submit")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function DeleteExpense({ occasionId, expenseId, name }: { occasionId: string; expenseId: string; name: string }) {
  const t = useTranslations("budget.expenses");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(removeExpense);
  return (
    <>
      <Button type="button" variant="danger-quiet" onClick={() => setOpen(true)}>
        {t("delete")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("delete")} closeLabel={c("actions.close")}>
        <form action={f.formAction} className="ed-form">
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="expenseId" value={expenseId} />
          <p>{t("deleteConfirm", { name })}</p>
          {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <Button type="button" block onClick={() => setOpen(false)}>
            {t("keep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={c("status.deleting")}>
            {t("deleteSubmit", { name })}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
