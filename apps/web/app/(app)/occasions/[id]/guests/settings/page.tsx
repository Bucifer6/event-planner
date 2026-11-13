import { getCapacity } from "@ed/core/capacity";
import { getRsvpSettings } from "@ed/core/rsvp";
import { EmptyState, List, PageHeader, Row, Section, Tag } from "@ed/ui";
import { IconArrowLeft, IconPlus } from "@ed/ui/icons";
import { zonedDateKey } from "@ed/shared/time";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  moveRsvpQuestionAction,
  removeRsvpQuestionAction,
  saveRsvpQuestionAction,
  setCapacityAction,
  setRsvpDeadlineAction,
} from "@/app/actions/guests";
import { requireCtx } from "@/lib/ctx";
import { FormSheet, PlannerForm, type FieldSpec } from "../_components/form";
import styles from "../_components/guests.module.css";

const KINDS = ["menu_choice", "allergies", "accommodation", "transport", "single_choice", "free_text"] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("guests"))("settings.title") };
}

export default async function GuestSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("guests");
  const tc = await getTranslations("common");
  const [settings, capacity] = await Promise.all([getRsvpSettings(ctx, id), getCapacity(ctx, id)]);
  const base = `/occasions/${id}/guests`;

  const questionFields = (q?: (typeof settings.questions)[number]): FieldSpec[] => [
    {
      name: "kind",
      label: t("questions.kind"),
      type: "select",
      defaultValue: q?.kind ?? "menu_choice",
      options: KINDS.map((k) => ({ value: k, label: t(`questions.kinds.${k}`) })),
    },
    { name: "textRo", label: t("questions.textRo"), required: true, defaultValue: q?.text.ro ?? "", maxLength: 200 },
    { name: "textEn", label: t("questions.textEn"), hint: t("questions.textEnHint"), defaultValue: q && q.text.en !== q.text.ro ? q.text.en : "", maxLength: 200 },
    {
      name: "optionsRo",
      label: t("questions.optionsRo"),
      hint: t("questions.optionsHint"),
      type: "textarea",
      rows: 4,
      defaultValue: q?.rawOptions.map((o) => o.ro).join("\n") ?? "",
    },
    {
      name: "optionsEn",
      label: t("questions.optionsEn"),
      hint: t("questions.optionsEnHint"),
      type: "textarea",
      rows: 4,
      defaultValue: q?.rawOptions.some((o) => o.en !== o.ro) ? q.rawOptions.map((o) => o.en).join("\n") : "",
    },
    { name: "required", label: t("questions.required"), type: "checkbox", defaultValue: q?.required ? "on" : "" },
  ];

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("detail.back")}
      </Link>
      <PageHeader level={2} title={t("settings.title")} description={t("settings.description")} />

      <Section title={t("settings.deadlineTitle")}>
        <PlannerForm
          id="deadline"
          action={setRsvpDeadlineAction}
          hidden={{ occasionId: id }}
          variant="secondary"
          optionalLabel={tc("optional")}
          fields={[
            {
              name: "rsvpDeadline",
              label: t("settings.deadline"),
              hint: t("settings.deadlineHint"),
              type: "date",
              defaultValue: settings.rsvpDeadline ? zonedDateKey(settings.rsvpDeadline) : "",
            },
          ]}
          submitLabel={t("settings.saveDeadline")}
          pendingLabel={tc("status.saving")}
          success={tc("status.saved")}
        />
      </Section>

      <Section title={t("settings.capacityTitle")}>
        <PlannerForm
          id="capacity"
          action={setCapacityAction}
          hidden={{ occasionId: id }}
          variant="secondary"
          optionalLabel={tc("optional")}
          fields={[
            {
              name: "total",
              label: t("settings.capacity"),
              hint: t("settings.capacityHint", { taken: capacity.taken }),
              type: "number",
              defaultValue: capacity.total?.toString() ?? "",
              maxLength: 5,
            },
          ]}
          submitLabel={t("settings.saveCapacity")}
          pendingLabel={tc("status.saving")}
          success={tc("status.saved")}
        />
      </Section>

      <Section
        title={t("questions.title")}
        actions={
          <FormSheet
            label={t("questions.add")}
            title={t("questions.addTitle")}
            closeLabel={tc("actions.close")}
            variant="primary"
            icon={<IconPlus size={16} />}
            intro={<p className="ed-muted">{t("questions.intro")}</p>}
            form={{
              id: "add-question",
              action: saveRsvpQuestionAction,
              hidden: { occasionId: id },
              optionalLabel: tc("optional"),
              fields: questionFields(),
              submitLabel: t("questions.save"),
              pendingLabel: tc("status.saving"),
              success: tc("status.saved"),
            }}
          />
        }
      >
        <p className="ed-muted">{t("questions.description")}</p>
        {settings.questions.length === 0 ? (
          <EmptyState title={t("questions.emptyTitle")}>{t("questions.emptyBody")}</EmptyState>
        ) : (
          <List>
            {settings.questions.map((q, i) => (
              <Row
                key={q.id}
                index={String(i + 1).padStart(2, "0")}
                title={q.text.ro}
                meta={
                  <>
                    {t(`questions.kinds.${q.kind}`)}
                    {q.options.length > 0 ? ` · ${q.options.map((o) => o.ro).join(", ")}` : ""}
                  </>
                }
              >
                <div className={styles.inline}>
                  {q.required ? <Tag>{t("questions.requiredTag")}</Tag> : null}
                  <FormSheet
                    label={tc("actions.edit")}
                    title={t("questions.editTitle")}
                    closeLabel={tc("actions.close")}
                    form={{
                      id: `edit-${q.id}`,
                      action: saveRsvpQuestionAction,
                      hidden: { occasionId: id, questionId: q.id },
                      optionalLabel: tc("optional"),
                      fields: questionFields(q),
                      submitLabel: t("questions.save"),
                      pendingLabel: tc("status.saving"),
                      success: tc("status.saved"),
                    }}
                  />
                  {i > 0 ? (
                    <PlannerForm
                      id={`up-${q.id}`}
                      action={moveRsvpQuestionAction}
                      hidden={{ occasionId: id, questionId: q.id, direction: "up" }}
                      variant="quiet"
                      submitLabel={t("questions.moveUp")}
                      pendingLabel={tc("status.saving")}
                    />
                  ) : null}
                  {i < settings.questions.length - 1 ? (
                    <PlannerForm
                      id={`down-${q.id}`}
                      action={moveRsvpQuestionAction}
                      hidden={{ occasionId: id, questionId: q.id, direction: "down" }}
                      variant="quiet"
                      submitLabel={t("questions.moveDown")}
                      pendingLabel={tc("status.saving")}
                    />
                  ) : null}
                  <PlannerForm
                    id={`rm-${q.id}`}
                    action={removeRsvpQuestionAction}
                    hidden={{ occasionId: id, questionId: q.id }}
                    variant="danger-quiet"
                    submitLabel={t("questions.remove")}
                    pendingLabel={tc("status.deleting")}
                  />
                </div>
              </Row>
            ))}
          </List>
        )}
        <p className="ed-small ed-muted">{t("questions.childrenNote")}</p>
      </Section>
    </>
  );
}
