"use client";

import { Field, fieldDescribedBy, Input, Notice } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { UploadedFile } from "@/app/api/uploads/handle";
import type { ActionResult } from "@/lib/action-core";

export type FileFieldProps = {
  label: string;
  /** A purpose registered with registerUploadPurpose() in @ed/storage, e.g. "business.drawing". */
  purpose: string;
  ownerId: string;
  /** Show the PDF wording/accept filter (the server decides by purpose regardless). */
  allowPdf?: boolean;
  /** Name of the hidden input that carries the uploaded asset id in the surrounding form. */
  name?: string;
  hint?: string;
  optionalLabel?: string;
  onUploaded?: (file: UploadedFile) => void;
};

/**
 * File input that uploads to POST /api/uploads as soon as a file is chosen and puts the new
 * asset id into a hidden input of the surrounding form. Says what is happening while it
 * uploads; errors appear beside the field, in words (limits name the asset to remove).
 */
export function FileField({ label, purpose, ownerId, allowPdf, name = "assetId", hint, optionalLabel, onUploaded }: FileFieldProps) {
  const t = useTranslations("platform.upload");
  const id = useId();
  const focusInput = () => document.getElementById(id)?.focus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const hintText = hint ?? (allowPdf ? t("hintWithPdf") : t("hintImages"));

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("purpose", purpose);
      body.set("ownerId", ownerId);
      body.set("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body, credentials: "same-origin" });
      const result = (await res.json()) as ActionResult<UploadedFile>;
      if (result.ok) {
        setUploaded(result.data);
        onUploaded?.(result.data);
      } else {
        // the whole-request message is the specific one (e.g. which asset to remove)
        setError(result.error.code === "VALIDATION" ? (result.error.fieldErrors?.file?.[0] ?? result.error.message) : result.error.message);
        focusInput();
      }
    } catch {
      setError(t("failed"));
      focusInput();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field id={id} label={label} hint={hintText} error={error ?? undefined} optionalLabel={optionalLabel}>
      <Input
        id={id}
        type="file"
        accept={allowPdf ? "image/png,image/jpeg,application/pdf" : "image/png,image/jpeg"}
        aria-describedby={fieldDescribedBy(id, { hint: hintText, error })}
        aria-invalid={error ? true : undefined}
        aria-busy={busy}
        disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
      <input type="hidden" name={name} value={uploaded?.id ?? ""} />
      <div aria-live="polite">
        {busy ? <p className="ed-small ed-muted">{t("uploading")}</p> : null}
        {uploaded && !busy ? (
          <Notice tone="success" role="status">
            {t("uploaded", { name: uploaded.name })}
          </Notice>
        ) : null}
      </div>
    </Field>
  );
}
