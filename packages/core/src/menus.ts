import {
  and,
  asc,
  DIET_TAGS,
  eq,
  inArray,
  mealChoices,
  mealStages,
  MENU_AUDIENCES,
  MENU_COURSES,
  menuItems,
  menus,
  menuSettings,
  occasionGuestSettings,
  occasions,
  publicRegistrations,
  rsvpResponses,
  sql,
  type DietTag,
  type DrinkRule,
  type MenuAudience,
  type MenuCourse,
  type OrderItem,
} from "@ed/db";
import { translate } from "@ed/i18n/load";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { registerGuestSection, requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { createOrderSnapshot, ORDER_MAX_ITEMS } from "./orders";
import { inTx } from "./tx";

// Menus, meal choices, food and drink quantities (C-05).
//
// - A menu has items by course. An item flagged `isChoice` is one OPTION of a choice group:
//   the options of the same menu, course and audience (adults / children). Everything else is
//   served to everyone of its audience.
// - A household states its choices on its guest link as COUNTS per option for its party —
//   "Pește × 2, Vegetarian × 1"; children's options are counted the same way and nothing else
//   is ever said about a child (invariant 9). Choices can change until the RSVP deadline.
// - Quantities are aggregated from households that answered YES (plus confirmed public
//   registrations for what is served to everyone). The safety margin is a visible percentage
//   the planner sets. Drink quantities are ESTIMATES from rules the planner edits — shown as
//   estimates, never ordered by themselves.
// - "Trimite în comanda finală" fixes a new version of a booking's final order through
//   createOrderSnapshot (B5): later RSVP changes surface there as deltas.

export { DIET_TAGS, MENU_AUDIENCES, MENU_COURSES };
export type { DietTag, DrinkRule, MenuAudience, MenuCourse };
export type Menu = typeof menus.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;

const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;
export const MENU_MAX_MENUS = 12;
export const MENU_MAX_ITEMS = 80;
export const MENU_MAX_DRINK_RULES = 20;

const idSchema = z.string().min(1).max(64);
const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), idSchema.optional()).optional();
const optionalText = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const formBool = z.preprocess((v) => (v === "on" || v === "true" || v === "1" ? true : v === "" || v === "false" || v === "0" || v == null ? false : v), z.boolean()).default(false);
const formInt = (min: number, max: number, key = "common.validation.invalid") =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number(key).int(key).min(min, key).max(max, key));

async function readAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  return requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
}

async function writeAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  const member = await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, occasionId);
  return member;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export type MenuItemView = {
  id: string;
  course: MenuCourse;
  name: string;
  description: string | null;
  dietTags: DietTag[];
  isChoice: boolean;
  audience: MenuAudience;
};
export type MenuView = { id: string; name: string; mealStageId: string | null; mealStageName: string | null; items: MenuItemView[] };
export type MenuSettingsView = { safetyMarginPct: number; serviceHours: number; drinkRules: DrinkRule[] };
export type MenusView = { menus: MenuView[]; settings: MenuSettingsView; stages: Array<{ id: string; name: string }>; canManage: boolean };

const courseRank = (c: MenuCourse) => MENU_COURSES.indexOf(c);

async function readMenus(ctx: Pick<Ctx, "db">, occasionId: string): Promise<MenuView[]> {
  const [menuRows, itemRows, stageRows] = await Promise.all([
    ctx.db.select().from(menus).where(eq(menus.occasionId, occasionId)).orderBy(asc(menus.position), asc(menus.createdAt), asc(menus.id)),
    ctx.db.select().from(menuItems).where(eq(menuItems.occasionId, occasionId)).orderBy(asc(menuItems.position), asc(menuItems.createdAt), asc(menuItems.id)),
    ctx.db.select({ id: mealStages.id, name: mealStages.name }).from(mealStages).where(eq(mealStages.occasionId, occasionId)),
  ]);
  return menuRows.map((m) => ({
    id: m.id,
    name: m.name,
    mealStageId: m.mealStageId,
    mealStageName: stageRows.find((s) => s.id === m.mealStageId)?.name ?? null,
    items: itemRows
      .filter((i) => i.menuId === m.id)
      .sort((a, b) => courseRank(a.course) - courseRank(b.course) || (a.audience === b.audience ? 0 : a.audience === "adults" ? -1 : 1))
      .map((i) => ({ id: i.id, course: i.course, name: i.name, description: i.description, dietTags: i.dietTags, isChoice: i.isChoice, audience: i.audience })),
  }));
}

