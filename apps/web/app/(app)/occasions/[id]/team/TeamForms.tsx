"use client";

import { Button, Checkbox, ChoiceChips, FocusFirstError, Notice, Sheet, SubmitButton, TextField } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { inviteMemberAction, removeMemberAction, saveMemberAccess, saveMemberLabel, transferOwnershipAction } from "@/app/actions/members";
import styles from "../../_components/planning.module.css";
import { useForm } from "../../_components/useForm";

const ROLES = ["pm", "workstream_lead", "contributor", "supplier", "guest"] as const;

/** Free label with one-tap suggestions (naș, nașă, domnișoară de onoare…) for botez and nuntă. */
function LabelField({ id, defaultValue, suggestions, error }: { id: string; defaultValue: string; suggestions: string[]; error?: string }) {
  const t = useTranslations("team");
  const c = useTranslations("common");
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="ed-stack" data-gap="2">
      <TextField
        id={id}
        name="customLabel"
        label={t("fields.label")}
        hint={t("fields.labelHint")}
        optionalLabel={c("optional")}
        maxLength={60}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
      />
      {suggestions.length > 0 ? (
        <div className={styles.suggest} role="group" aria-label={t("fields.labelSuggestions")}>
          {suggestions.map((s) => (
            <button key={s} type="button" className="ed-chip" aria-pressed={value === s} onClick={() => setValue(value === s ? "" : s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FreshNotice() {
  const t = useTranslations("team.fresh");
  return (
    <Notice title={t("title")}>
      {t("body")} <Link href="/account#fresh">{t("link")}</Link>
    </Notice>
  );
}

/** Says what went wrong; a refused sensitive action also points to where to confirm (S4). */
function Failure({ error }: { error: { code: string; message: string } | null }) {
  const t = useTranslations("team.fresh");
  if (!error) return null;
  return (
    <Notice tone="danger">
      {error.message}
      {error.code === "FORBIDDEN" ? (
        <>
          {" "}
          <Link href="/account#fresh">{t("link")}</Link>
        </>
      ) : null}
    </Notice>
  );
}

function AccessFields({ isOwner, fresh, role, finance, privateRequests, idPrefix }: { isOwner: boolean; fresh: boolean; role: string; finance: boolean; privateRequests: boolean; idPrefix: string }) {
  const t = useTranslations("team");
  const elevated = isOwner && fresh;
  return (
    <>
      <ChoiceChips
        name="role"
        legend={t("fields.role")}
        stack
        defaultValue={role}
        options={ROLES.filter((r) => elevated || r !== "pm").map((r) => ({
          value: r,
          label: (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left", width: "100%" }}>
              <span>{t(`roles.${r}`)}</span>
              <span className="ed-small" style={{ opacity: 0.8, fontWeight: 400 }}>
                {t(`roleHelp.${r}`)}
              </span>
            </span>
          ),
        }))}
      />
      {elevated ? (
        <fieldset className="ed-fieldset">
          <legend className="ed-field__label">{t("fields.grants")}</legend>
          <span className="ed-field__hint">{t("fields.grantsHint")}</span>
          <Checkbox id={`${idPrefix}-fin`} name="grantFinance" defaultChecked={finance} label={t("grants.finance")} hint={t("grants.financeHint")} />
          <Checkbox id={`${idPrefix}-priv`} name="grantPrivateRequests" defaultChecked={privateRequests} label={t("grants.privateRequests")} hint={t("grants.privateRequestsHint")} />
        </fieldset>
      ) : isOwner ? (
        <FreshNotice />
      ) : null}
    </>
  );
}

/** A5: invite by email. The link in the email adds the person once they sign in and accept. */
export function InviteMember({ occasionId, isOwner, fresh, suggestions }: { occasionId: string; isOwner: boolean; fresh: boolean; suggestions: string[] }) {
  const t = useTranslations("team");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const f = useForm(inviteMemberAction, { refresh: true });
  return (
    <>
      <Button type="button" variant="primary" onClick={() => { setRound((n) => n + 1); setOpen(true); }}>
        <IconPlus size={18} />
        {t("invite.open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("invite.title")} closeLabel={c("actions.close")}>
        {f.ok ? (
          <Notice tone="success" title={f.state?.ok && f.state.data.emailStatus === "suppressed" ? t("invite.suppressedTitle") : t("invite.sentTitle")} role="status">
            {f.state?.ok && f.state.data.emailStatus === "suppressed" ? t("invite.suppressedBody") : t("invite.sentBody")}
          </Notice>
        ) : null}
        <form key={f.ok ? `ok-${round}` : `r-${round}`} action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          {f.formLevel(["email", "customLabel"]) ? <Failure error={f.error} /> : null}
          <TextField
            id="inv-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            label={t("fields.email")}
            hint={t("fields.emailHint")}
            required
            maxLength={254}
            defaultValue={f.value("email")}
            error={f.fieldError("email")}
          />
          <AccessFields isOwner={isOwner} fresh={fresh} role={f.value("role", "contributor")} finance={false} privateRequests={false} idPrefix="inv" />
          <LabelField id="inv-label" defaultValue={f.value("customLabel")} suggestions={suggestions} error={f.fieldError("customLabel")} />
          <FocusFirstError errors={f.error?.fieldErrors ?? null} />
          <SubmitButton block pendingLabel={t("invite.submitting")}>
            {t("invite.submit")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function MemberLabelForm({ occasionId, memberId, label, suggestions }: { occasionId: string; memberId: string; label: string; suggestions: string[] }) {
  const t = useTranslations("team");
  const c = useTranslations("common");
  const f = useForm(saveMemberLabel, { refresh: true });
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="memberId" value={memberId} />
      {f.ok ? <Notice tone="success" role="status">{t("label.saved")}</Notice> : null}
      {f.formLevel(["customLabel"]) ? <Failure error={f.error} /> : null}
      <LabelField id="m-label" defaultValue={f.value("customLabel", label)} suggestions={suggestions} error={f.fieldError("customLabel")} />
      <div>
        <SubmitButton variant="secondary" pendingLabel={c("status.saving")}>
          {t("label.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}

/** S4: role and the two separate grants — shown only after a fresh confirmation. */
export function MemberAccessForm(props: { occasionId: string; memberId: string; role: string; label: string; finance: boolean; privateRequests: boolean }) {
  const t = useTranslations("team");
  const c = useTranslations("common");
  const f = useForm(saveMemberAccess, { refresh: true });
  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={props.occasionId} />
      <input type="hidden" name="memberId" value={props.memberId} />
      <input type="hidden" name="customLabel" value={props.label} />
      {f.ok ? <Notice tone="success" role="status">{t("access.saved")}</Notice> : null}
      <Failure error={f.error} />
      <AccessFields isOwner fresh role={props.role} finance={props.finance} privateRequests={props.privateRequests} idPrefix="acc" />
      <div>
        <SubmitButton pendingLabel={c("status.saving")}>{t("access.submit")}</SubmitButton>
      </div>
    </form>
  );
}

/** Destructive, so confirmed in a sheet, with the person named on the button. */
export function RemoveMember({ occasionId, memberId, name, pending }: { occasionId: string; memberId: string; name: string; pending: boolean }) {
  const t = useTranslations("team.remove");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(removeMemberAction);
  return (
    <>
      <Button type="button" variant="danger-quiet" onClick={() => setOpen(true)}>
        {pending ? t("openInvite") : t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={pending ? t("titleInvite") : t("title")} closeLabel={c("actions.close")}>
        <p>{pending ? t("bodyInvite", { name }) : t("body", { name })}</p>
        <Failure error={f.error} />
        <form action={f.formAction} className="ed-form">
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="memberId" value={memberId} />
          <Button type="button" block onClick={() => setOpen(false)}>
            {pending ? t("keepInvite") : t("keep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={t("submitting")}>
            {pending ? t("submitInvite") : t("submit", { name })}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function TransferOwnership({ occasionId, memberId, name }: { occasionId: string; memberId: string; name: string }) {
  const t = useTranslations("team.transfer");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(transferOwnershipAction);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("title")} closeLabel={c("actions.close")}>
        <p>{t("body", { name })}</p>
        <Failure error={f.error} />
        <form action={f.formAction} className="ed-form">
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="toMemberId" value={memberId} />
          <Button type="button" block onClick={() => setOpen(false)}>
            {t("keep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={t("submitting")}>
            {t("submit", { name })}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
