"use client";

import { buttonClassName, ChoiceChips, FocusFirstError, Notice, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { createOccasionAction } from "@/app/actions/occasions";
import { DateFields, type DateMode } from "../_components/DateFields";
import { useForm } from "../_components/useForm";
import { plural } from "../_lib/plural";

type TemplateOption = { kind: string; name: string; description: string; taskCount: number };
// The template picker in two steps: a handful of groups first, then the kinds in that group.
// Grouping is for display only; any kind not listed here lands in "party" so it is never hidden.
const GROUPS: Record<string, string[]> = {
  love: ["nunta", "logodna", "reinnoire_juraminte", "petrecere_mireasa"],
  family: ["botez", "petrecere_bebelus", "dezvaluire_sex_bebelus", "inaugurare_casa", "comemorare"],
  party: ["aniversare", "zi_de_nastere", "zi_de_nastere_copii", "revelion", "petrecere_craciun", "picnic", "cina", "absolvire", "pensionare", "reuniune"],
  travel: ["voiaj_solo", "voiaj_grup"],
  work: ["conferinta", "lansare", "eveniment_networking", "atelier", "festivitate_premii", "gala_caritabila"],
  culture: ["concert", "expozitie", "festival", "turneu_sportiv"],
  blank: ["blank"],
};
const groupOf = (kind: string) => Object.keys(GROUPS).find((g) => GROUPS[g]!.includes(kind)) ?? "party";

const FIELDS = ["title", "kind", "startsOn", "endsOn", "venueName", "venueAddress", "purpose", "priority0", "priority1", "priority2"];

export function NewOccasionForm({ templates }: { templates: TemplateOption[] }) {
  const t = useTranslations("occasions");
  const c = useTranslations("common");
  const locale = useLocale();
  const f = useForm(createOccasionAction);
  const [kind, setKind] = useState(f.value("kind", "blank"));
  const [group, setGroup] = useState(groupOf(kind));
  const chosen = templates.find((x) => x.kind === kind);
  const inGroup = templates.filter((tpl) => groupOf(tpl.kind) === group);
  const groups = Object.keys(GROUPS).filter((g) => templates.some((tpl) => groupOf(tpl.kind) === g));

  return (
    <form action={f.formAction} className="ed-form" noValidate>
      {f.error && f.formLevel(FIELDS) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextField
        id="f-title"
        name="title"
        label={t("fields.title")}
        hint={t("fields.titleHint")}
        maxLength={120}
        required
        autoFocus
        defaultValue={f.value("title")}
        error={f.fieldError("title")}
      />
      <div
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          if (el.name === "kind") setKind(el.value);
          if (el.name === "kindGroup") {
            setGroup(el.value);
            setKind(templates.find((tpl) => groupOf(tpl.kind) === el.value)?.kind ?? "blank");
          }
        }}
        className="ed-stack"
      >
        <ChoiceChips
          name="kindGroup"
          legend={t("new.templateLegend")}
          defaultValue={group}
          options={groups.map((g) => ({ value: g, label: t(`new.groups.${g}`) }))}
          error={group === "blank" ? f.fieldError("kind") : undefined}
        />
        {group === "blank" ? (
          <input type="hidden" name="kind" value="blank" />
        ) : (
          <ChoiceChips
            key={group}
            name="kind"
            legend={t("new.kindLegend")}
            defaultValue={kind}
            options={inGroup.map((tpl) => ({ value: tpl.kind, label: tpl.name }))}
            error={f.fieldError("kind")}
          />
        )}
        <p className="ed-small ed-muted" aria-live="polite" style={{ marginTop: "var(--s-2)" }}>
          {chosen && chosen.taskCount > 0
            ? t(`new.templateNote.${plural(chosen.taskCount, locale)}`, { description: chosen.description, count: chosen.taskCount })
            : t("new.templateBlank")}
        </p>
      </div>
      <DateFields
        mode={(f.value("dateMode", "date") as DateMode) || "date"}
        startsOn={f.value("startsOn")}
        endsOn={f.value("endsOn")}
        errors={{ startsOn: f.fieldError("startsOn"), endsOn: f.fieldError("endsOn") }}
      />
      <TextField
        id="f-venueName"
        name="venueName"
        label={t("fields.venueName")}
        optionalLabel={c("optional")}
        maxLength={160}
        defaultValue={f.value("venueName")}
        error={f.fieldError("venueName")}
      />
      <details>
        <summary className="ed-btn ed-btn--quiet">{t("new.briefToggle")}</summary>
        <div className="ed-form" style={{ marginTop: "var(--s-3)" }}>
          <p className="ed-small ed-muted">{t("brief.intro")}</p>
          <TextareaField
            id="f-purpose"
            name="purpose"
            label={t("brief.purpose")}
            hint={t("brief.purposeHint")}
            optionalLabel={c("optional")}
            rows={2}
            maxLength={600}
            defaultValue={f.value("purpose")}
            error={f.fieldError("purpose")}
          />
          {[0, 1, 2].map((i) => (
            <TextField
              key={i}
              id={`f-priority${i}`}
              name={`priority${i}`}
              label={t("brief.priority", { number: i + 1 })}
              optionalLabel={c("optional")}
              maxLength={200}
              defaultValue={f.value(`priority${i}`)}
              error={f.fieldError(`priority${i}`)}
            />
          ))}
        </div>
      </details>
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <div className="ed-actionbar">
        <SubmitButton pendingLabel={t("new.submitting")}>{t("new.submit")}</SubmitButton>
        <Link href="/occasions" className={buttonClassName()}>
          {t("new.cancel")}
        </Link>
      </div>
      <p className="ed-small ed-muted">{t("new.freeNote")}</p>
    </form>
  );
}
