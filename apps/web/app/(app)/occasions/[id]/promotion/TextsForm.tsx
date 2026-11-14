"use client";

import { CopyButton, Notice, SubmitButton, Tag, TextareaField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePromotionTextsAction } from "@/app/actions/promotion";
import { AiSuggest, type AiStatus } from "../stationery/AiSuggest";
import styles from "./promotion.module.css";

const KEYS = ["shortRo", "longRo", "shortEn", "longEn"] as const;
type Key = (typeof KEYS)[number];
export type PromoText = { value: string; aiOriginal: string | null; saved: boolean };

/** The four description texts: edit, copy, keep. Copying is the whole "publishing" this page does. */
export function PromotionTexts({ occasionId, occasionKind, canManage, initial, limits, ai }: { occasionId: string; occasionKind: string; canManage: boolean; initial: Record<Key, PromoText>; limits: Record<Key, number>; ai: AiStatus }) {
  const t = useTranslations("promotion.texts");
  const ts = useTranslations("stationery.form");
  const router = useRouter();
  const [texts, setTexts] = useState(initial);
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null>(null);
  const set = (k: Key, patch: Partial<PromoText>) => {
    setTexts((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
    setState(null);
  };
  const save = () =>
    start(async () => {
      const res = await savePromotionTextsAction({ occasionId, texts: Object.fromEntries(KEYS.map((k) => [k, { value: texts[k].value, aiOriginal: texts[k].aiOriginal }])) });
      if (res.ok) {
        setState({ ok: true });
        router.refresh();
      } else {
        setState({ ok: false, message: res.error.message, fieldErrors: res.error.fieldErrors });
        const bad = Object.keys(res.error.fieldErrors ?? {})[0];
        if (bad) document.getElementById(`promo-${bad}`)?.focus();
      }
    });
  return (
    <div className="ed-form">
      {!canManage ? <Notice>{t("readOnly")}</Notice> : null}
      {KEYS.map((k) => (
        <div key={k} className={styles.textBlock}>
          <TextareaField
            id={`promo-${k}`}
            label={
              <span className={styles.textHead}>
                {t(k)}
                {texts[k].aiOriginal ? <Tag tone="accent">{ts("aiLabel")}</Tag> : null}
              </span>
            }
            hint={!texts[k].saved && texts[k].value === initial[k].value ? t("composed") : undefined}
            rows={k.startsWith("short") ? 3 : 6}
            value={texts[k].value}
            readOnly={!canManage}
            error={state?.fieldErrors?.[k]?.[0] ?? (texts[k].value.length > limits[k] ? state?.message : undefined)}
            onChange={(e) => set(k, { value: e.target.value })}
          />
          <div className={styles.tools}>
            <CopyButton text={texts[k].value} label={t("copy")} copiedLabel={t("copied")} />
            {canManage && k.startsWith("long") ? (
              <AiSuggest idPrefix={`ai-${k}`} purpose="promotion" occasionKind={occasionKind} language={k.endsWith("Ro") ? "ro" : "en"} status={ai} onAccept={(text, original) => set(k, { value: text, aiOriginal: original })} />
            ) : null}
          </div>
        </div>
      ))}
      {canManage ? (
        <>
          {state && !state.ok && !state.fieldErrors ? <Notice tone="danger">{state.message}</Notice> : null}
          {state?.ok ? <Notice tone="success">{t("saved")}</Notice> : null}
          <div className="ed-actionbar">
            <SubmitButton pending={pending} pendingLabel={t("saving")} onClick={(e) => { e.preventDefault(); save(); }}>
              {t("save")}
            </SubmitButton>
          </div>
        </>
      ) : null}
    </div>
  );
}
