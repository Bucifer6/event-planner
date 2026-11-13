"use client";

import { Checkbox, ChoiceChips, FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveCatalogueItemAction } from "@/app/actions/catalogues";
import { FormError } from "@/app/(auth)/_components/forms";
import { FileField } from "@/components/upload/FileField";
import styles from "../catalogues.module.css";

export type ItemFormValues = {
  id?: string;
  kind: "flower" | "foliage";
  varietyName: string;
  imageAssetId: string | null;
  seasonMonths: number[];
  priceStem: string;
  priceBunch: string;
  colours: string[];
  notes: string;
};

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * One variety (F1): name, picture, months in season, indicative prices, colours from the
 * fixed palette, notes. Saving changes the WORKING COPY only — nothing public until the
 * catalogue is sent for checking and approved. An empty price means "unknown".
 */
export function ItemForm({ businessId, catalogueId, uploadPurpose, palette, item, formId }: { businessId: string; catalogueId: string; uploadPurpose: string; palette: string[]; item?: ItemFormValues; formId: string }) {
  const t = useTranslations("catalogues");
  const router = useRouter();
  const [state, formAction] = useActionState(saveCatalogueItemAction, null);
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!state?.ok || handled.current === state) return;
    handled.current = state;
    router.refresh();
  }, [state, router]);
  const error = state && !state.ok ? state.error : null;
  const err = (name: string) => error?.fieldErrors?.[name]?.[0];
  const val = (name: string, fallback: string) => error?.values?.[name] ?? fallback;
  // ticked months and colours are kept in state, so a failed submit never clears them
  const [months, setMonths] = useState<number[]>(item?.seasonMonths ?? []);
  const [colours, setColours] = useState<string[]>(item?.colours ?? []);
  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <form action={formAction} className="ed-form" noValidate>
      <FormError state={state} skipFields={["varietyName", "priceStem", "priceBunch", "imageAssetId", "seasonMonths", "colours", "notes", "kind"]} />
      {state?.ok ? (
        <Notice tone="success" role="status">
          {t("editor.saved")}
        </Notice>
      ) : null}
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="catalogueId" value={catalogueId} />
      {item?.id ? <input type="hidden" name="itemId" value={item.id} /> : null}
      {item?.imageAssetId ? <input type="hidden" name="currentImageAssetId" value={item.imageAssetId} /> : null}

      <ChoiceChips
        key={`kind:${val("kind", item?.kind ?? "flower")}`}
        name="kind"
        legend={t("item.kind")}
        options={[
          { value: "flower", label: t("item.kinds.flower") },
          { value: "foliage", label: t("item.kinds.foliage") },
        ]}
        defaultValue={val("kind", item?.kind ?? "flower")}
        error={err("kind")}
      />
      <TextField id={`${formId}-variety`} name="varietyName" label={t("item.variety")} hint={t("item.varietyHint")} required maxLength={120} defaultValue={val("varietyName", item?.varietyName ?? "")} error={err("varietyName")} />
      <FileField label={t("item.image")} purpose={uploadPurpose} ownerId={businessId} name="imageAssetId" optionalLabel={t("item.optional")} hint={item?.imageAssetId ? t("item.imageKeep") : undefined} />
      {err("imageAssetId") ? (
        <span className="ed-field__error" role="alert">
          {err("imageAssetId")}
        </span>
      ) : null}

      <fieldset className="ed-fieldset">
        <legend className="ed-field__label">{t("item.season")}</legend>
        <span className="ed-field__hint">{t("item.seasonHint")}</span>
        <div className={styles.checks}>
          {MONTHS.map((m) => (
            <Checkbox key={m} name="seasonMonths" value={String(m)} label={t(`months.${m}` as never)} checked={months.includes(m)} onChange={() => setMonths((v) => toggle(v, m))} />
          ))}
        </div>
      </fieldset>

      <div className={styles.pair}>
        <TextField id={`${formId}-stem`} name="priceStem" label={t("item.priceStem")} inputMode="decimal" maxLength={12} optionalLabel={t("item.optional")} defaultValue={val("priceStem", item?.priceStem ?? "")} error={err("priceStem")} />
        <TextField id={`${formId}-bunch`} name="priceBunch" label={t("item.priceBunch")} inputMode="decimal" maxLength={12} optionalLabel={t("item.optional")} defaultValue={val("priceBunch", item?.priceBunch ?? "")} error={err("priceBunch")} />
      </div>
      <p className="ed-small ed-muted">{t("item.priceHint")}</p>

      <fieldset className="ed-fieldset">
        <legend className="ed-field__label">{t("item.colours")}</legend>
        <div className={styles.checks}>
          {palette.map((c) => (
            <Checkbox key={c} name="colours" value={c} label={t(`colours.${c}` as never)} checked={colours.includes(c)} onChange={() => setColours((v) => toggle(v, c))} />
          ))}
        </div>
      </fieldset>

      <TextareaField id={`${formId}-notes`} name="notes" label={t("item.notes")} hint={t("item.notesHint")} rows={3} maxLength={500} optionalLabel={t("item.optional")} defaultValue={val("notes", item?.notes ?? "")} error={err("notes")} />
      <FocusFirstError errors={error?.fieldErrors ?? null} />
      <SubmitButton pendingLabel={t("item.saving")} block>
        {t("item.save")}
      </SubmitButton>
    </form>
  );
}