async function readSettings(ctx: Pick<Ctx, "db">, occasionId: string): Promise<MenuSettingsView> {
  const [s] = await ctx.db.select().from(menuSettings).where(eq(menuSettings.occasionId, occasionId));
  return { safetyMarginPct: s?.safetyMarginPct ?? 5, serviceHours: s?.serviceHours ?? 6, drinkRules: s?.drinkRules ?? [] };
}

/** Menus with their items, the quantity settings and the meal stages a menu can be linked to. */
export async function getMenus(ctx: Ctx, occasionId: string): Promise<MenusView> {
  const member = await readAccess(ctx, occasionId);
  const [list, settings, stages] = await Promise.all([
    readMenus(ctx, occasionId),
    readSettings(ctx, occasionId),
    ctx.db.select({ id: mealStages.id, name: mealStages.name }).from(mealStages).where(eq(mealStages.occasionId, occasionId)).orderBy(asc(mealStages.position)),
  ]);
  return { menus: list, settings, stages, canManage: member.role === "owner" || member.role === "pm" };
}

/** INTERNAL (no access check): the menus as any guest may read them — for the public page. */
export async function readPublicMenus(ctx: Pick<Ctx, "db">, occasionId: string): Promise<MenuView[]> {
  return (await readMenus(ctx, occasionId)).filter((m) => m.items.length > 0);
}

/* ── Planner writes ──────────────────────────────────────────────────────── */

const menuInput = z.object({
  occasionId: idSchema,
  menuId: optionalId,
  name: z.string().trim().min(1, "common.validation.required").max(120, "common.validation.tooLong"),
  mealStageId: optionalId,
});

export async function saveMenu(ctx: Ctx, input: z.input<typeof menuInput>): Promise<{ menuId: string }> {
  const data = menuInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  if (data.mealStageId) {
    const [stage] = await ctx.db.select({ id: mealStages.id }).from(mealStages).where(and(eq(mealStages.id, data.mealStageId), eq(mealStages.occasionId, data.occasionId)));
    if (!stage) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { mealStageId: ["common.validation.invalid"] } });
  }
  return inTx(ctx, async (tx) => {
    if (data.menuId) {
      const rows = await tx.db
        .update(menus)
        .set({ name: data.name, mealStageId: data.mealStageId ?? null })
        .where(and(eq(menus.id, data.menuId), eq(menus.occasionId, data.occasionId)))
        .returning({ id: menus.id });
      if (!rows[0]) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      await audit(tx, { action: "menu.updated", objectType: "menu", objectId: data.menuId, after: { name: data.name }, meta: { occasionId: data.occasionId } });
      return { menuId: data.menuId };
    }
    const [count] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(menus).where(eq(menus.occasionId, data.occasionId));
    if ((count?.n ?? 0) >= MENU_MAX_MENUS) throw new AppError("LIMIT", "menus.errors.tooManyMenus");
    const [row] = await tx.db
      .insert(menus)
      .values({ occasionId: data.occasionId, name: data.name, mealStageId: data.mealStageId ?? null, position: count?.n ?? 0 })
      .returning({ id: menus.id });
    await audit(tx, { action: "menu.created", objectType: "menu", objectId: row!.id, after: { name: data.name }, meta: { occasionId: data.occasionId } });
    return { menuId: row!.id };
  });
}

