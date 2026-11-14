"use client";

import { Button, FocusFirstError, Notice, SelectField, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { IconAlert } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { saveListing } from "@/app/actions/listings";
import { FileField } from "@/components/upload/FileField";
import styles from "../../business.module.css";

export type EditorPicklists = {
  categories: Array<{ id: string; name: string }>;
  counties: Array<{ code: string; name: string }>;
  localities: Array<{ id: string; countyCode: string; name: string }>;
};

export type EditorValues = {
  name: string;
  descriptionRo: string;
  descriptionEn: string;
  categoryIds: string[];
  countyCodes: string[];
  localityIds: string[];
  contactPhone: string;
  contactEmail: string;
  website: string;
  photos: Array<{ id: string; url: string }>;
};

const MAX = { categories: 5, counties: 5, localities: 20, photos: 8 };

function Counter({ count, max }: { count: number; max: number }) {
  const t = useTranslations("listings.editor");
  return (
    <span className={styles.counter} data-full={count >= max ? "" : undefined} aria-live="polite">
      {t("counter", { count, max })}
    </span>
  );
}

function FieldsetError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="ed-field__error" role="alert">
      <IconAlert size={16} />
      <span>{message}</span>
    </span>
  );
}

/**
 * The listing form (P1, P2). Everything about WHAT the business does and WHERE is chosen
 * from picklists: category chips with a "3 din 5" counter, then county → localities. There
 * is no text box for a category or a place. Typed text is kept in component state, so a
 * failed submit never loses it; errors appear beside their field.
 */
