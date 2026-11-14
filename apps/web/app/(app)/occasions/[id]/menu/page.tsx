import { DIET_TAGS, getMenuQuantities, getMenus, MENU_AUDIENCES, MENU_COURSES, type MenuItemView, type MenuView } from "@ed/core/menus";
import { listSuppliers } from "@ed/core/suppliers";
import { EmptyState, Figure, Notice, PageHeader, Section, SheetTrigger, Table, Tag } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  pushMenuToOrderAction,
  removeDrinkRuleAction,
  removeMenuAction,
  removeMenuItemAction,
  saveDrinkRuleAction,
  saveMenuAction,
  saveMenuItemAction,
  saveMenuSettingsAction,
} from "@/app/actions/menus";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { FormSheet, type FieldSpec } from "../guests/_components/form";
import styles from "../programme/_components/programme.module.css";
import { ResultForm } from "../programme/_components/ResultForm";

// Menus, meal choices and quantities (C-05). Guests choose on their link; this page shows the
// menu as the team edits it, the portions to prepare (counts only — no household is named),
// the drink ESTIMATE from editable rules, and sends the quantities into a booking's final order.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("menus"))("title") };
}

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("menus");
  const tc = await getTranslations("common");
  const view = await orNotFound(getMenus(ctx, id));
  const [q, suppliers] = await Promise.all([getMenuQuantities(ctx, id), view.canManage ? listSuppliers(ctx, id).catch(() => null) : null]);
  const { canManage } = view;

  const menuFields = (m?: MenuView): FieldSpec[] => [
    { name: "name", label: t("menu.name"), hint: t("menu.nameHint"), required: true, defaultValue: m?.name ?? "", maxLength: 120 },
    ...(view.stages.length > 0
      ? [{ name: "mealStageId", label: t("menu.stage"), hint: t("menu.stageHint"), type: "select" as const, defaultValue: m?.mealStageId ?? "", options: [{ value: "", label: t("menu.stageNone") }, ...view.stages.map((s) => ({ value: s.id, label: s.name }))] }]
      : []),
  ];
  const itemFields = (i?: MenuItemView): FieldSpec[] => [
    { name: "course", label: t("item.course"), type: "select", defaultValue: i?.course ?? "main", options: MENU_COURSES.map((c) => ({ value: c, label: t(`courses.${c}`) })) },
    { name: "name", label: t("item.name"), hint: t("item.nameHint"), required: true, defaultValue: i?.name ?? "", maxLength: 160 },
    { name: "description", label: t("item.description"), hint: t("item.descriptionHint"), type: "textarea", rows: 2, defaultValue: i?.description ?? "", maxLength: 500 },
    { name: "audience", label: t("item.audience"), type: "select", defaultValue: i?.audience ?? "adults", options: MENU_AUDIENCES.map((a) => ({ value: a, label: t(`audience.${a}`) })) },
    { name: "isChoice", label: t("item.isChoice"), hint: t("item.isChoiceHint"), type: "checkbox", defaultValue: i?.isChoice ? "on" : "" },
    ...DIET_TAGS.map((d): FieldSpec => ({ name: `diet_${d}`, label: t(`diet.${d}`), type: "checkbox", defaultValue: i?.dietTags.includes(d) ? "on" : "" })),
  ];
  const ruleFields = (r?: (typeof view.settings.drinkRules)[number]): FieldSpec[] => [
    { name: "label", label: t("drinks.label"), hint: t("drinks.labelHint"), required: true, defaultValue: r?.label ?? "", maxLength: 80 },
    { name: "unit", label: t("drinks.unit"), hint: t("drinks.unitHint"), required: true, defaultValue: r?.unit ?? "", maxLength: 30 },
    { name: "perGuests", label: t("drinks.perGuests"), hint: t("drinks.perGuestsHint"), type: "number", required: true, defaultValue: r?.perGuests.toString() ?? "3", maxLength: 4 },
    { name: "perHours", label: t("drinks.perHours"), hint: t("drinks.perHoursHint"), type: "number", required: true, defaultValue: r?.perHours.toString() ?? "3", maxLength: 2 },
    { name: "adultsOnly", label: t("drinks.adultsOnly"), type: "checkbox", defaultValue: r?.adultsOnly ? "on" : "" },
  ];
  const common = { optionalLabel: tc("optional"), pendingLabel: tc("status.saving") };

  const addMenu = canManage ? (
    <FormSheet
      label={t("menu.add")}
      title={t("menu.addTitle")}
      closeLabel={tc("actions.close")}
      variant={view.menus.length === 0 ? "primary" : "secondary"}
      icon={<IconPlus size={16} />}
      form={{ id: "add-menu", action: saveMenuAction, hidden: { occasionId: id }, fields: menuFields(), submitLabel: t("menu.addSubmit"), ...common }}
    />
  ) : null;

  const bookings = (suppliers?.items ?? []).map((s) => ({ value: s.booking.id, label: s.categoryLabel ? `${s.name} — ${s.categoryLabel}` : s.name }));
  const hasQuantities = q.lines.some((l) => l.base > 0) || q.drinks.some((d) => d.quantity > 0);

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} actions={view.menus.length > 0 ? addMenu : null} />

      {view.menus.length === 0 ? (
        <Section>
          <EmptyState title={t("empty.title")} action={addMenu}>
            {canManage ? t("empty.body") : t("empty.bodyReadOnly")}
          </EmptyState>
        </Section>
      ) : (
        <>
          {view.menus.map((m) => (
            <Section
              key={m.id}
              title={m.name}
              eyebrow={m.mealStageName ? t("menu.stageTag", { name: m.mealStageName }) : undefined}
              actions={
                canManage ? (
                  <>
                    <FormSheet
                      label={t("item.add")}
                      title={t("item.addTitle", { menu: m.name })}
                      closeLabel={tc("actions.close")}
                      icon={<IconPlus size={16} />}
                      form={{ id: `add-item-${m.id}`, action: saveMenuItemAction, hidden: { occasionId: id, menuId: m.id }, fields: itemFields(), submitLabel: t("item.addSubmit"), ...common }}
                    />
                    <FormSheet
                      label={t("menu.edit")}
                      title={t("menu.edit")}
                      closeLabel={tc("actions.close")}
                      variant="quiet"
                      form={{ id: `edit-menu-${m.id}`, action: saveMenuAction, hidden: { occasionId: id, menuId: m.id }, fields: menuFields(m), submitLabel: tc("actions.save"), ...common }}
                    />
                  </>
                ) : null
              }
            >
              {m.items.length === 0 ? (
                <p className="ed-muted">{t("menu.empty")}</p>
              ) : (
                <div>
                  {MENU_COURSES.filter((c) => m.items.some((i) => i.course === c)).map((course) => (
                    <div key={course}>
                      <h3 className={styles.courseTitle}>{t(`courses.${course}`)}</h3>
                      {m.items
                        .filter((i) => i.course === course)
                        .map((i) => (
                          <div className={styles.item} key={i.id}>
                            <div className={styles.itemHead}>
                              <span className={styles.itemTitle}>{i.name}</span>
                              <span className={styles.inline}>
                                {i.isChoice ? <Tag tone="accent">{t("item.choiceTag")}</Tag> : null}
                                {i.audience === "children" ? <Tag plain>{t("item.childrenTag")}</Tag> : null}
                              </span>
                            </div>
                            {i.description ? <p className="ed-small ed-muted">{i.description}</p> : null}
                            {i.dietTags.length > 0 ? <p className="ed-small">{i.dietTags.map((d) => t(`diet.${d}`)).join(" · ")}</p> : null}
                            {canManage ? (
                              <div className={styles.inline}>
                                <FormSheet
                                  label={tc("actions.edit")}
                                  title={t("item.editTitle")}
                                  closeLabel={tc("actions.close")}
                                  variant="quiet"
                                  form={{ id: `edit-item-${i.id}`, action: saveMenuItemAction, hidden: { occasionId: id, menuId: m.id, itemId: i.id }, fields: itemFields(i), submitLabel: tc("actions.save"), ...common }}
                                />
                                <FormSheet
                                  label={t("item.remove")}
                                  title={t("item.removeTitle", { name: i.name })}
                                  closeLabel={tc("actions.close")}
                                  variant="danger-quiet"
                                  intro={<p>{t("item.removeBody")}</p>}
                                  form={{ id: `rm-item-${i.id}`, action: removeMenuItemAction, hidden: { occasionId: id, itemId: i.id }, variant: "danger", submitLabel: t("item.removeSubmit"), pendingLabel: tc("status.deleting") }}
                                />
                              </div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
              {canManage ? (
                <div>
                  <FormSheet
                    label={t("menu.remove")}
                    title={t("menu.removeTitle", { name: m.name })}
                    closeLabel={tc("actions.close")}
                    variant="danger-quiet"
                    intro={<p>{t("menu.removeBody")}</p>}
                    form={{ id: `rm-menu-${m.id}`, action: removeMenuAction, hidden: { occasionId: id, menuId: m.id }, variant: "danger", submitLabel: t("menu.removeSubmit"), pendingLabel: tc("status.deleting") }}
                  />
                </div>
              ) : null}
            </Section>
          ))}

          <Section
            title={t("quantities.title")}
            actions={
              canManage ? (
                <FormSheet
                  label={t("quantities.settings")}
                  title={t("quantities.settingsTitle")}
                  closeLabel={tc("actions.close")}
                  form={{
                    id: "menu-settings",
                    action: saveMenuSettingsAction,
                    hidden: { occasionId: id },
                    fields: [
                      { name: "safetyMarginPct", label: t("quantities.margin"), hint: t("quantities.marginHint"), type: "number", required: true, defaultValue: String(q.marginPct), maxLength: 2 },
                      { name: "serviceHours", label: t("quantities.hours"), hint: t("quantities.hoursHint"), type: "number", required: true, defaultValue: String(q.serviceHours), maxLength: 2 },
                    ],
                    submitLabel: tc("actions.save"),
                    ...common,
                  }}
                />
              ) : null
            }
          >
            <Figure
              size="hero"
              label={t("quantities.heroLabel")}
              value={q.counts.total}
              note={`${t("quantities.heroNote", { adults: q.counts.adults, children: q.counts.children })}${q.counts.publicAdults + q.counts.publicChildren > 0 ? ` · ${t("quantities.heroPublic", { count: q.counts.publicAdults + q.counts.publicChildren })}` : ""}`}
            />
            <p className="ed-muted">{t("quantities.intro")}</p>
            {q.counts.total === 0 ? (
              <Notice>{t("quantities.none")}</Notice>
            ) : (
              <Table caption={t("quantities.caption")}>
                <thead>
                  <tr>
                    <th scope="col">{t("quantities.dish")}</th>
                    <th scope="col" className={styles.num}>
                      {t("quantities.counted")}
                    </th>
                    <th scope="col" className={styles.num}>
                      {t("quantities.withMargin", { pct: q.marginPct })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.itemId}>
                      <td>
                        <strong>{l.name}</strong>
                        <br />
                        <span className="ed-small ed-muted">
                          {[view.menus.length > 1 ? l.menuName : null, t(`courses.${l.course}`), l.audience === "children" ? t("item.childrenTag") : null, l.isChoice ? t("item.choiceTag") : null].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className={styles.num}>{l.base}</td>
                      <td className={styles.num}>
                        <strong>{l.withMargin}</strong>
                      </td>
                    </tr>
                  ))}
                  {q.groups
                    .filter((g) => g.unchosen > 0)
                    .map((g) => (
                      <tr key={g.key}>
                        <td>
                          <em>{t("quantities.unchosen", { course: t(`courses.${g.course}`), audience: t(`audience.${g.audience}`) })}</em>
                          <br />
                          <span className="ed-small ed-muted">{t("quantities.unchosenNote")}</span>
                        </td>
                        <td className={styles.num}>{g.unchosen}</td>
                        <td className={styles.num}>{g.unchosen}</td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
            <p className="ed-small">
              <a href={`/occasions/${id}/print/menu-quantities-csv`}>{t("quantities.export")}</a>
            </p>
          </Section>

          <Section
            title={t("drinks.title")}
            actions={
              canManage ? (
                <FormSheet
                  label={t("drinks.add")}
                  title={t("drinks.addTitle")}
                  closeLabel={tc("actions.close")}
                  icon={<IconPlus size={16} />}
                  form={{ id: "add-rule", action: saveDrinkRuleAction, hidden: { occasionId: id }, fields: ruleFields(), submitLabel: t("drinks.addSubmit"), ...common }}
                />
              ) : null
            }
          >
            <p className="ed-muted">{t("drinks.intro")}</p>
            {q.drinks.length === 0 ? (
              <p className="ed-muted">{t("drinks.empty")}</p>
            ) : (
              <div>
                {q.drinks.map((d) => {
                  const rule = view.settings.drinkRules.find((r) => r.id === d.ruleId);
                  return (
                    <div className={styles.item} key={d.ruleId}>
                      <div className={styles.itemHead}>
                        <span className={styles.itemTitle}>{d.label}</span>
                        <span className={styles.inline}>
                          <span className="ed-num">
                            <strong>{d.quantity}</strong> {d.unit}
                          </span>
                          <Tag plain>{t("drinks.estimate")}</Tag>
                        </span>
                      </div>
                      <p className="ed-small ed-muted">
                        {t("drinks.rule", { perGuests: d.perGuests, perHours: d.perHours })}
                        {d.adultsOnly ? ` · ${t("drinks.ruleAdults")}` : ""} · {t("drinks.for", { guests: d.guests, hours: q.serviceHours })}
                      </p>
                      {canManage && rule ? (
                        <div className={styles.inline}>
                          <FormSheet
                            label={tc("actions.edit")}
                            title={t("drinks.editTitle")}
                            closeLabel={tc("actions.close")}
                            variant="quiet"
                            form={{ id: `edit-rule-${rule.id}`, action: saveDrinkRuleAction, hidden: { occasionId: id, ruleId: rule.id }, fields: ruleFields(rule), submitLabel: tc("actions.save"), ...common }}
                          />
                          <FormSheet
                            label={t("drinks.remove")}
                            title={t("drinks.removeTitle", { label: rule.label })}
                            closeLabel={tc("actions.close")}
                            variant="danger-quiet"
                            form={{ id: `rm-rule-${rule.id}`, action: removeDrinkRuleAction, hidden: { occasionId: id, ruleId: rule.id }, variant: "danger", submitLabel: t("drinks.removeSubmit"), pendingLabel: tc("status.deleting") }}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {canManage ? (
            <Section title={t("order.title")}>
              <p className={`ed-muted ${styles.narrow}`}>{t("order.intro")}</p>
              {bookings.length === 0 ? (
                <Notice actions={<Link href={`/occasions/${id}/suppliers`}>{t("order.suppliersLink")}</Link>}>{t("order.noSuppliers")}</Notice>
              ) : !hasQuantities ? (
                <Notice>{t("errors.nothingToOrder")}</Notice>
              ) : (
                <div>
                  <SheetTrigger label={t("order.send")} title={t("order.sendTitle")} closeLabel={tc("actions.close")} variant="primary">
                    <ResultForm action={pushMenuToOrderAction} hidden={{ occasionId: id }} submitLabel={t("order.send")} pendingLabel={t("order.sending")} variant="primary" block successTemplate={t.raw("order.sent") as string}>
                      <div className="ed-field">
                        <label className="ed-field__label" htmlFor="order-booking">
                          {t("order.booking")}
                        </label>
                        <select className="ed-select" id="order-booking" name="bookingId" defaultValue={bookings[0]!.value}>
                          {bookings.map((b) => (
                            <option key={b.value} value={b.value}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {q.drinks.length > 0 ? (
                        <label className="ed-check">
                          <input type="checkbox" name="includeDrinks" />
                          <span className="ed-check__text">
                            <span>{t("order.includeDrinks")}</span>
                          </span>
                        </label>
                      ) : null}
                    </ResultForm>
                  </SheetTrigger>
                </div>
              )}
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}