async function loadMenu(ctx: Ctx, menuId: string): Promise<Menu> {
  const id = idSchema.safeParse(menuId);
  const [menu] = id.success ? await ctx.db.select().from(menus).where(eq(menus.id, id.data)) : [];
  if (!menu) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return menu;
}

export async function removeMenu(ctx: Ctx, input: { menuId: string }): Promise<void> {
  const menu = await loadMenu(ctx, input.menuId);
  await writeAccess(ctx, menu.occasionId);
  await inTx(ctx, async (tx) => {
    await tx.db.delete(menus).where(eq(menus.id, menu.id)); // items and choices cascade
    await audit(tx, { action: "menu.removed", objectType: "menu", objectId: menu.id, before: { name: menu.name }, meta: { occasionId: menu.occasionId } });
  });
}

const itemInput = z.object({
  menuId: idSchema,
  itemId: optionalId,
  course: z.enum(MENU_COURSES, "common.validation.invalid"),
  name: z.string().trim().min(1, "common.validation.required").max(160, "common.validation.tooLong"),
  description: optionalText(500),
  dietTags: z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(DIET_TAGS)).max(DIET_TAGS.length)).default([]),
  isChoice: formBool.default(false),
  audience: z.enum(MENU_AUDIENCES).default("adults"),
});

export async function saveMenuItem(ctx: Ctx, input: z.input<typeof itemInput>): Promise<{ itemId: string }> {
  const data = itemInput.parse(input);
  const menu = await loadMenu(ctx, data.menuId);
  await writeAccess(ctx, menu.occasionId);
  const values = { course: data.course, name: data.name, description: data.description, dietTags: [...new Set(data.dietTags)], isChoice: data.isChoice, audience: data.audience };
  return inTx(ctx, async (tx) => {
    if (data.itemId) {
      const rows = await tx.db.update(menuItems).set(values).where(and(eq(menuItems.id, data.itemId), eq(menuItems.menuId, menu.id))).returning();
      const row = rows[0];
      if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      // an option that stopped being a choice keeps no counts
      if (!row.isChoice) await tx.db.delete(mealChoices).where(eq(mealChoices.menuItemId, row.id));
      await audit(tx, { action: "menu.item_updated", objectType: "menu_item", objectId: row.id, after: { name: row.name, course: row.course }, meta: { occasionId: menu.occasionId } });
      return { itemId: row.id };
    }
    const [count] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(menuItems).where(eq(menuItems.occasionId, menu.occasionId));
    if ((count?.n ?? 0) >= MENU_MAX_ITEMS) throw new AppError("LIMIT", "menus.errors.tooManyItems");
    const [row] = await tx.db
      .insert(menuItems)
      .values({ menuId: menu.id, occasionId: menu.occasionId, ...values, position: count?.n ?? 0 })
      .returning({ id: menuItems.id });
    await audit(tx, { action: "menu.item_created", objectType: "menu_item", objectId: row!.id, after: { name: data.name, course: data.course }, meta: { occasionId: menu.occasionId } });
    return { itemId: row!.id };
  });
}

export async function removeMenuItem(ctx: Ctx, input: { itemId: string }): Promise<void> {
  const id = idSchema.parse(input.itemId);
  const [item] = await ctx.db.select().from(menuItems).where(eq(menuItems.id, id));
  if (!item) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await writeAccess(ctx, item.occasionId);
  await inTx(ctx, async (tx) => {
    await tx.db.delete(menuItems).where(eq(menuItems.id, item.id));
    await audit(tx, { action: "menu.item_removed", objectType: "menu_item", objectId: item.id, before: { name: item.name }, meta: { occasionId: item.occasionId } });
  });
}

const settingsInput = z.object({
  occasionId: idSchema,
  safetyMarginPct: formInt(0, 50, "menus.errors.margin"),
  serviceHours: formInt(1, 24, "menus.errors.hours"),
});

