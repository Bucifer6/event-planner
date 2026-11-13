"use client";

import { Checkbox, Field, FocusFirstError, Notice, SubmitButton, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { saveBrandingAction } from "@/app/actions/bizoccasions";
import { FormError } from "@/app/(auth)/_components/forms";
import { FileField } from "@/components/upload/FileField";
import guest from "@/app/g/[token]/branding.module.css";
import styles from "../occasions/biz.module.css";

type Initial = { displayName: string; accentColor: string | null; logoUrl: string | null };

/** Same rule as @ed/core/bizoccasions readableOn: ink or ivory, whichever reads better on the colour. */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const ivory = (0.9866 + 0.05) / (l + 0.05);
  const ink = (l + 0.05) / (0.0082 + 0.05);
  return ivory >= ink ? "#fffdf8" : "#17161b";
}

/** P20: name, logo, one accent — with a live preview of the head of a guest page. */
export function BrandingForm({ businessId, businessName, canEdit, initial }: { businessId: string; businessName: string; canEdit: boolean; initial: Initial }) {
  const t = useTranslations("bizoccasions");
  const router = useRouter();
  const colorId = useId();
  const [state, formAction] = useActionState(saveBrandingAction, null);
  const [name, setName] = useState(initial.displayName);
  const [useAccent, setUseAccent] = useState(initial.accentColor !== null);
  const [accent, setAccent] = useState(initial.accentColor ?? "#1c2452");
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const scoped = useAccent ? { className: guest.scope, style: { "--brand": accent, "--brand-on": readableOn(accent) } as CSSProperties } : {};

  return (
    <div className={styles.stack}>
      <form action={formAction} className="ed-form" noValidate>
        <FormError state={state} skipFields={["displayName", "accentColor", "logoAssetId"]} />
        {state?.ok ? (
          <Notice tone="success" role="status">
            {t("saved")}
          </Notice>
        ) : null}
        <input type="hidden" name="businessId" value={businessId} />
        <TextField
          id="brand-name"
          name="displayName"
          label={t("branding.name")}
          hint={t("branding.nameHint", { name: businessName })}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={!canEdit}
          optionalLabel={t("optional")}
          error={error?.fieldErrors?.displayName?.[0]}
        />
        {initial.logoUrl ? (
          <div className={styles.logoNow}>
            <img src={initial.logoUrl} alt={t("branding.logoNow")} />
            {canEdit ? <Checkbox name="removeLogo" label={t("branding.removeLogo")} /> : null}
          </div>
        ) : null}
        {canEdit ? <FileField label={initial.logoUrl ? t("branding.logoReplace") : t("branding.logo")} purpose="business.logo" ownerId={businessId} name="logoAssetId" optionalLabel={t("optional")} /> : null}
        {error?.fieldErrors?.logoAssetId?.[0] ? (
          <span className="ed-field__error" role="alert">
            {error.fieldErrors.logoAssetId[0]}
          </span>
        ) : null}
        <Checkbox name="useAccent" label={t("branding.useAccent")} hint={t("branding.useAccentHint")} checked={useAccent} onChange={(e) => setUseAccent(e.currentTarget.checked)} disabled={!canEdit} />
        <Field id={colorId} label={t("branding.accent")} error={error?.fieldErrors?.accentColor?.[0]}>
          <div className={styles.colorRow}>
            <input id={colorId} className={styles.colorInput} type="color" name="accentColor" value={accent} onChange={(e) => setAccent(e.currentTarget.value)} disabled={!canEdit || !useAccent} />
            <span className="ed-num ed-muted">{useAccent ? accent : t("branding.accentDefault")}</span>
          </div>
        </Field>
        <FocusFirstError errors={error?.fieldErrors ?? null} />
        {canEdit ? <SubmitButton pendingLabel={t("saving")}>{t("branding.save")}</SubmitButton> : null}
      </form>

      <div>
        <p className="ed-label">{t("branding.previewLabel")}</p>
        <div className={`${styles.preview}${scoped.className ? ` ${scoped.className}` : ""}`} style={scoped.style}>
          <div className={guest.block}>
            {initial.logoUrl ? <img className={guest.logo} src={initial.logoUrl} alt="" /> : null}
            <p className={guest.line}>
              <span className="ed-label">{t("guest.organisedBy")}</span>
              <span className={guest.name}>{name.trim() || businessName}</span>
            </p>
          </div>
          <p className={styles.previewTitle}>{t("branding.previewTitle")}</p>
          <span className="ed-btn ed-btn--primary" aria-hidden="true">
            {t("branding.previewButton")}
          </span>
          <p className="ed-small">
            <a href="#preview" onClick={(e) => e.preventDefault()}>
              {t("branding.previewLink")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
