"use client";

import { Button, Notice, SheetTrigger, SubmitButton, Tag, TextareaField, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptAiTextAction, suggestTextAction } from "@/app/actions/aitext";

export type AiStatus = { enabled: boolean; remaining: number; limit: number; resetsOn: string };
type Tone = "ceremonious" | "warm" | "playful";

/**
 * INF7: asks for ONE wording suggestion and shows it in an edit box labelled "generat cu AI".
 * Nothing reaches the form until the person presses "Folosește textul"; closing the sheet
 * discards it. Only the kind of occasion, tone, language and the typed names/hint are sent.
 */
export function AiSuggest({
  purpose,
  occasionKind,
  language,
  names,
  status,
  onAccept,
  idPrefix,
}: {
  purpose: "invitation" | "save_the_date" | "thanks" | "message" | "promotion";
  occasionKind: string;
  language: "ro" | "en";
  names?: string;
  status: AiStatus;
  onAccept: (text: string, original: string) => void;
  idPrefix: string;
}) {
  const t = useTranslations("aitext");
  const tc = useTranslations("common");
  const [tone, setTone] = useState<Tone>("warm");
  const [hint, setHint] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [remaining, setRemaining] = useState(status.remaining);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!status.enabled) return null;

  const generate = () =>
    start(async () => {
      setError(null);
      const res = await suggestTextAction({ purpose, occasionKind, tone, language, names: names?.slice(0, 120) || undefined, hint: hint.trim() || undefined });
      if (res.ok) {
        setOriginal(res.data.text);
        setText(res.data.text);
        setResultId(res.data.resultId);
        setRemaining(res.data.remaining);
      } else setError(res.error.message);
    });
  const reset = () => {
    setOriginal(null);
    setText("");
    setResultId(null);
    setError(null);
  };

  return (
    <SheetTrigger
      label={t("open")}
      title={t("title")}
      closeLabel={tc("actions.close")}
      variant="quiet"
      footer={(close) =>
        original !== null ? (
          <>
            <Button
              type="button"
              onClick={() => {
                reset();
                close();
              }}
            >
              {t("discard")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!text.trim()}
              onClick={() => {
                onAccept(text.trim(), original);
                if (resultId) void acceptAiTextAction({ resultId });
                reset();
                close();
              }}
            >
              {t("use")}
            </Button>
          </>
        ) : null
      }
    >
      <div className="ed-form">
        <p className="ed-muted">{t("intro")}</p>
        <p className="ed-small ed-muted">{t("sent")}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <fieldset className="ed-fieldset">
          <legend className="ed-field__label">{t("toneLegend")}</legend>
          <div className="ed-chips">
            {(["ceremonious", "warm", "playful"] as const).map((v) => (
              <label className="ed-chip" key={v}>
                <input type="radio" name={`${idPrefix}-tone`} value={v} checked={tone === v} onChange={() => setTone(v)} />
                <span>{t(`tones.${v}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextField id={`${idPrefix}-hint`} label={t("hint")} hint={t("hintHint")} optionalLabel={tc("optional")} value={hint} maxLength={200} onChange={(e) => setHint(e.target.value)} />
        <div>
          <SubmitButton variant="secondary" pending={pending} pendingLabel={t("generating")} disabled={remaining <= 0} onClick={(e) => { e.preventDefault(); generate(); }}>
            {original === null ? t("generate") : t("again")}
          </SubmitButton>
        </div>
        <p className="ed-small ed-muted">
          {t("remaining", { remaining, limit: status.limit })} {remaining <= 0 ? t("resets", { date: status.resetsOn }) : null}
        </p>
        {original !== null ? (
          <>
            <Tag tone="accent">{t("label")}</Tag>
            <TextareaField id={`${idPrefix}-result`} label={t("resultLabel")} hint={t("keptLabel")} rows={6} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          </>
        ) : null}
      </div>
    </SheetTrigger>
  );
}