export async function saveMenuSettings(ctx: Ctx, input: z.input<typeof settingsInput>): Promise<MenuSettingsView> {
  const data = settingsInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    await tx.db
      .insert(menuSettings)
      .values({ occasionId: data.occasionId, safetyMarginPct: data.safetyMarginPct, serviceHours: data.serviceHours })
      .onConflictDoUpdate({ target: menuSettings.occasionId, set: { safetyMarginPct: data.safetyMarginPct, serviceHours: data.serviceHours } });
    await audit(tx, { action: "menu.settings_saved", objectType: "occasion", objectId: data.occasionId, after: { safetyMarginPct: data.safetyMarginPct, serviceHours: data.serviceHours } });
    return readSettings(tx, data.occasionId);
  });
}

const ruleInput = z.object({
  occasionId: idSchema,
  ruleId: optionalId,
  label: z.string().trim().min(1, "common.validation.required").max(80, "common.validation.tooLong"),
  unit: z.string().trim().min(1, "common.validation.required").max(30, "common.validation.tooLong"),
  perGuests: formInt(1, 1000, "menus.errors.perGuests"),
  perHours: formInt(1, 24, "menus.errors.perHours"),
  adultsOnly: formBool.default(false),
});

/** Adds or edits one drink rule: "1 {unit} for every {perGuests} guests, every {perHours} hours". */
export async function saveDrinkRule(ctx: Ctx, input: z.input<typeof ruleInput>): Promise<{ ruleId: string }> {
  const data = ruleInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    await tx.db.insert(menuSettings).values({ occasionId: data.occasionId }).onConflictDoNothing();
    const [row] = await tx.db.select().from(menuSettings).where(eq(menuSettings.occasionId, data.occasionId)).for("update");
    const rules = [...(row?.drinkRules ?? [])];
    const rule: DrinkRule = { id: data.ruleId ?? newId(), label: data.label, unit: data.unit, perGuests: data.perGuests, perHours: data.perHours, adultsOnly: data.adultsOnly };
    const at = rules.findIndex((r) => r.id === rule.id);
    if (data.ruleId && at < 0) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (at >= 0) rules[at] = rule;
    else {
      if (rules.length >= MENU_MAX_DRINK_RULES) throw new AppError("LIMIT", "menus.errors.tooManyRules");
      rules.push(rule);
    }
    await tx.db.update(menuSettings).set({ drinkRules: rules }).where(eq(menuSettings.occasionId, data.occasionId));
    await audit(tx, { action: "menu.drink_rule_saved", objectType: "occasion", objectId: data.occasionId, after: rule });
    return { ruleId: rule.id };
  });
}

export async function removeDrinkRule(ctx: Ctx, input: { occasionId: string; ruleId: string }): Promise<void> {
  const data = z.object({ occasionId: idSchema, ruleId: idSchema }).parse(input);
  await writeAccess(ctx, data.occasionId);
  await inTx(ctx, async (tx) => {
    const [row] = await tx.db.select().from(menuSettings).where(eq(menuSettings.occasionId, data.occasionId)).for("update");
    if (!row) return;
    await tx.db.update(menuSettings).set({ drinkRules: row.drinkRules.filter((r) => r.id !== data.ruleId) }).where(eq(menuSettings.occasionId, data.occasionId));
    await audit(tx, { action: "menu.drink_rule_removed", objectType: "occasion", objectId: data.occasionId, before: { ruleId: data.ruleId } });
  });
}

/* ── Guest side: the menu and the household's choices ────────────────────── */

export type ChoiceGroup = {
  /** "<menuId>:<course>:<audience>" */
  key: string;
  menuId: string;
  menuName: string;
  course: MenuCourse;
  audience: MenuAudience;
  /** How many of the party choose in this group (their adults or their children count). */
  party: number;
  options: Array<{ itemId: string; name: string; description: string | null; dietTags: DietTag[]; count: number }>;
};

export type GuestMenu = {
  menus: MenuView[];
  groups: ChoiceGroup[];
  /** "open" = can choose now; "needsRsvp" = answer yes first; "locked" = past the deadline. */
  state: "open" | "needsRsvp" | "locked" | "none";
  deadline: string | null;
};

