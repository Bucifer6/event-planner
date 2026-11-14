import { getOccasionView } from "@ed/core/occasions";
import { getRooming } from "@ed/core/rooms";
import { TRIP_CURRENCIES } from "@ed/core/subgroups";
import { formatMoney } from "@ed/i18n/format";
import { toMajor } from "@ed/shared/money";
import { EmptyState, Figure, Meter, Notice, PageHeader, Section, Tag, Unknown } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { assignRoomAction, createRoomAction, deleteRoomAction, unassignRoomAction, updateRoomAction } from "@/app/actions/travel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { DangerSheet, QuickAction, SheetForm, type TFieldSpec } from "../_components/forms";
import { Tabs, travelTabs } from "../_components/Tabs";
import styles from "../_components/travel.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("travel"))("rooms.title") };
}

/**
 * D-04: rooms. Tap path only: pick the room → tick people → "Cazează aici". The beds are taken
 * by one atomic step on the server; a full room answers with how many beds are left.
 */
export default async function RoomsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("travel");
  const tc = await getTranslations("common");
  const { occasion } = await orNotFound(getOccasionView(ctx, id));
  const plan = await getRooming(ctx, id);
  const open = occasion.status !== "closed";
  const planner = plan.canManage && open;
  const roomOf = new Map<string, string>();
  for (const r of plan.rooms) for (const p of r.people) roomOf.set(p.key, r.name);

  const roomFields = (v: { name?: string; capacity?: string; notes?: string; price?: string; currency?: string } = {}): TFieldSpec[] => [
    { name: "name", label: t("rooms.name"), required: true, maxLength: 80, defaultValue: v.name ?? "", placeholder: t("rooms.nameExample") },
    { name: "capacity", label: t("rooms.beds"), type: "number", required: true, maxLength: 3, defaultValue: v.capacity ?? "2" },
    { name: "price", label: t("rooms.price"), type: "decimal", hint: t("rooms.priceHint"), maxLength: 12, defaultValue: v.price ?? "" },
    { name: "currency", label: t("activities.currency"), type: "select", defaultValue: v.currency ?? "RON", options: [...new Set([...TRIP_CURRENCIES, v.currency ?? "RON"])].map((c) => ({ value: c, label: c })) },
    { name: "notes", label: t("leg.notes"), type: "textarea", maxLength: 1000, defaultValue: v.notes ?? "" },
  ];
  const add = (variant: "primary" | "secondary") => (
    <SheetForm
      label={t("rooms.add")}
      title={t("rooms.addTitle")}
      closeLabel={tc("actions.close")}
      variant={variant}
      icon={<IconPlus />}
      form={{ id: "room-new", action: createRoomAction, hidden: { occasionId: id }, optionalLabel: tc("optional"), pendingLabel: tc("status.saving"), submitLabel: t("rooms.addSubmit"), fields: roomFields() }}
    />
  );
  // everyone a planner can place: people without a bed first, then those already placed (ticking them MOVES them)
  const placeable = (roomId: string) => {
    const here = new Set(plan.rooms.find((r) => r.id === roomId)?.people.map((p) => p.key) ?? []);
    const elsewhere = plan.rooms.filter((r) => r.id !== roomId).flatMap((r) => r.people.map((p) => ({ value: p.key, label: p.label, group: t("rooms.pickMove"), hint: t("rooms.nowIn", { room: r.name }) })));
    const free = plan.unplaced.filter((p) => !here.has(p.key)).map((p) => ({ value: p.key, label: p.label, group: p.kind === "member" ? t("people.team") : p.kind === "household" ? t("people.households") : t("people.guests"), hint: p.size > 1 ? t("rooms.bedsNeeded", { count: p.size }) : undefined }));
    return [...free, ...elsewhere];
  };

  return (
    <div className={styles.stack}>
      <PageHeader level={2} eyebrow={t("eyebrow")} title={t("rooms.title")} description={t("rooms.description")} actions={planner && plan.rooms.length > 0 ? add("secondary") : undefined} />
      <Tabs items={travelTabs(id, t)} current="rooms" label={t("tabs.label")} />
      {plan.rooms.length === 0 ? (
        <EmptyState title={t("rooms.emptyTitle")} action={planner ? add("primary") : undefined}>
          {planner ? t("rooms.emptyBody") : t("rooms.emptyBodyMember")}
        </EmptyState>
      ) : (
        <>
          <Figure size="hero" label={t("rooms.heroLabel")} value={plan.beds.taken} unit={t("rooms.heroUnit", { total: plan.beds.total })} note={plan.canManage ? (plan.unplaced.filter((p) => p.kind !== "guest").length === 0 ? t("rooms.everyonePlaced") : t("rooms.unplacedNote", { count: plan.unplaced.filter((p) => p.kind !== "guest").reduce((n, p) => n + p.size, 0) })) : undefined} />
          <ul className={styles.cards}>
            {plan.rooms.map((r) => {
              const options = planner ? placeable(r.id) : [];
              return (
                <li key={r.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>{r.name}</h3>
                    {r.mine ? <Tag tone="success">{t("rooms.mine")}</Tag> : r.left === 0 ? <Tag>{t("rooms.fullTag")}</Tag> : null}
                  </div>
                  <Meter value={r.occupants} max={r.capacity} label={r.left === 0 ? t("rooms.full", { total: r.capacity }) : t("rooms.left", { left: r.left, total: r.capacity })} />
                  {r.priceMinor !== undefined ? (
                    <p className="ed-small">
                      {t("rooms.priceLabel")} {r.priceMinor === null ? <Unknown label={tc("unknown")} /> : <span className={styles.amount}>{formatMoney(r.priceMinor, r.currency, ctx.locale)}</span>}
                    </p>
                  ) : null}
                  {r.people.length > 0 ? (
                    <ul className={styles.people}>
                      {r.people.map((p) => (
                        <li key={p.key}>
                          <span>
                            {p.label}
                            {p.places > 1 ? <span className="ed-small ed-muted"> · {t("rooms.bedsNeeded", { count: p.places })}</span> : null}
                          </span>
                          {planner ? <QuickAction action={unassignRoomAction} hidden={{ occasionId: id, roomId: r.id, personKey: p.key }} label={t("rooms.remove")} pendingLabel={tc("status.saving")} variant="quiet" /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : plan.canManage ? (
                    <p className="ed-small ed-muted">{t("rooms.nobody")}</p>
                  ) : null}
                  {r.notes ? <p className="ed-small ed-muted">{r.notes}</p> : null}
                  {planner ? (
                    <div className={styles.rowActions}>
                      {options.length > 0 ? (
                        <SheetForm
                          label={t("rooms.assign")}
                          title={t("rooms.assignTitle", { name: r.name })}
                          closeLabel={tc("actions.close")}
                          variant={r.left > 0 ? "secondary" : "quiet"}
                          intro={t("rooms.assignIntro", { left: r.left })}
                          form={{
                            id: `room-assign-${r.id}`,
                            action: assignRoomAction,
                            hidden: { occasionId: id, roomId: r.id },
                            pendingLabel: t("rooms.assigning"),
                            submitLabel: t("rooms.assignSubmit"),
                            fields: [{ name: "personKeys", label: t("rooms.pickLabel"), type: "checks", options }],
                          }}
                        />
                      ) : null}
                      <SheetForm
                        label={tc("actions.edit")}
                        title={t("rooms.editTitle", { name: r.name })}
                        closeLabel={tc("actions.close")}
                        variant="quiet"
                        form={{
                          id: `room-edit-${r.id}`,
                          action: updateRoomAction,
                          hidden: { occasionId: id, roomId: r.id },
                          optionalLabel: tc("optional"),
                          pendingLabel: tc("status.saving"),
                          submitLabel: tc("actions.save"),
                          fields: roomFields({ name: r.name, capacity: String(r.capacity), notes: r.notes ?? "", price: r.priceMinor == null ? "" : String(toMajor(r.priceMinor, r.currency)).replace(".", ","), currency: r.currency }),
                        }}
                      />
                      <DangerSheet
                        action={deleteRoomAction}
                        hidden={{ occasionId: id, roomId: r.id }}
                        label={tc("actions.delete")}
                        title={t("rooms.deleteTitle")}
                        body={t("rooms.deleteBody", { name: r.name })}
                        confirmLabel={t("rooms.deleteConfirm")}
                        keepLabel={tc("actions.keep")}
                        pendingLabel={tc("status.deleting")}
                        closeLabel={tc("actions.close")}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {plan.canManage && plan.unplaced.some((p) => p.kind !== "guest") ? (
            <Section title={t("rooms.unplacedTitle")} level={3}>
              <ul className={styles.people}>
                {plan.unplaced
                  .filter((p) => p.kind !== "guest")
                  .map((p) => (
                    <li key={p.key}>
                      <span>{p.label}</span>
                      <span className="ed-small ed-muted">{t("rooms.bedsNeeded", { count: p.size })}</span>
                    </li>
                  ))}
              </ul>
            </Section>
          ) : null}
          {!plan.canManage ? <Notice>{t("rooms.memberNote")}</Notice> : null}
        </>
      )}
    </div>
  );
}
