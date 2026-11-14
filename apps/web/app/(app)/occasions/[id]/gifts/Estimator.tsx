"use client";

import { Card, EmptyState, Figure, Notice, SelectField, Stepper, SubmitButton, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteGiftEstimateAction, estimateGiftAction, resetGiftGuideAction, saveGiftEstimateAction, saveGiftGuideAction } from "@/app/actions/gifts";
import { useForm } from "../../_components/useForm";
import styles from "./gifts.module.css";

const RELATIONSHIPS = ["close_family", "family", "close_friend", "friend", "colleague"] as const;
const DISTANCES = ["local", "county", "country", "abroad"] as const;
const VENUES = ["restaurant", "ballroom", "premium", "home"] as const;
type Answers = { relationship: (typeof RELATIONSHIPS)[number] | ""; distance: (typeof DISTANCES)[number] | ""; venue: (typeof VENUES)[number] | ""; adults: number };
type Result = { lowMinor: number; highMinor: number; currency: string; reasoning: { baseLowMinor: number; baseHighMinor: number; relationshipPct: number; distancePct: number; adults: number }; answers: { relationship: string; distance: string; venue: string; adults: number } };

const num = (minor: number, locale: string) => new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { maximumFractionDigits: 0 }).format(minor / 100);
const lei = (minor: number, locale: string) => `${new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { maximumFractionDigits: 0 }).format(minor / 100)} RON`;