function groupKey(menuId: string, course: MenuCourse, audience: MenuAudience): string {
  return `${menuId}:${course}:${audience}`;
}

async function choiceWindow(ctx: Pick<Ctx, "db" | "now">, occasionId: string): Promise<{ open: boolean; deadline: Date | null }> {
  const [row] = await ctx.db
    .select({ status: occasions.status, deadline: occasionGuestSettings.rsvpDeadline })
    .from(occasions)
    .leftJoin(occasionGuestSettings, eq(occasionGuestSettings.occasionId, occasions.id))
    .where(eq(occasions.id, occasionId));
  const deadline = row?.deadline ?? null;
  const open = !!row && row.status !== "cancelled" && row.status !== "closed" && (!deadline || deadline.getTime() > ctx.now.getTime());
  return { open, deadline };
}

/** The menu section of a guest link: what is served and, where the planner asks, this household's choices. */
export async function getGuestMenu(ctx: Ctx): Promise<GuestMenu | null> {
  const actor = requireGuest(ctx);
  const list = (await readMenus(ctx, actor.occasionId)).filter((m) => m.items.length > 0);
  if (list.length === 0) return null;
  const [[response], mine, window] = await Promise.all([
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, actor.householdId)),
    ctx.db.select().from(mealChoices).where(eq(mealChoices.householdId, actor.householdId)),
    choiceWindow(ctx, actor.occasionId),
  ]);
  const attending = response?.attending === "yes";
  const groups: ChoiceGroup[] = [];
  for (const m of list) {
    for (const i of m.items.filter((x) => x.isChoice)) {
      const key = groupKey(m.id, i.course, i.audience);
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, menuId: m.id, menuName: m.name, course: i.course, audience: i.audience, party: attending ? (i.audience === "adults" ? response!.adultsCount : response!.childrenCount) : 0, options: [] };
        groups.push(g);
      }
      g.options.push({ itemId: i.id, name: i.name, description: i.description, dietTags: i.dietTags, count: mine.find((c) => c.menuItemId === i.id)?.count ?? 0 });
    }
  }
  // a single option is no choice; a group nobody of the party belongs to is not asked
  const asked = groups.filter((g) => g.options.length > 1 && (!attending || g.party > 0));
  const state: GuestMenu["state"] = asked.length === 0 ? "none" : !attending ? "needsRsvp" : window.open ? "open" : "locked";
  return { menus: list, groups: asked, state, deadline: window.deadline ? window.deadline.toISOString() : null };
}

const choicesInput = z.object({
  /** itemId → how many of the party take it. */
  choices: z.record(idSchema, formInt(0, 500)),
});

/**
 * The household sets its counts per option (guest link). Only a household that answered YES,
 * only until the RSVP deadline, and never more people per group than the party has.
 * Replaces the household's earlier choices; sending the same counts again changes nothing.
 */
