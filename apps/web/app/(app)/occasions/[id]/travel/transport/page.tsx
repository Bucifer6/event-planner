import { getOccasionView } from "@ed/core/occasions";
import { allTimeZones, canPlanTrip, listPeopleUnchecked } from "@ed/core/subgroups";
import { listTransport } from "@ed/core/transport";
import { formatInZone } from "@ed/i18n/format";
import { EmptyState, Meter, PageHeader, Tag, Unknown } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { claimSeatAction, createTransportAction, deleteTransportAction, setTransportPeopleAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, QuickAction, SheetForm } from "../_components/forms";
import { Tabs, travelTabs, ZONE_LIST_ID, ZoneList } from "../_components/Tabs";
import styles from "../_components/travel.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("transport.title") };
}

/** D-04: vehicles and transfers. Seats are claimed atomically; the tap path is "pick the vehicle → tick people". */
export default async function TransportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const { occasion, member } = await orNotFound(getOccasionView(ctx, id));
  const vehicles = await listTransport(ctx, id);
  const open = occasion.status !== "closed";
  const planner = canPlanTrip(member) && open;
  const people = planner ? (await listPeopleUnchecked(ctx, id)).filter((p) => p.kind !== "guest") : [];
  const options = people.map((p) => ({ value: p.key, label: p.label, group: p.kind === "member" ? t("people.team") : t("people.households"), hint: p.size > 1 ? t("people.size", { count: p.size }) : undefined }));

  const add = (variant: "primary" | "secondary") => (
    <SheetForm
      label={t("transport.add")}
      title={t("transport.addTitle")}
      closeLabel={tc("actions.close")}
      variant={variant}
      icon={<IconPlus />}
      form={{
        id: "vehicle-new",
        action: createTransportAction,
        hidden: { occasionId: id },
        optionalLabel: tc("optional"),
        pendingLabel: tc("status.saving"),
        zoneListId: ZONE_LIST_ID,
        submitLabel: t("transport.addSubmit"),
        fields: [
          { name: "label", label: t("transport.label"), required: true, maxLength: 120, placeholder: t("transport.labelExample") },
          { name: "seats", label: t("transport.seats"), type: "number", hint: t("transport.seatsHint"), maxLength: 4 },
          { name: "departsLocal", label: t("transport.departs"), type: "datetime" },
          { name: "arrivesLocal", label: t("transport.arrives"), type: "datetime" },
          { name: "tz", label: t("transport.zone"), type: "zone", defaultValue: occasion.timezone, hint: t("leg.zoneHint") },
          { name: "placeFrom", label: t("leg.from"), maxLength: 160 },
          { name: "placeTo", label: t("leg.to"), maxLength: 160 },
          { name: "notes", label: t("leg.notes"), type: "textarea", maxLength: 1000 },
        ],
      }}
    />
  );

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("transport.title")} description={t("transport.description")} actions={planner && vehicles.length > 0 ? add("primary") : undefined} />
      <Tabs items={travelTabs(id, t)} current="transport" label={t("tabs.label")} />
      <ZoneList zones={allTimeZones()} />
      {vehicles.length === 0 ? (
        <EmptyState title={t("transport.emptyTitle")} action={planner ? add("primary") : undefined}>
          {planner ? t("transport.emptyBody") : t("transport.emptyBodyMember")}
        </EmptyState>
      ) : (
        <ul className={styles.cards}>
          {vehicles.map((v) => (
            <li key={v.id} className={styles.card}>
              <div className={styles.cardHead}>
                <h3 className={styles.cardTitle}>{v.label}</h3>
                {v.mine ? <Tag tone="success">{t("transport.mine")}</Tag> : null}
              </div>
              <div className={styles.meta}>
                {v.departsAt ? (
                  <span>
                    {t("transport.departsAt", { time: formatInZone(v.departsAt, v.tz, ctx.locale) })} <span className={styles.zone}>{v.tz}</span>
                  </span>
                ) : (
                  <span>{t("transport.noTime")}</span>
                )}
                {v.placeFrom || v.placeTo ? <span>{[v.placeFrom, v.placeTo].filter(Boolean).join(" → ")}</span> : null}
              </div>
              {v.seats !== null ? (
                <Meter value={v.taken} max={v.seats} tone={v.left === 0 ? "danger" : undefined} label={v.left === 0 ? t("transport.full", { total: v.seats }) : t("transport.left", { left: v.left ?? 0, total: v.seats })} />
              ) : (
                <p className="ed-small">
                  {t("transport.seatsLabel")} <Unknown label={tc("unknown")} /> · {t("transport.takenOnly", { taken: v.taken })}
                </p>
              )}
              {v.people.length > 0 ? (
                <ul className={styles.people}>
                  {v.people.map((p) => (
                    <li key={p.key}>
                      <span>{p.label}</span>
                      {p.seats > 1 ? <span className="ed-small ed-muted">{t("transport.seatsOf", { count: p.seats })}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {v.notes ? <p className="ed-small ed-muted">{v.notes}</p> : null}
              {open ? (
                <div className={styles.rowActions}>
                  {v.canManage ? (
                    <SheetForm
                      label={t("transport.pick")}
                      title={t("transport.pickTitle", { name: v.label })}
                      closeLabel={tc("actions.close")}
                      intro={v.seats !== null ? t("transport.pickIntro", { total: v.seats }) : undefined}
                      form={{
                        id: `vehicle-people-${v.id}`,
                        action: setTransportPeopleAction,
                        hidden: { occasionId: id, transportLegId: v.id },
                        pendingLabel: tc("status.saving"),
                        submitLabel: t("transport.pickSubmit"),
                        fields: [{ name: "personKeys", label: t("transport.pickLabel"), type: "checks", options, defaultChecked: v.people.map((p) => p.key) }],
                      }}
                    />
                  ) : !v.mine && !member.viaBusiness ? (
                    <QuickAction action={claimSeatAction} hidden={{ occasionId: id, transportLegId: v.id }} label={t("transport.claim")} pendingLabel={tc("status.saving")} />
                  ) : null}
                  {v.canManage ? (
                    <DangerSheet
                      action={deleteTransportAction}
                      hidden={{ occasionId: id, transportLegId: v.id }}
                      label={tc("actions.delete")}
                      title={t("transport.deleteTitle")}
                      body={t("transport.deleteBody", { name: v.label })}
                      confirmLabel={t("transport.deleteConfirm")}
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
    </div>
  );
}
