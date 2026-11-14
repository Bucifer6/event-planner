"use client";

import { ChoiceChips, TextField } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

export type DateMode = "date" | "range" | "poll";

/**
 * A1: one day, several days, or "we decide by poll". Only the fields that the chosen mode
 * needs are shown. Used when creating an occasion and when moving its date.
 */
export function DateFields({
  mode: initialMode,
  startsOn,
  endsOn,
  errors,
}: {
  mode: DateMode;
  startsOn?: string;
  endsOn?: string;
  errors?: { startsOn?: string; endsOn?: string };
}) {
  const t = useTranslations("occasions.date");
  const [mode, setMode] = useState<DateMode>(initialMode);
  return (
    <>
      <div
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          if (el.name === "dateMode") setMode(el.value as DateMode);
        }}
      >
        <ChoiceChips
          name="dateMode"
          legend={t("legend")}
          defaultValue={initialMode}
          options={[
            { value: "date", label: t("mode.date") },
            { value: "range", label: t("mode.range") },
            { value: "poll", label: t("mode.poll") },
          ]}
        />
      </div>
      {mode === "poll" ? (
        <p className="ed-small ed-muted">{t("pollHint")}</p>
      ) : (
        <div className="ed-grid" data-cols={mode === "range" ? "2" : undefined}>
          <TextField
            id="f-startsOn"
            name="startsOn"
            type="date"
            label={mode === "range" ? t("startsOnRange") : t("startsOn")}
            defaultValue={startsOn}
            error={errors?.startsOn}
          />
          {mode === "range" ? (
            <TextField id="f-endsOn" name="endsOn" type="date" label={t("endsOn")} defaultValue={endsOn} error={errors?.endsOn} />
          ) : null}
        </div>
      )}
    </>
  );
}
