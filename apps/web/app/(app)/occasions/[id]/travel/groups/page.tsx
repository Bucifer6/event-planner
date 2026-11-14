import { instantToLocal } from "@ed/core/itinerary";
import { getOccasionView } from "@ed/core/occasions";
import { allTimeZones, canPlanTrip, listActivities, listPeopleUnchecked, listSubgroups, TRIP_CURRENCIES } from "@ed/core/subgroups";
import { formatInZone, formatMoney } from "@ed/i18n/format";
import { EmptyState, Meter, PageHeader, Section, Tag, Unknown } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createActivityAction, createSubgroupAction, deleteActivityAction, deleteSubgroupAction, optInAction, setSubgroupPeopleAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, QuickAction, SheetForm } from "../_components/forms";
import { Tabs, travelTabs, ZONE_LIST_ID, ZoneList } from "../_components/Tabs";
import styles from "../_components/travel.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("groups.title") };
}

/** D-02: subgroups (private to their people, D2) and optional activities with atomic opt-in. */
export default async function GroupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const { occasion, member } = await orNotFound(getOccasionView(ctx, id));
  const [groups, activities] = await Promise.all([listSubgroups(ctx, id), listActivities(ctx, id)]);
  const planner = canPlanTrip(member) && occasion.status !== "closed";
  const open = occasion.status !== "closed";
  // the guest list is read only for trip planners (listPeople would refuse anyone else)
  const people = planner ? await listPeopleUnchecked(ctx, id) : [];
  const members = people.filter((p) => p.kind === "member");
  const personOptions = people
    .filter((p) => p.kind !== "guest")
    .map((p) => ({ value: p.key, label: p.label, group: p.kind === "member" ? t("people.team") : t("people.households"), hint: p.kind === "household" && p.size > 1 ? t("people.size", { count: p.size }) : undefined }));
  const formBase = { optionalLabel: tc("optional"), pendingLabel: tc("status.saving"), zoneListId: ZONE_LIST_ID };

  const addGroup = (variant: "primary" | "secondary") => (
    <SheetForm
      label={t("groups.add")}
      title={t("groups.addTitle")}
      closeLabel={tc("actions.close")}
      variant={variant}
      icon={<IconPlus />}
      form={{
        ...formBase,
        id: "group-new",
        action: createSubgroupAction,
        hidden: { occasionId: id },
        submitLabel: t("groups.addSubmit"),
        fields: [
          { name: "name", label: t("groups.name"), required: true, maxLength: 80, placeholder: t("groups.nameExample") },
          { name: "leadMemberId", label: t("groups.lead"), type: "select", hint: t("groups.leadHint"), options: [{ value: "", label: t("groups.noLead") }, ...members.map((m) => ({ value: m.key.slice(2), label: m.label }))] },
          { name: "leadEmail", label: t("groups.leadEmail"), hint: t("groups.leadEmailHint"), maxLength: 200 },
        ],
      }}
    />
  );
  const addActivity = (
    <SheetForm
      label={t("activities.add")}
      title={t("activities.addTitle")}
      closeLabel={tc("actions.close")}
      variant={groups.length === 0 && activities.length === 0 ? "secondary" : "primary"}
      icon={<IconPlus />}
      form={{
        ...formBase,
        id: "activity-new",
        action: createActivityAction,
        hidden: { occasionId: id },
        submitLabel: t("activities.addSubmit"),
        fields: [
          { name: "title", label: t("activities.name"), required: true, maxLength: 160, placeholder: t("activities.nameExample") },
          { name: "startsLocal", label: t("activities.starts"), type: "datetime", defaultValue: occasion.startsAt ? instantToLocal(occasion.startsAt, occasion.timezone) : "" },
          { name: "endsLocal", label: t("activities.ends"), type: "datetime" },
          { name: "tz", label: t("activities.zone"), type: "zone", defaultValue: occasion.timezone, hint: t("leg.zoneHint") },
          { name: "place", label: t("activities.place"), maxLength: 200 },
          { name: "cost", label: t("activities.cost"), type: "decimal", hint: t("activities.costHint"), maxLength: 12 },
          { name: "currency", label: t("activities.currency"), type: "select", defaultValue: "RON", options: TRIP_CURRENCIES.map((c) => ({ value: c, label: c })) },
          { name: "capacity", label: t("activities.capacity"), type: "number", hint: t("activities.capacityHint"), maxLength: 6 },
          ...(groups.length > 0 ? [{ name: "subgroupId", label: t("leg.subgroup"), type: "select" as const, hint: t("activities.subgroupHint"), options: [{ value: "", label: t("leg.everyone") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] }] : []),
        ],
      }}
    />
  );

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("groups.title")} description={t("groups.description")} />
      <Tabs items={travelTabs(id, t)} current="groups" label={t("tabs.label")} />
      <ZoneList zones={allTimeZones()} />

      <Section title={t("groups.heading")} actions={planner && groups.length > 0 ? addGroup("secondary") : undefined}>
        {groups.length === 0 ? (
          <EmptyState title={planner ? t("groups.emptyTitle") : t("groups.emptyTitleMember")} action={planner ? addGroup("primary") : undefined}>
            {planner ? t("groups.emptyBody") : t("groups.emptyBodyMember")}
          </EmptyState>
        ) : (
          <ul className={styles.cards}>
            {groups.map((g) => (
              <li key={g.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h4 className={styles.cardTitle}>{g.name}</h4>
                  {g.isMine ? <Tag tone="accent">{t("groups.mine")}</Tag> : null}
                </div>
                <div className={styles.meta}>
                  <span>{g.leadName ? t("groups.ledBy", { name: g.leadName }) : g.leadEmail ? t("groups.ledBy", { name: g.leadEmail }) : t("groups.noLeadYet")}</span>
                  <span>{t("groups.count", { count: g.people.reduce((n, p) => n + p.size, 0) })}</span>
                </div>
                {g.people.length > 0 ? (
                  <ul className={styles.people}>
                    {g.people.map((p) => (
                      <li key={p.key}>
                        <span>{p.label}</span>
                        {p.size > 1 ? <span className="ed-small ed-muted">{t("people.size", { count: p.size })}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ed-small ed-muted">{t("groups.nobody")}</p>
                )}
                {g.canManage && planner ? (
                  <div className={styles.rowActions}>
                    <SheetForm
                      label={t("groups.pick")}
                      title={t("groups.pickTitle", { name: g.name })}
                      closeLabel={tc("actions.close")}
                      form={{
                        ...formBase,
                        id: `group-people-${g.id}`,
                        action: setSubgroupPeopleAction,
                        hidden: { occasionId: id, subgroupId: g.id },
                        submitLabel: t("groups.pickSubmit"),
                        fields: [{ name: "personKeys", label: t("groups.pickLabel"), type: "checks", options: personOptions, defaultChecked: g.people.map((p) => p.key) }],
                      }}
                    />
                    <DangerSheet
                      action={deleteSubgroupAction}
                      hidden={{ occasionId: id, subgroupId: g.id }}
                      label={tc("actions.delete")}
                      title={t("groups.deleteTitle")}
                      body={t("groups.deleteBody", { name: g.name })}
                      confirmLabel={t("groups.deleteConfirm")}
                      keepLabel={tc("actions.keep")}
                      pendingLabel={tc("status.deleting")}
                      closeLabel={tc("actions.close")}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("activities.heading")} actions={planner && activities.length > 0 ? addActivity : undefined}>
        {activities.length === 0 ? (
          <EmptyState title={t("activities.emptyTitle")} action={planner ? addActivity : undefined}>
            {planner ? t("activities.emptyBody") : t("activities.emptyBodyMember")}
          </EmptyState>
        ) : (
          <ul className={styles.cards}>
            {activities.map((a) => (
              <li key={a.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h4 className={styles.cardTitle}>{a.title}</h4>
                  <span className={styles.meta}>
                    {a.subgroupName ? <Tag tone="accent">{a.subgroupName}</Tag> : null}
                    {a.mine ? <Tag tone="success">{t("activities.joined")}</Tag> : null}
                  </span>
                </div>
                <div className={styles.meta}>
                  {a.startsAt ? (
                    <span>
                      {formatInZone(a.startsAt, a.tz, ctx.locale)} <span className={styles.zone}>{a.tz}</span>
                    </span>
                  ) : (
                    <span>{t("activities.noTime")}</span>
                  )}
                  {a.place ? <span>{a.place}</span> : null}
                  <span>
                    {t("activities.costLabel")} {a.costMinor === null ? <Unknown label={tc("unknown")} /> : formatMoney(a.costMinor, a.currency, ctx.locale)}
                  </span>
                </div>
                {a.capacity !== null ? <Meter value={a.taken} max={a.capacity} tone={a.left === 0 ? "danger" : undefined} label={a.left === 0 ? t("activities.full", { total: a.capacity }) : t("activities.left", { left: a.left ?? 0, total: a.capacity })} /> : <p className="ed-small ed-muted">{t("activities.noLimit", { taken: a.taken })}</p>}
                {a.people.length > 0 ? <p className="ed-small ed-muted">{a.people.map((p) => p.label).join(", ")}</p> : null}
                {open ? (
                  <div className={styles.rowActions}>
                    {a.mine ? (
                      <QuickAction action={optInAction} hidden={{ occasionId: id, activityId: a.id, join: "0" }} label={t("activities.leave")} pendingLabel={tc("status.saving")} />
                    ) : member.viaBusiness ? null : (
                      <QuickAction action={optInAction} hidden={{ occasionId: id, activityId: a.id, join: "1" }} label={t("activities.join")} pendingLabel={tc("status.saving")} variant={a.left === 0 ? "secondary" : "secondary"} />
                    )}
                    {a.canManage ? (
                      <DangerSheet
                        action={deleteActivityAction}
                        hidden={{ occasionId: id, activityId: a.id }}
                        label={tc("actions.delete")}
                        title={t("activities.deleteTitle")}
                        body={t("activities.deleteBody", { name: a.title })}
                        confirmLabel={t("activities.deleteConfirm")}
                        keepLabel={tc("actions.keep")}
                        pendingLabel={tc("status.deleting")}
                        closeLabel={tc("actions.close")}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