export async function setMealChoices(ctx: Ctx, input: z.input<typeof choicesInput>): Promise<{ saved: number }> {
  const actor = requireGuest(ctx);
  const data = choicesInput.parse(input);
  const window = await choiceWindow(ctx, actor.occasionId);
  if (!window.open) throw new AppError("CONFLICT", "menus.errors.choicesClosed");
  const [response] = await ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, actor.householdId));
  if (!response || response.attending !== "yes") throw new AppError("CONFLICT", "menus.errors.answerFirst");
  const ids = Object.keys(data.choices);
  const options = ids.length
    ? await ctx.db.select().from(menuItems).where(and(eq(menuItems.occasionId, actor.occasionId), eq(menuItems.isChoice, true), inArray(menuItems.id, ids)))
    : [];
  if (options.length !== ids.length) throw new AppError("VALIDATION", "common.validation.invalid");
  const sums = new Map<string, { sum: number; audience: MenuAudience; itemIds: string[] }>();
  for (const o of options) {
    const key = groupKey(o.menuId, o.course, o.audience);
    const g = sums.get(key) ?? { sum: 0, audience: o.audience, itemIds: [] };
    g.sum += data.choices[o.id] ?? 0;
    g.itemIds.push(o.id);
    sums.set(key, g);
  }
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, g] of sums) {
    const party = g.audience === "adults" ? response.adultsCount : response.childrenCount;
    if (g.sum > party) fieldErrors[`group_${key}`] = ["menus.errors.tooManyChoices"];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("VALIDATION", "menus.errors.tooManyChoices", { fieldErrors });
  }
  return inTx(ctx, async (tx) => {
    // serialise the household's own double submits
    await tx.db.execute(sql`select id from households where id = ${actor.householdId} for update`);
    await tx.db.delete(mealChoices).where(eq(mealChoices.householdId, actor.householdId));
    const rows = options.filter((o) => (data.choices[o.id] ?? 0) > 0).map((o) => ({ occasionId: actor.occasionId, householdId: actor.householdId, menuItemId: o.id, count: data.choices[o.id]! }));
    if (rows.length > 0) await tx.db.insert(mealChoices).values(rows);
    return { saved: rows.length };
  });
}

/* ── Quantities ──────────────────────────────────────────────────────────── */

export type QuantityLine = {
  itemId: string;
  menuId: string;
  menuName: string;
  course: MenuCourse;
  name: string;
  audience: MenuAudience;
  isChoice: boolean;
  dietTags: DietTag[];
  /** Counted portions. */
  base: number;
  /** base + the safety margin, rounded up. */
  withMargin: number;
};
export type QuantityGroup = { key: string; menuName: string; course: MenuCourse; audience: MenuAudience; eligible: number; chosen: number; unchosen: number };
export type DrinkEstimate = { ruleId: string; label: string; unit: string; perGuests: number; perHours: number; adultsOnly: boolean; guests: number; quantity: number };
export type MenuQuantities = {
  /** Who eats: households that answered yes + confirmed public registrations. Counts only. */
  counts: { adults: number; children: number; total: number; publicAdults: number; publicChildren: number };
  marginPct: number;
  serviceHours: number;
  lines: QuantityLine[];
  groups: QuantityGroup[];
  /** Estimates — never ordered automatically. */
  drinks: DrinkEstimate[];
};

export function withMargin(base: number, pct: number): number {
  return Math.ceil((base * (100 + pct)) / 100);
}

/** One drink rule applied: ceil(guests / perGuests × hours / perHours). */
export function estimateDrink(rule: DrinkRule, counts: { adults: number; total: number }, hours: number): number {
  const guests = rule.adultsOnly ? counts.adults : counts.total;
  return Math.ceil((guests / rule.perGuests) * (hours / rule.perHours));
}

