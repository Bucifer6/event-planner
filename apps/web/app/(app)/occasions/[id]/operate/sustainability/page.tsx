import { getOccasionView } from "@ed/core/occasions";
import { getSustainability, METRIC_DEFAULTS, type GoalView } from "@ed/core/sustainability";
import { SUSTAINABILITY_METRICS } from "@ed/db";
import { formatDateTime } from "@ed/i18n/format";
import { EmptyState, Meter, Tag, Unknown, type Tone } from "@ed/ui";
import { IconArrowLeft, IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createGoalAction, deleteGoalAction, recordMeasurementAction } from "@/app/actions/operate";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, SheetForm } from "../../travel/_components/forms";
import styles from "../_components/operate.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("sustainability.title") };
}

const TONE: Record<GoalView["progress"]["status"], Tone> = { unknown: "neutral", measured: "neutral", on_track: "success", behind: "attention" };

/**
 * E-04: optional sustainability goals against MEASURED quantities. Nothing nudges anyone to
 * use it. Unknown is shown as unknown — never as zero, never as "on track" (principle 5).
 */
export default async function SustainabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  const tc = await getTranslations("common");
  const { occasion } = await orNotFound(getOccasionView(ctx, id));
  const view = await getSustainability(ctx, id);
  const open = occasion.status !== "closed";
  const num = (n: number) => new Intl.NumberFormat(ctx.locale === "en" ? "en-GB" : "ro-RO", { maximumFractionDigits: 2 }).format(n);
  const name = (g: GoalView) => (g.metric === "custom" ? (g.label ?? "") : t(`sustainability.metrics.${g.metric}`));

  const addGoal = (variant: "primary" | "secondary") => (
    <SheetForm
      label={t("sustainability.add")}
      title={t("sustainability.addTitle")}
      closeLabel={tc("actions.close")}
      variant={variant}
      icon={<IconPlus />}
      intro={t("sustainability.addIntro")}
      form={{
        id: "goal-new",
        action: createGoalAction,
        hidden: { occasionId: id },
        optionalLabel: tc("optional"),
        pendingLabel: tc("status.saving"),
        submitLabel: t("sustainability.addSubmit"),
        fields: [
          { name: "metric", label: t("sustainability.metric"), type: "select", defaultValue: "food_waste_kg", options: SUSTAINABILITY_METRICS.map((m) => ({ value: m, label: m === "custom" ? t("sustainability.metrics.custom") : `${t(`sustainability.metrics.${m}`)} (${METRIC_DEFAULTS[m].unit})` })) },
          { name: "targetValue", label: t("sustainability.target"), type: "decimal", hint: t("sustainability.targetHint"), maxLength: 12 },
          { name: "label", label: t("sustainability.customLabel"), hint: t("sustainability.customHint"), maxLength: 80 },
          { name: "unit", label: t("sustainability.customUnit"), maxLength: 12 },
          { name: "direction", label: t("sustainability.direction"), type: "select", hint: t("sustainability.customOnly"), defaultValue: "at_most", options: [{ value: "at_most", label: t("sustainability.directions.at_most") }, { value: "at_least", label: t("sustainability.directions.at_least") }] },
          { name: "aggregate", label: t("sustainability.aggregate"), type: "select", hint: t("sustainability.customOnly"), defaultValue: "sum", options: [{ value: "sum", label: t("sustainability.aggregates.sum") }, { value: "latest", label: t("sustainability.aggregates.latest") }] },
        ],
      }}
    />
  );

  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <Link href={`/occasions/${id}/operate`} className={styles.back}>
          <IconArrowLeft size={16} /> {t("backToHub")}
        </Link>
        <div className={styles.topRow}>
          <div className={styles.hero}>
            <span className="ed-label">{t("sustainability.eyebrow")}</span>
            <h2 className={styles.blockTitle}>{t("sustainability.title")}</h2>
            <span className={styles.heroNote}>{t("sustainability.description")}</span>
          </div>
          {view.canManage && open && view.goals.length > 0 ? addGoal("secondary") : null}
        </div>
      </header>

      {view.goals.length === 0 ? (
        <EmptyState title={t("sustainability.emptyTitle")} action={view.canManage && open ? addGoal("primary") : undefined}>
          {view.canManage ? t("sustainability.emptyBody") : t("sustainability.emptyBodyMember")}
        </EmptyState>
      ) : (
        <div className={styles.layout}>
          {view.goals.map((g) => {
            const p = g.progress;
            const targetText = g.targetValue === null ? null : t(`sustainability.targetLine.${g.direction}`, { target: num(g.targetValue), unit: g.unit });
            return (
              <article key={g.id} className={styles.goal}>
                <div className={styles.goalHead}>
                  <h3 className={styles.blockTitle}>{name(g)}</h3>
                  <Tag tone={TONE[p.status]}>{t(`sustainability.status.${p.status}`)}</Tag>
                </div>
                <div>
                  <span className={styles.goalValue}>{p.value === null ? <Unknown label={tc("unknown")} /> : `${num(p.value)} ${g.unit}`}</span>
                </div>
                {p.value !== null && g.targetValue !== null ? (
                  <Meter value={p.value} max={Math.max(g.targetValue, p.value)} tone={p.status === "behind" ? "danger" : p.status === "on_track" ? "success" : undefined} label={targetText} />
                ) : (
                  <p className={styles.small}>{targetText ?? t("sustainability.noTarget")}</p>
                )}
                <p className={styles.small}>
                  {t(`sustainability.words.${p.status}`)} {p.hasUnknown && p.status !== "unknown" ? t("sustainability.partUnknown") : ""}
                </p>
                {g.measurements.length > 0 ? (
                  <ul className={styles.readings} aria-label={t("sustainability.readings")}>
                    {g.measurements.slice(0, 6).map((m) => (
                      <li key={m.id}>
                        <span>
                          {m.value === null ? <Unknown label={tc("unknown")} /> : `${num(m.value)} ${g.unit}`}
                          {m.note ? ` — ${m.note}` : ""}
                        </span>
                        <span>{formatDateTime(m.measuredAt, ctx.locale)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {open ? (
                  <div className={styles.actions}>
                    <SheetForm
                      label={t("sustainability.measure")}
                      title={t("sustainability.measureTitle", { name: name(g) })}
                      closeLabel={tc("actions.close")}
                      intro={t(`sustainability.measureIntro.${g.aggregate}`)}
                      form={{
                        id: `measure-${g.id}`,
                        action: recordMeasurementAction,
                        hidden: { occasionId: id, goalId: g.id },
                        optionalLabel: tc("optional"),
                        pendingLabel: tc("status.saving"),
                        submitLabel: t("sustainability.measureSubmit"),
                        fields: [
                          { name: "value", label: t("sustainability.value", { unit: g.unit }), type: "decimal", maxLength: 12 },
                          { name: "unknown", label: t("sustainability.unknownTick"), type: "checkbox", hint: t("sustainability.unknownHint") },
                          { name: "note", label: t("sustainability.note"), maxLength: 300 },
                        ],
                      }}
                    />
                    {view.canManage ? (
                      <DangerSheet
                        action={deleteGoalAction}
                        hidden={{ occasionId: id, goalId: g.id }}
                        label={tc("actions.delete")}
                        title={t("sustainability.deleteTitle")}
                        body={t("sustainability.deleteBody", { name: name(g) })}
                        confirmLabel={t("sustainability.deleteConfirm")}
                        keepLabel={tc("actions.keep")}
                        pendingLabel={tc("status.deleting")}
                        closeLabel={tc("actions.close")}
                      />
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
