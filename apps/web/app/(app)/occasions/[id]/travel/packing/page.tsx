import { getOccasionView } from "@ed/core/occasions";
import { listPackingLists, PACKING_TEMPLATE_KEYS } from "@ed/core/packing";
import { canPlanTrip, listSubgroups } from "@ed/core/subgroups";
import { EmptyState, Meter, PageHeader, Section, Tag } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { addPackingItemAction, createPackingListAction, deletePackingListAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, QuickAction, SheetForm, TForm } from "../_components/forms";
import { Tabs, travelTabs } from "../_components/Tabs";
import styles from "../_components/travel.module.css";
import { PackingItems } from "./PackingItems";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("packing.title") };
}

/**
 * D-03: packing lists. Each list is a task with check items (the same rows the Tasks views
 * show). One-tap starters for common trips make a personal list.
 */
export default async function PackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const { occasion, member } = await orNotFound(getOccasionView(ctx, id));
  const [lists, groups] = await Promise.all([listPackingLists(ctx, id), listSubgroups(ctx, id)]);
  const readOnly = occasion.status === "closed";
  const planner = canPlanTrip(member);
  const ledGroups = groups.filter((g) => planner || g.leadMemberId === member.id);
  const canPersonal = !member.viaBusiness && !readOnly;
  const scopeOptions = [
    ...(canPersonal ? [{ value: "personal", label: t("packing.scopes.personal") }] : []),
    ...(planner ? [{ value: "occasion", label: t("packing.scopes.occasion") }] : []),
    ...(ledGroups.length > 0 ? [{ value: "subgroup", label: t("packing.scopes.subgroup") }] : []),
  ];

  const starters = canPersonal ? (
    <div className={styles.starters}>
      {PACKING_TEMPLATE_KEYS.map((k) => (
        <QuickAction key={k} action={createPackingListAction} hidden={{ occasionId: id, title: t(`packing.templates.${k}`), scope: "personal", template: k }} label={t(`packing.templates.${k}`)} pendingLabel={tc("status.saving")} variant="secondary" block />
      ))}
    </div>
  ) : null;
  const custom =
    scopeOptions.length > 0 && !readOnly ? (
      <SheetForm
        label={t("packing.add")}
        title={t("packing.addTitle")}
        closeLabel={tc("actions.close")}
        icon={<IconPlus />}
        form={{
          id: "packing-new",
          action: createPackingListAction,
          hidden: { occasionId: id },
          optionalLabel: tc("optional"),
          pendingLabel: tc("status.saving"),
          submitLabel: t("packing.addSubmit"),
          fields: [
            { name: "title", label: t("packing.name"), required: true, maxLength: 120, placeholder: t("packing.nameExample") },
            { name: "scope", label: t("packing.scope"), type: "select", defaultValue: scopeOptions[0]!.value, options: scopeOptions, hint: t("packing.scopeHint") },
            ...(ledGroups.length > 0 ? [{ name: "subgroupId", label: t("packing.subgroup"), type: "select" as const, hint: t("packing.subgroupHint"), options: ledGroups.map((g) => ({ value: g.id, label: g.name })) }] : []),
            { name: "template", label: t("packing.starter"), type: "select", options: [{ value: "", label: t("packing.noStarter") }, ...PACKING_TEMPLATE_KEYS.map((k) => ({ value: k, label: t(`packing.templates.${k}`) }))] },
          ],
        }}
      />
    ) : null;

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("packing.title")} description={t("packing.description")} actions={lists.length > 0 ? custom : undefined} />
      <Tabs items={travelTabs(id, t)} current="packing" label={t("tabs.label")} />

      {lists.length === 0 ? (
        <EmptyState title={t("packing.emptyTitle")} action={custom ?? undefined}>
          {t("packing.emptyBody")}
        </EmptyState>
      ) : null}

      {starters ? (
        <Section title={t("packing.startersTitle")} level={3}>
          <p className="ed-small ed-muted">{t("packing.startersBody")}</p>
          {starters}
        </Section>
      ) : null}

      {lists.length > 0 ? (
        <ul className={styles.cards}>
          {lists.map((l) => (
            <li key={l.taskId} className={styles.card}>
              <div className={styles.cardHead}>
                <h3 className={styles.cardTitle}>{l.title}</h3>
                <Tag tone={l.scope === "personal" ? "accent" : "neutral"}>{l.scope === "subgroup" && l.subgroupName ? l.subgroupName : t(`packing.scopes.${l.scope}`)}</Tag>
              </div>
              {l.total > 0 ? <Meter value={l.done} max={l.total} tone={l.done === l.total ? "success" : undefined} label={l.done === l.total ? t("packing.allDone", { total: l.total }) : t("packing.progress", { done: l.done, total: l.total })} /> : <p className="ed-small ed-muted">{t("packing.noItems")}</p>}
              <PackingItems occasionId={id} items={l.items.map((i) => ({ id: i.id, label: i.label, done: i.done }))} canShape={l.canShape} readOnly={readOnly} removeLabel={t("packing.removeItem")} errorLabel={tc("errors.UNEXPECTED")} />
              {l.canShape && !readOnly ? (
                <>
                  <TForm
                    id={`item-${l.taskId}`}
                    action={addPackingItemAction}
                    hidden={{ occasionId: id, taskId: l.taskId }}
                    fields={[{ name: "label", label: t("packing.newItem"), required: true, maxLength: 160 }]}
                    submitLabel={t("packing.addItem")}
                    pendingLabel={tc("status.saving")}
                    variant="secondary"
                  />
                  <div className={styles.rowActions}>
                    <Link href={`/occasions/${id}/tasks/${l.taskId}`} className="ed-small">
                      {t("packing.openTask")}
                    </Link>
                    <DangerSheet
                      action={deletePackingListAction}
                      hidden={{ occasionId: id, taskId: l.taskId }}
                      label={t("packing.delete")}
                      title={t("packing.deleteTitle")}
                      body={t("packing.deleteBody", { name: l.title })}
                      confirmLabel={t("packing.deleteConfirm")}
                      keepLabel={tc("actions.keep")}
                      pendingLabel={tc("status.deleting")}
                      closeLabel={tc("actions.close")}
                    />
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
