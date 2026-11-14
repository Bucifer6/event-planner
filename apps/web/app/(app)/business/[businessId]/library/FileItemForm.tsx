"use client";

import { FocusFirstError, Notice, SubmitButton, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { addLibraryItemAction } from "@/app/actions/bizoccasions";
import { FormError } from "@/app/(auth)/_components/forms";
import { FileField } from "@/components/upload/FileField";

/** Adds a file (image or PDF) to the library: the upload happens first, the title names it. */
export function FileItemForm({ businessId }: { businessId: string }) {
  const t = useTranslations("bizoccasions");
  const router = useRouter();
  const [state, formAction] = useActionState(addLibraryItemAction, null);
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={formAction} className="ed-form" noValidate key={state?.ok ? state.data.id : "new"}>
      <FormError state={state} skipFields={["title", "assetId"]} />
      {state?.ok ? (
        <Notice tone="success" role="status">
          {t("library.added")}
        </Notice>
      ) : null}
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="kind" value="asset" />
      <TextField id="lib-file-title" name="title" label={t("library.titleLabel.asset")} required maxLength={160} defaultValue={error?.values?.title} error={error?.fieldErrors?.title?.[0]} />
      <FileField label={t("library.file")} purpose="business.library" ownerId={businessId} allowPdf name="assetId" />
      {error?.fieldErrors?.assetId?.[0] ? (
        <span className="ed-field__error" role="alert">
          {error.fieldErrors.assetId[0]}
        </span>
      ) : null}
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={t("saving")}>{t("library.add.asset")}</SubmitButton>
    </form>
  );
}
