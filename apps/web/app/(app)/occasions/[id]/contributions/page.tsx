import { listNeeds } from "@ed/core/contributions";
import { EmptyState, Figure, Meter, PageHeader, Section } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { removeNeedAction, saveNeedAction, setMyContributionAction } from "@/app/actions/contributions";
import { requireCtx } from "@/lib/ctx";
import { FormSheet, type FieldSpec } from "../guests/_components/form";
import styles from "../guests/_components/guests.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contributions"))("title") };
}

export default async function ContributionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("contributions");
  const tc = await getTranslations("common");
  const { needs, canManage } = await listNeeds(ctx, id);
  const needed = needs.reduce((s, n) => s + n.unitsNeeded, 0);
  const claimed = needs.reduce((s, n) => s + n.unitsClaimed, 0);

  const fields = (n?: (typeof needs)[number]): FieldSpec[] => [
    { name: "title", label: t("fields.title"), hint: t("fields.titleHint"), required: true, defaultValue: n?.title ?? "", maxLength: 120 },
    { name: "unitsNeeded", label: t("fields.units"), hint: t("fields.unitsHint"), type: "number", required: true, defaultValue: n?.unitsNeeded.toString() ?? "", maxLength: 4 },
    { name: "note", label: t("fields.note"), hint: t("fields.noteHint"), defaultValue: n?.note ?? "", maxLength: 300 },
  ];

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={
          canManage ? (
            <FormSheet
              label={t("add.button")}
              title={t("add.title")}
              closeLabel={tc("actions.close")}
              variant="primary"
              icon={<IconPlus size={16} />}
              form={{
                id: "add-need",
                action: saveNeedAction,
                hidden: { occasionId: id },
                optionalLabel: tc("optional"),
                fields: fields(),
                submitLabel: t("add.submit"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
              }}
            />
          ) : null
        }
      />

      {needs.length === 0 ? (
        <Section>
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
        </Section>
      ) : (
        <>
          <Section>
            <Figure
              size="hero"
              label={t("hero.label")}
              value={claimed}
              unit={t("hero.unit", { needed })}
              note={needed - claimed > 0 ? t("hero.left", { count: needed - claimed }) : t("hero.done")}
              noteTone={needed - claimed === 0 ? "success" : undefined}
            />
          </Section>

          <Section title={t("list.title")}>
            <div>
              {needs.map((n) => (
                <div className={styles.need} key={n.id}>
                  <div className={styles.needHead}>
                    <div>
                      <strong>{n.title}</strong>
                      {n.note ? <p className="ed-small ed-muted">{n.note}</p> : null}
                    </div>
                    <span className="ed-num ed-small">{t("list.count", { claimed: n.unitsClaimed, needed: n.unitsNeeded })}</span>
                  </div>
                  <Meter
                    value={n.unitsClaimed}
                    max={n.unitsNeeded}
                    tone={n.unitsLeft === 0 ? "success" : undefined}
                    label={n.unitsLeft === 0 ? t("list.covered") : t("list.left", { count: n.unitsLeft })}
                  />
                  {n.claims.length > 0 ? (
                    <p className="ed-small">
                      {n.claims.map((c) => t("list.claim", { by: c.by, units: c.units })).join(" · ")}
                    </p>
                  ) : (
                    <p className="ed-small ed-muted">{t("list.noClaims")}</p>
                  )}
                  <div className={styles.inline}>
                    <FormSheet
                      label={n.mine > 0 ? t("mine.change", { count: n.mine }) : t("mine.claim")}
                      title={n.title}
                      closeLabel={tc("actions.close")}
                      intro={<p className="ed-muted">{t("mine.intro", { left: n.unitsLeft + n.mine })}</p>}
                      form={{
                        id: `claim-${n.id}`,
                        action: setMyContributionAction,
                        hidden: { occasionId: id, needId: n.id },
                        fields: [
                          { name: "units", label: t("mine.units"), hint: t("mine.unitsHint"), type: "number", required: true, defaultValue: String(n.mine || 1), maxLength: 4 },
                        ],
                        submitLabel: t("mine.save"),
                        pendingLabel: tc("status.saving"),
                        success: tc("status.saved"),
                      }}
                    />
                    {canManage ? (
                      <>
                        <FormSheet
                          label={tc("actions.edit")}
                          title={t("edit.title")}
                          closeLabel={tc("actions.close")}
                          form={{
                            id: `edit-${n.id}`,
                            action: saveNeedAction,
                            hidden: { occasionId: id, needId: n.id },
                            optionalLabel: tc("optional"),
                            fields: fields(n),
                            submitLabel: tc("actions.save"),
                            pendingLabel: tc("status.saving"),
                            success: tc("status.saved"),
                          }}
                        />
                        <FormSheet
                          label={t("remove.button")}
                          title={t("remove.title", { title: n.title })}
                          closeLabel={tc("actions.close")}
                          variant="danger-quiet"
                          intro={<p>{t("remove.body")}</p>}
                          form={{
                            id: `rm-${n.id}`,
                            action: removeNeedAction,
                            hidden: { occasionId: id, needId: n.id },
                            variant: "danger",
                            submitLabel: t("remove.submit"),
                            pendingLabel: tc("status.deleting"),
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  );
}