async function computeQuantities(ctx: Pick<Ctx, "db">, occasionId: string): Promise<MenuQuantities> {
  const [list, settings, [invited], [pub], chosen] = await Promise.all([
    readMenus(ctx, occasionId),
    readSettings(ctx, occasionId),
    ctx.db
      .select({ adults: sql<number>`coalesce(sum(${rsvpResponses.adultsCount}), 0)::int`, children: sql<number>`coalesce(sum(${rsvpResponses.childrenCount}), 0)::int` })
      .from(rsvpResponses)
      .where(and(eq(rsvpResponses.occasionId, occasionId), eq(rsvpResponses.attending, "yes"))),
    ctx.db
      .select({ adults: sql<number>`coalesce(sum(${publicRegistrations.adults}), 0)::int`, children: sql<number>`coalesce(sum(${publicRegistrations.children}), 0)::int` })
      .from(publicRegistrations)
      .where(and(eq(publicRegistrations.occasionId, occasionId), eq(publicRegistrations.status, "registered"))),
    // choices count only while the household's answer is YES
    ctx.db
      .select({ itemId: mealChoices.menuItemId, n: sql<number>`sum(${mealChoices.count})::int` })
      .from(mealChoices)
      .innerJoin(rsvpResponses, and(eq(rsvpResponses.householdId, mealChoices.householdId), eq(rsvpResponses.attending, "yes")))
      .where(eq(mealChoices.occasionId, occasionId))
      .groupBy(mealChoices.menuItemId),
  ]);
  const publicAdults = pub?.adults ?? 0;
  const publicChildren = pub?.children ?? 0;
  const adults = (invited?.adults ?? 0) + publicAdults;
  const children = (invited?.children ?? 0) + publicChildren;
  const eligible = (a: MenuAudience) => (a === "adults" ? adults : children);
  const lines: QuantityLine[] = [];
  const groups: QuantityGroup[] = [];
  for (const m of list) {
    for (const i of m.items) {
      const key = groupKey(m.id, i.course, i.audience);
      const options = m.items.filter((x) => x.isChoice && x.course === i.course && x.audience === i.audience);
      // an "option" without an alternative is simply served to everyone
      const realChoice = i.isChoice && options.length > 1;
      const base = realChoice ? (chosen.find((c) => c.itemId === i.id)?.n ?? 0) : eligible(i.audience);
      lines.push({ itemId: i.id, menuId: m.id, menuName: m.name, course: i.course, name: i.name, audience: i.audience, isChoice: realChoice, dietTags: i.dietTags, base, withMargin: withMargin(base, settings.safetyMarginPct) });
      if (realChoice && !groups.some((g) => g.key === key)) {
        const sum = options.reduce((s, o) => s + (chosen.find((c) => c.itemId === o.id)?.n ?? 0), 0);
        groups.push({ key, menuName: m.name, course: i.course, audience: i.audience, eligible: eligible(i.audience), chosen: sum, unchosen: Math.max(0, eligible(i.audience) - sum) });
      }
    }
  }
  const counts = { adults, children, total: adults + children, publicAdults, publicChildren };
  const drinks = settings.drinkRules.map((r) => ({ ruleId: r.id, label: r.label, unit: r.unit, perGuests: r.perGuests, perHours: r.perHours, adultsOnly: r.adultsOnly, guests: r.adultsOnly ? adults : adults + children, quantity: estimateDrink(r, counts, settings.serviceHours) }));
  return { counts, marginPct: settings.safetyMarginPct, serviceHours: settings.serviceHours, lines, groups, drinks };
}

/** Aggregated quantities per item (+ margin) and the drink estimates. Counts only — no household is named. */
export async function getMenuQuantities(ctx: Ctx, occasionId: string): Promise<MenuQuantities> {
  await readAccess(ctx, occasionId);
  return computeQuantities(ctx, occasionId);
}

/** The order items a set of quantities becomes (pure — also what the test checks). */
export function buildOrderItems(q: MenuQuantities, locale: "ro" | "en", opts: { includeDrinks?: boolean } = {}): OrderItem[] {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, `menus.order.${key}`, params);
  const course = (c: MenuCourse) => translate(locale, `menus.courses.${c}`);
  const items: OrderItem[] = [];
  for (const l of q.lines) {
    if (l.withMargin === 0) continue;
    items.push({
      label: `${l.menuName} · ${l.name}`.slice(0, 200),
      quantity: l.withMargin,
      unit: t(l.audience === "children" ? "unitChild" : "unit"),
      note: q.marginPct > 0 ? t("noteMargin", { base: l.base, pct: q.marginPct }) : null,
    });
  }
  for (const g of q.groups) {
    if (g.unchosen === 0) continue;
    items.push({ label: t("unchosen", { menu: g.menuName, course: course(g.course) }).slice(0, 200), quantity: g.unchosen, unit: t(g.audience === "children" ? "unitChild" : "unit"), note: t("noteUnchosen") });
  }
  if (opts.includeDrinks) {
    for (const d of q.drinks) {
      if (d.quantity === 0) continue;
      items.push({ label: d.label, quantity: d.quantity, unit: d.unit, note: t("noteEstimate", { perGuests: d.perGuests, perHours: d.perHours }) });
    }
  }
  return items;
}