function Group<T extends string>({ name, legend, value, options, onChange }: { name: string; legend: string; value: T | ""; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset className="ed-fieldset">
      <legend className="ed-field__label">{legend}</legend>
      <div className="ed-chips">
        {options.map((o) => (
          <label className="ed-chip" key={o.value}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Three questions → one range, with the reasoning in words. Private to the signed-in account. */
export function GiftEstimator({ occasionId, households, locale }: { occasionId: string; households: Array<{ id: string; name: string }>; locale: string }) {
  const t = useTranslations("gifts");
  const router = useRouter();
  const [a, setA] = useState<Answers>({ relationship: "", distance: "", venue: "", adults: 2 });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [householdId, setHouseholdId] = useState(households[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [kept, setKept] = useState(false);
  const [keepError, setKeepError] = useState<{ message: string; label?: string } | null>(null);
  const [keeping, startKeep] = useTransition();
  const complete = a.relationship && a.distance && a.venue;

  const calculate = () =>
    start(async () => {
      setError(null);
      setKept(false);
      const res = await estimateGiftAction({ relationship: a.relationship as never, distance: a.distance as never, venue: a.venue as never, adults: a.adults });
      if (res.ok) setResult(res.data as Result);
      else setError(res.error.message);
    });
  const keep = () =>
    startKeep(async () => {
      if (!result) return;
      setKeepError(null);
      const res = await saveGiftEstimateAction({ occasionId, ...(result.answers as never as { relationship: "friend"; distance: "local"; venue: "home"; adults: number }), householdId: householdId || null, label: householdId ? undefined : label });
      if (res.ok) {
        setKept(true);
        router.refresh();
      } else setKeepError({ message: res.error.message, label: res.error.fieldErrors?.label?.[0] });
    });

  return (
    <div className={styles.layout}>
      <div className="ed-form">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Group name="relationship" legend={t("form.relationship")} value={a.relationship} options={RELATIONSHIPS.map((v) => ({ value: v, label: t(`relationships.${v}`) }))} onChange={(v) => setA({ ...a, relationship: v })} />
        <Group name="distance" legend={t("form.distance")} value={a.distance} options={DISTANCES.map((v) => ({ value: v, label: t(`distances.${v}`) }))} onChange={(v) => setA({ ...a, distance: v })} />
        <Group name="venue" legend={t("form.venue")} value={a.venue} options={VENUES.map((v) => ({ value: v, label: t(`venues.${v}`) }))} onChange={(v) => setA({ ...a, venue: v })} />
        <Stepper name="adults" label={t("form.adults")} defaultValue={2} min={1} max={12} decreaseLabel={t("form.fewer")} increaseLabel={t("form.more")} onChange={(v) => setA((cur) => ({ ...cur, adults: v }))} />
        <div className="ed-actionbar">
          <SubmitButton pending={pending} pendingLabel={t("form.calculating")} disabled={!complete} onClick={(e) => { e.preventDefault(); if (complete) calculate(); }}>
            {t("form.calculate")}
          </SubmitButton>
        </div>
      </div>

      <div className={styles.result} aria-live="polite">
        {result ? (
          <>
            <Card framed>
              <Figure size="hero" label={t("result.label")} value={t("result.range", { low: num(result.lowMinor, locale), high: num(result.highMinor, locale) })} unit={result.currency} note={t("result.note")} />
            </Card>
            <div className="ed-stack" data-gap="2">
              <h3 className="ed-label">{t("result.why")}</h3>
              <ul className={styles.why}>
                <li>{t("result.base", { venue: t(`venues.${result.answers.venue}`), low: lei(result.reasoning.baseLowMinor, locale), high: lei(result.reasoning.baseHighMinor, locale) })}</li>
                <li>{t("result.relationship", { relationship: t(`relationships.${result.answers.relationship}`), pct: result.reasoning.relationshipPct })}</li>
                <li>{t("result.distance", { distance: t(`distances.${result.answers.distance}`), pct: result.reasoning.distancePct })}</li>
                <li>{result.reasoning.adults === 1 ? t("result.adultsOne") : t("result.adults", { adults: result.reasoning.adults })}</li>
              </ul>
            </div>
            <div className="ed-form">
              <h3 className="ed-label">{t("keep.title")}</h3>
              {keepError && !keepError.label ? <Notice tone="danger">{keepError.message}</Notice> : null}
              {kept ? <Notice tone="success">{t("keep.saved")}</Notice> : null}
              <SelectField id="gift-household" label={t("keep.household")} value={householdId} onChange={(e) => setHouseholdId(e.target.value)}>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
                <option value="">{t("keep.none")}</option>
              </SelectField>
              {!householdId ? <TextField id="gift-label" label={t("keep.label")} value={label} maxLength={80} error={keepError?.label} onChange={(e) => setLabel(e.target.value)} /> : null}
              <div>
                <SubmitButton variant="secondary" pending={keeping} pendingLabel={t("keep.saving")} onClick={(e) => { e.preventDefault(); keep(); }}>
                  {t("keep.save")}
                </SubmitButton>
              </div>
            </div>
          </>
        ) : (
          <EmptyState title={t("result.empty")}>{t("result.emptyBody")}</EmptyState>
        )}
      </div>
    </div>
  );
}

export function RemoveNote({ occasionId, id, label, pendingLabel }: { occasionId: string; id: string; label: string; pendingLabel: string }) {
  const f = useForm(deleteGiftEstimateAction, { refresh: true });
  return (
    <form action={f.formAction}>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="danger-quiet" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}

export type GuideValues = { base: Record<string, { low: number; high: number }>; relationshipPct: Record<string, number>; distancePct: Record<string, number> };

/** The table the ranges come from — shown in full, editable, the account's own. */
export function GuideForm({ occasionId, values, isDefault }: { occasionId: string; values: GuideValues; isDefault: boolean }) {
  const t = useTranslations("gifts");
  const f = useForm(saveGiftGuideAction, { refresh: true });
  const r = useForm(resetGiftGuideAction, { refresh: true });
  const num = (name: string, label: string, def: number) => <TextField key={name} id={`guide-${name}`} name={name} label={label} inputMode="numeric" defaultValue={f.value(name, String(def))} error={f.fieldError(name)} />;
  return (
    <>
      <form action={f.formAction} className="ed-form" noValidate>
        <input type="hidden" name="occasionId" value={occasionId} />
        {f.error && !f.error.fieldErrors ? <Notice tone="danger">{f.error.message}</Notice> : null}
        {f.ok ? <Notice tone="success">{t("guide.saved")}</Notice> : null}
        <p className={styles.tableTitle}>{t("guide.baseTitle")}</p>
        {VENUES.map((v) => (
          <div className={styles.pair} key={v}>
            {num(`low_${v}`, t("guide.low", { venue: t(`venues.${v}`) }), values.base[v]!.low)}
            {num(`high_${v}`, t("guide.high", { venue: t(`venues.${v}`) }), values.base[v]!.high)}
          </div>
        ))}
        <p className={styles.tableTitle}>{t("guide.relationshipTitle")}</p>
        {RELATIONSHIPS.map((v) => num(`rel_${v}`, t(`relationships.${v}`), values.relationshipPct[v]!))}
        <p className={styles.tableTitle}>{t("guide.distanceTitle")}</p>
        {DISTANCES.map((v) => num(`dist_${v}`, t(`distances.${v}`), values.distancePct[v]!))}
        <div>
          <SubmitButton variant="secondary" pendingLabel={t("guide.saving")}>
            {t("guide.save")}
          </SubmitButton>
        </div>
      </form>
      {!isDefault ? (
        <form action={r.formAction}>
          <input type="hidden" name="occasionId" value={occasionId} />
          <SubmitButton variant="quiet" pendingLabel={t("guide.resetting")}>
            {t("guide.reset")}
          </SubmitButton>
        </form>
      ) : null}
    </>
  );
}