export function ListingEditor({
  businessId,
  listingId,
  picklists,
  initial,
  canEdit,
  submitLabel,
}: {
  businessId: string;
  listingId: string | null;
  picklists: EditorPicklists;
  initial: EditorValues;
  canEdit: boolean;
  submitLabel: string;
}) {
  const t = useTranslations("listings.editor");
  const f = useTranslations("listings.fields");
  const c = useTranslations("common");
  const uid = useId();
  const [state, formAction] = useActionState(saveListing, null);
  const [v, setV] = useState<EditorValues>(initial);
  const [countyToAdd, setCountyToAdd] = useState("");
  const error = state && !state.ok ? state.error : null;
  const err = (name: string) => error?.fieldErrors?.[name]?.[0];
  const set = <K extends keyof EditorValues>(key: K, value: EditorValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const toggle = (key: "categoryIds" | "localityIds", id: string, max: number) =>
    setV((prev) => {
      const has = prev[key].includes(id);
      if (!has && prev[key].length >= max) return prev;
      return { ...prev, [key]: has ? prev[key].filter((x) => x !== id) : [...prev[key], id] };
    });
  const addCounty = () => {
    if (!countyToAdd || v.countyCodes.includes(countyToAdd) || v.countyCodes.length >= MAX.counties) return;
    set("countyCodes", [...v.countyCodes, countyToAdd]);
    setCountyToAdd("");
  };
  const removeCounty = (code: string) =>
    setV((prev) => ({
      ...prev,
      countyCodes: prev.countyCodes.filter((x) => x !== code),
      localityIds: prev.localityIds.filter((id) => picklists.localities.find((l) => l.id === id)?.countyCode !== code),
    }));

  const fieldNames = ["name", "descriptionRo", "descriptionEn", "categoryIds", "countyCodes", "localityIds", "contactPhone", "contactEmail", "website", "photoAssetIds"];
  const formLevel = error && !Object.keys(error.fieldErrors ?? {}).some((k) => fieldNames.includes(k));
  const availableCounties = picklists.counties.filter((co) => !v.countyCodes.includes(co.code));

  return (
    <form action={formAction} className="ed-form" noValidate>
      <input type="hidden" name="businessId" value={businessId} />
      {listingId ? <input type="hidden" name="listingId" value={listingId} /> : null}
      {v.categoryIds.map((id) => (
        <input key={id} type="hidden" name="categoryIds" value={id} />
      ))}
      {v.countyCodes.map((code) => (
        <input key={code} type="hidden" name="countyCodes" value={code} />
      ))}
      {v.localityIds.map((id) => (
        <input key={id} type="hidden" name="localityIds" value={id} />
      ))}
      {v.photos.map((p) => (
        <input key={p.id} type="hidden" name="photoAssetIds" value={p.id} />
      ))}

      {formLevel ? <Notice tone="danger" title={error!.message} /> : null}
      {error && !formLevel ? <Notice tone="danger" title={t("fixErrors")} /> : null}

      <TextField
        id={`${uid}-name`}
        name="name"
        label={f("name")}
        hint={t("nameHint")}
        maxLength={120}
        required
        value={v.name}
        onChange={(e) => set("name", e.target.value)}
        error={err("name")}
        disabled={!canEdit}
      />

      <div className={styles.group}>
        <h2>{t("whatTitle")}</h2>
        <fieldset className="ed-fieldset" aria-invalid={err("categoryIds") ? true : undefined}>
          <legend className="ed-field__label">
            <span className={styles.legendRow}>
              <span>{f("categories")}</span>
              <Counter count={v.categoryIds.length} max={MAX.categories} />
            </span>
          </legend>
          <span className="ed-field__hint">{t("categoriesHint")}</span>
          <div className={`ed-chips ${styles.chipset}`}>
            {picklists.categories.map((cat) => {
              const on = v.categoryIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  className="ed-chip"
                  aria-pressed={on}
                  disabled={!canEdit || (!on && v.categoryIds.length >= MAX.categories)}
                  onClick={() => toggle("categoryIds", cat.id, MAX.categories)}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
          <FieldsetError message={err("categoryIds")} />
        </fieldset>
      </div>

      <div className={styles.group}>
        <h2>{t("whereTitle")}</h2>
        <fieldset className="ed-fieldset" aria-invalid={err("countyCodes") || err("localityIds") ? true : undefined}>
          <legend className="ed-field__label">
            <span className={styles.legendRow}>
              <span>{f("counties")}</span>
              <Counter count={v.countyCodes.length} max={MAX.counties} />
            </span>
          </legend>
          <span className="ed-field__hint">{t("whereHint")}</span>
          <div className={styles.addCounty}>
            <SelectField
              id={`${uid}-county`}
              label={t("addCountyLabel")}
              value={countyToAdd}
              onChange={(e) => setCountyToAdd(e.target.value)}
              disabled={!canEdit || v.countyCodes.length >= MAX.counties}
              error={err("countyCodes")}
            >
              <option value="">{t("chooseCounty")}</option>
              {availableCounties.map((co) => (
                <option key={co.code} value={co.code}>
                  {co.name}
                </option>
              ))}
            </SelectField>
            <Button type="button" onClick={addCounty} disabled={!canEdit || !countyToAdd || v.countyCodes.length >= MAX.counties}>
              {t("addCounty")}
            </Button>
          </div>

          {v.countyCodes.length > 0 ? (
            <div className={styles.legendRow}>
              <span className="ed-field__label">{f("localities")}</span>
              <Counter count={v.localityIds.length} max={MAX.localities} />
            </div>
          ) : null}
          {v.countyCodes.map((code) => {
            const county = picklists.counties.find((co) => co.code === code);
            const places = picklists.localities.filter((l) => l.countyCode === code);
            return (
              <div key={code} className={styles.county}>
                <div className={styles.countyHead}>
                  <span className={styles.countyName}>{county?.name ?? code}</span>
                  <Button type="button" variant="quiet" size="sm" onClick={() => removeCounty(code)} disabled={!canEdit} aria-label={t("removeCountyNamed", { county: county?.name ?? code })}>
                    {t("removeCounty")}
                  </Button>
                </div>
                <div className={`ed-chips ${styles.chipset}`} role="group" aria-label={t("localitiesIn", { county: county?.name ?? code })}>
                  {places.map((l) => {
                    const on = v.localityIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        className="ed-chip"
                        aria-pressed={on}
                        disabled={!canEdit || (!on && v.localityIds.length >= MAX.localities)}
                        onClick={() => toggle("localityIds", l.id, MAX.localities)}
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <FieldsetError message={err("localityIds")} />
        </fieldset>
      </div>

      <div className={styles.group}>
        <h2>{t("aboutTitle")}</h2>
        <TextareaField
          id={`${uid}-ro`}
          name="descriptionRo"
          label={f("descriptionRo")}
          hint={t("descriptionRoHint")}
          rows={7}
          maxLength={4000}
          value={v.descriptionRo}
          onChange={(e) => set("descriptionRo", e.target.value)}
          error={err("descriptionRo")}
          disabled={!canEdit}
          lang="ro"
        />
        <TextareaField
          id={`${uid}-en`}
          name="descriptionEn"
          label={f("descriptionEn")}
          hint={t("descriptionEnHint")}
          optionalLabel={c("optional")}
          rows={5}
          maxLength={4000}
          value={v.descriptionEn}
          onChange={(e) => set("descriptionEn", e.target.value)}
          error={err("descriptionEn")}
          disabled={!canEdit}
          lang="en"
        />
      </div>

      <div className={styles.group}>
        <h2>{t("contactTitle")}</h2>
        <p className="ed-muted">{t("contactHint")}</p>
        <div className={styles.twoCol}>
          <TextField
            id={`${uid}-phone`}
            name="contactPhone"
            label={f("contactPhone")}
            optionalLabel={c("optional")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            value={v.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
            error={err("contactPhone")}
            disabled={!canEdit}
          />
          <TextField
            id={`${uid}-email`}
            name="contactEmail"
            label={f("contactEmail")}
            optionalLabel={c("optional")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={320}
            value={v.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
            error={err("contactEmail")}
            disabled={!canEdit}
          />
        </div>
        <TextField
          id={`${uid}-web`}
          name="website"
          label={f("website")}
          hint={t("websiteHint")}
          optionalLabel={c("optional")}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          maxLength={300}
          value={v.website}
          onChange={(e) => set("website", e.target.value)}
          error={err("website")}
          disabled={!canEdit}
        />
      </div>

      <div className={styles.group}>
        <h2>
          <span className={styles.legendRow}>
            <span>{t("photosTitle")}</span>
            <Counter count={v.photos.length} max={MAX.photos} />
          </span>
        </h2>
        {v.photos.length > 0 ? (
          <ul className={styles.photos}>
            {v.photos.map((p, i) => (
              <li key={p.id} className={styles.photo}>
                <img src={p.url} alt={t("photoAlt", { n: i + 1 })} width={320} height={240} />
                <Button type="button" variant="quiet" size="sm" disabled={!canEdit} onClick={() => set("photos", v.photos.filter((x) => x.id !== p.id))} aria-label={t("removePhotoNamed", { n: i + 1 })}>
                  {t("removePhoto")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit && listingId && v.photos.length < MAX.photos ? (
          <FileField
            key={v.photos.length}
            label={t("addPhoto")}
            purpose="business.photo"
            ownerId={businessId}
            name="_upload"
            hint={t("photoHint")}
            optionalLabel={c("optional")}
            onUploaded={(file) => setV((prev) => (prev.photos.some((x) => x.id === file.id) ? prev : { ...prev, photos: [...prev.photos, { id: file.id, url: file.url }] }))}
          />
        ) : null}
        {!listingId ? <p className="ed-muted">{t("photosAfterSave")}</p> : null}
        <FieldsetError message={err("photoAssetIds")} />
      </div>

      <FocusFirstError errors={error?.fieldErrors ?? null} />
      {canEdit ? (
        <div className="ed-actionbar">
          <SubmitButton name="intent" value="submit" pendingLabel={t("submitting")}>
            {submitLabel}
          </SubmitButton>
          <SubmitButton name="intent" value="draft" variant="secondary" pendingLabel={t("savingDraft")}>
            {t("saveDraft")}
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