/**
 * "Trimite în comanda finală": fixes the next version of the booking's final order from the
 * quantities of this moment (managers; B5). Guest answers that change afterwards show up on
 * the booking as deltas — nothing here edits an agreed order.
 */
export async function pushMenuToOrder(ctx: Ctx, input: { occasionId: string; bookingId: string; includeDrinks?: boolean }): Promise<{ snapshotId: string; version: number; items: number }> {
  const data = z.object({ occasionId: idSchema, bookingId: idSchema, includeDrinks: formBool.default(false) }).parse(input);
  await writeAccess(ctx, data.occasionId);
  const [occasion] = await ctx.db.select({ locale: occasions.locale }).from(occasions).where(eq(occasions.id, data.occasionId));
  const items = buildOrderItems(await computeQuantities(ctx, data.occasionId), occasion?.locale ?? "ro", { includeDrinks: data.includeDrinks });
  if (items.length === 0) throw new AppError("VALIDATION", "menus.errors.nothingToOrder");
  if (items.length > ORDER_MAX_ITEMS) throw new AppError("LIMIT", "menus.errors.orderTooLong");
  // createOrderSnapshot checks that the booking belongs to an occasion the actor manages
  const res = await createOrderSnapshot(ctx, { bookingId: data.bookingId, items });
  return { snapshotId: res.snapshotId, version: res.version, items: items.length };
}

/* ── Registrations (import-time, idempotent) ─────────────────────────────── */

const CSV_HEAD = {
  ro: ["Meniu", "Fel", "Preparat", "Pentru", "Alegere", "Etichete", "Porții numărate", "Marjă (%)", "Porții cu marjă"],
  en: ["Menu", "Course", "Dish", "For", "Choice", "Tags", "Counted portions", "Margin (%)", "Portions with margin"],
} as const;

function register(): void {
  registerGuestSection<GuestMenu>({ key: "menu", order: 34, load: (ctx) => getGuestMenu(ctx) });

  registerExport({
    key: "menu-quantities-csv",
    titleKey: "menus.export.title",
    descriptionKey: "menus.export.description",
    run: async (ctx, occasionId) => {
      const q = await getMenuQuantities(ctx, occasionId);
      const l = ctx.locale === "en" ? "en" : "ro";
      const tr = (key: string, params?: Record<string, string | number>) => translate(l, `menus.${key}`, params);
      const rows: Array<Array<string | number | null>> = q.lines.map((x) => [
        x.menuName,
        tr(`courses.${x.course}`),
        x.name,
        tr(`audience.${x.audience}`),
        x.isChoice ? tr("export.yes") : tr("export.no"),
        x.dietTags.map((d) => tr(`diet.${d}`)).join(", "),
        x.base,
        q.marginPct,
        x.withMargin,
      ]);
      for (const g of q.groups) if (g.unchosen > 0) rows.push([g.menuName, tr(`courses.${g.course}`), tr("export.unchosen"), tr(`audience.${g.audience}`), "", "", g.unchosen, "", g.unchosen]);
      for (const d of q.drinks) rows.push([tr("export.drinksEstimate"), tr("courses.drink"), `${d.label} (${d.unit})`, d.adultsOnly ? tr("audience.adults") : tr("export.everyone"), "", "", d.quantity, "", d.quantity]);
      return { filename: `meniu-cantitati-${occasionId}.csv`, mime: "text/csv; charset=utf-8", content: toCsv([...CSV_HEAD[l]], rows) };
    },
  });

  onOccasionPurge(async (tx, occasionId) => {
    await tx.db.delete(mealChoices).where(eq(mealChoices.occasionId, occasionId));
    await tx.db.delete(menuItems).where(eq(menuItems.occasionId, occasionId));
    await tx.db.delete(menus).where(eq(menus.occasionId, occasionId));
    await tx.db.delete(menuSettings).where(eq(menuSettings.occasionId, occasionId));
  });
}
register();
