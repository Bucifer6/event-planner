"use client";

import { Button, Checkbox, FocusFirstError, IconButton, Input, Notice, SelectField, Sheet, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { IconAlert, IconClose } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addLedgerParticipant, addSharedCost, removeLedgerParticipant, settleTransfer, voidEntry } from "@/app/actions/ledger";
import { useForm } from "../../_components/useForm";
import { useIdempotencyKey } from "../budget/BudgetForms";
import styles from "../budget/money.module.css";

export type PersonOption = { id: string; name: string };
type Kind = "member" | "household" | "other";

/** Adds someone who shares costs: a team member, an invited household, or a typed name. */
export function AddParticipant({ occasionId, members, households, variant = "secondary" }: { occasionId: string; members: PersonOption[]; households: PersonOption[]; variant?: "primary" | "secondary" }) {
  const t = useTranslations("ledger.participants");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(members.length > 0 ? "member" : "other");
  const [n, setN] = useState(0);
  const f = useForm(addLedgerParticipant, {
    refresh: true,
    onSuccess: () => {
      setOpen(false);
      setN((x) => x + 1);
    },
  });
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {t("add")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("addTitle")} closeLabel={c("actions.close")}>
        <form key={n} action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          {f.error && f.formLevel(["memberId", "householdId", "name"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <SelectField id="lp-kind" name="kind" label={t("kind")} value={kind} onChange={(e) => setKind(e.currentTarget.value as Kind)}>
            <option value="member">{t("kinds.member")}</option>
            <option value="household">{t("kinds.household")}</option>
            <option value="other">{t("kinds.other")}</option>
          </SelectField>
          {kind === "member" ? (
            members.length > 0 ? (
              <SelectField id="lp-member" name="memberId" label={t("member")} defaultValue={f.value("memberId", members[0]?.id)} error={f.fieldError("memberId")}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <Notice>{t("noMembers")}</Notice>
            )
          ) : null}
          {kind === "household" ? (
            households.length > 0 ? (
              <SelectField id="lp-household" name="householdId" label={t("household")} defaultValue={f.value("householdId", households[0]?.id)} error={f.fieldError("householdId")}>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <Notice>{t("noHouseholds")}</Notice>
            )
          ) : null}
          {kind === "other" ? (
            <TextField id="lp-name" name="name" label={t("name")} hint={t("nameHint")} maxLength={80} required defaultValue={f.value("name")} error={f.fieldError("name")} />
          ) : null}
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block variant={variant} pendingLabel={t("adding")}>
            {t("create")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function RemoveParticipant({ occasionId, participantId, name }: { occasionId: string; participantId: string; name: string }) {
  const t = useTranslations("ledger.participants");
  const f = useForm(removeLedgerParticipant, { refresh: true });
  return (
    <form action={f.formAction}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="participantId" value={participantId} />
      <IconButton type="submit" label={t("removeLabel", { name })}>
        <IconClose size={16} />
      </IconButton>
      {f.error ? (
        <span className="ed-vh" role="alert">
          {f.error.message}
        </span>
      ) : null}
    </form>
  );
}

type Mode = "even" | "shares" | "exact";

/** The page's one primary action: who paid, how much, and how it is split. */
export function AddSharedCost({ occasionId, participants, today, variant = "primary" }: { occasionId: string; participants: PersonOption[]; today: string; variant?: "primary" | "secondary" }) {
  const t = useTranslations("ledger.entries");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("even");
  const [key, renew] = useIdempotencyKey();
  const f = useForm(addSharedCost, {
    refresh: true,
    onSuccess: () => {
      setOpen(false);
      setMode("even");
      renew();
    },
  });
  const splitError = f.fieldError("split");
  const fields = ["description", "amount", "occurredOn", "paidBy", "split"];
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {t("add")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("addTitle")} closeLabel={c("actions.close")}>
        <form key={key} action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <input type="hidden" name="mode" value={mode} />
          {f.error && f.formLevel(fields) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <TextField id="le-desc" name="description" label={t("description")} placeholder={t("descriptionPlaceholder")} maxLength={200} required defaultValue={f.value("description")} error={f.fieldError("description")} />
          <TextField id="le-amount" name="amount" label={t("amount")} hint={t("amountHint")} inputMode="decimal" autoComplete="off" required defaultValue={f.value("amount")} error={f.fieldError("amount")} />
          <TextField id="le-date" name="occurredOn" type="date" label={t("date")} required defaultValue={f.value("occurredOn", today)} error={f.fieldError("occurredOn")} />
          <SelectField id="le-paidby" name="paidBy" label={t("paidBy")} defaultValue={f.value("paidBy", participants[0]?.id)} error={f.fieldError("paidBy")}>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>

          <div className="ed-field">
            <span className="ed-field__label" id="le-mode-label">
              {t("splitMode")}
            </span>
            <div className="ed-chips" role="group" aria-labelledby="le-mode-label">
              {(["even", "shares", "exact"] as const).map((m) => (
                <button key={m} type="button" className="ed-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {t(`modes.${m}`)}
                </button>
              ))}
            </div>
          </div>

          <fieldset className={styles.split} id="le-split" aria-invalid={splitError ? true : undefined} aria-describedby={splitError ? "le-split-error" : undefined}>
            <legend className="ed-field__label">{t("beneficiaries")}</legend>
            {mode === "shares" ? <p className="ed-small ed-muted">{t("sharesHint")}</p> : null}
            {mode === "exact" ? <p className="ed-small ed-muted">{t("exactHint")}</p> : null}
            {participants.map((p, i) =>
              mode === "even" ? (
                <Checkbox key={p.id} name={`in_${p.id}`} label={p.name} defaultChecked={f.error ? f.value(`in_${p.id}`) === "on" : true} />
              ) : (
                <div className={styles.splitRow} key={`${mode}-${p.id}`}>
                  <label htmlFor={`le-s-${i}`}>{p.name}</label>
                  <Input
                    id={`le-s-${i}`}
                    name={mode === "shares" ? `w_${p.id}` : `x_${p.id}`}
                    inputMode={mode === "shares" ? "numeric" : "decimal"}
                    autoComplete="off"
                    aria-label={mode === "shares" ? t("shareOf", { name: p.name }) : t("amountOf", { name: p.name })}
                    defaultValue={f.value(mode === "shares" ? `w_${p.id}` : `x_${p.id}`, mode === "shares" ? "1" : "")}
                  />
                </div>
              ),
            )}
            {splitError ? (
              <span className="ed-field__error" id="le-split-error" role="alert">
                <IconAlert size={16} />
                <span>{splitError}</span>
              </span>
            ) : null}
          </fieldset>
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block pendingLabel={t("adding")}>
            {t("create")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

/** Records a suggested payment as a settle-up entry (a fact), once. */
export function RecordTransfer({ occasionId, from, to, amountMinor, currency }: { occasionId: string; from: string; to: string; amountMinor: number; currency: string }) {
  const t = useTranslations("ledger.settlement");
  const [key, renew] = useIdempotencyKey();
  const f = useForm(settleTransfer, { refresh: true, onSuccess: renew });
  return (
    <form action={f.formAction}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="fromParticipantId" value={from} />
      <input type="hidden" name="toParticipantId" value={to} />
      <input type="hidden" name="amountMinor" value={amountMinor} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <SubmitButton variant="secondary" pendingLabel={t("recording")}>
        {t("record")}
      </SubmitButton>
      {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
    </form>
  );
}

/** An entry is a fact: it leaves the balances only through a correction with a reason. */
export function VoidEntry({ occasionId, entryId, name }: { occasionId: string; entryId: string; name: string }) {
  const t = useTranslations("ledger.entries");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(voidEntry, { refresh: true, onSuccess: () => setOpen(false) });
  return (
    <>
      <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(true)} aria-label={`${t("void")}: ${name}`}>
        {t("void")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("voidTitle")} closeLabel={c("actions.close")}>
        <form action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="entryId" value={entryId} />
          <p>{t("voidIntro")}</p>
          {f.error && f.formLevel(["reason"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <TextareaField id={`void-${entryId}`} name="reason" label={t("voidReason")} rows={3} maxLength={1000} required defaultValue={f.value("reason")} error={f.fieldError("reason")} />
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <Button type="button" block onClick={() => setOpen(false)}>
            {t("voidKeep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={t("voiding")}>
            {t("voidSubmit", { name })}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
