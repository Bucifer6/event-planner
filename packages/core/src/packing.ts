import { and, asc, checkItemRevisions, eq, inArray, packingLists, sql, subgroups, taskCheckItems, tasks, type PackingScope } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { type LooseInput, canPlanTrip, seesSubgroup, visibleSubgroups } from "./subgroups";
import { inTx } from "./tx";

// RELEASE D (D-03): packing lists. A packing list IS a task with check items (principle 2: one
// record, many views) — `packing_lists` only flags the task and says whom the list is for.
// The items are task_check_items rows: the same ones the Tasks views show, tick and count.
//
//   scope "occasion"  everyone on the trip sees and ticks it; trip planners shape it
//   scope "subgroup"  that subgroup's people (and trip planners); its lead shapes it too
//   scope "personal"  one member's own list — nobody else sees it, managers included

export type { PackingScope };
const idSchema = z.string().min(1).max(64);

/** One-tap starters. Labels are data (stored on the list in the planner's language), not UI strings. */
export const PACKING_TEMPLATES = {
  munte: {
    ro: ["Bocanci de munte", "Geacă impermeabilă", "Polar", "Rucsac de zi", "Sticlă de apă", "Frontală", "Trusă de prim ajutor", "Cremă de soare", "Hartă sau traseu descărcat", "Baterie externă"],
    en: ["Hiking boots", "Waterproof jacket", "Fleece", "Day pack", "Water bottle", "Head torch", "First-aid kit", "Sunscreen", "Map or downloaded route", "Power bank"],
  },
  mare: {
    ro: ["Costum de baie", "Prosop de plajă", "Cremă de soare", "Ochelari de soare", "Pălărie", "Șlapi", "Umbrelă de plajă", "Carte", "Pungă pentru haine ude"],
    en: ["Swimsuit", "Beach towel", "Sunscreen", "Sunglasses", "Hat", "Flip-flops", "Beach umbrella", "Book", "Bag for wet clothes"],
  },
  city: {
    ro: ["Act de identitate sau pașaport", "Încălțăminte comodă", "Încărcător și adaptor de priză", "Baterie externă", "Bilete și rezervări descărcate", "Umbrelă mică", "Card și puțin numerar"],
    en: ["ID card or passport", "Comfortable shoes", "Charger and plug adapter", "Power bank", "Tickets and bookings downloaded", "Small umbrella", "Card and a little cash"],
  },
  festival: {
    ro: ["Bilet sau brățară", "Cort", "Sac de dormit", "Izopren", "Pelerină de ploaie", "Dopuri de urechi", "Baterie externă", "Sticlă reutilizabilă", "Cremă de soare", "Lanternă"],
    en: ["Ticket or wristband", "Tent", "Sleeping bag", "Sleeping mat", "Rain poncho", "Earplugs", "Power bank", "Reusable bottle", "Sunscreen", "Torch"],
  },
} as const;
export type PackingTemplateKey = keyof typeof PACKING_TEMPLATES;
export const PACKING_TEMPLATE_KEYS = Object.keys(PACKING_TEMPLATES) as PackingTemplateKey[];

export type PackingItem = { id: string; label: string; done: boolean; /** bumped on every change (offline ticks compare it) */ revision: number };
export type PackingListView = {
  taskId: string;
  title: string;
  scope: PackingScope;
  subgroupId: string | null;
  subgroupName: string | null;
  items: PackingItem[];
  done: number;
  total: number;
  /** Add / remove items, delete the list. */
  canShape: boolean;
  canTick: boolean;
};

type ListRow = typeof packingLists.$inferSelect;

async function canShape(ctx: Ctx, member: Member, list: ListRow): Promise<boolean> {
  if (list.scope === "personal") return list.memberId === member.id;
  if (canPlanTrip(member)) return true;
  if (list.scope === "subgroup" && list.subgroupId) {
    const [g] = await ctx.db.select({ lead: subgroups.leadMemberId }).from(subgroups).where(eq(subgroups.id, list.subgroupId));
    return g?.lead === member.id;
  }
  return false;
}

function canSee(member: Member, list: ListRow, visible: "all" | string[]): boolean {
  if (list.scope === "personal") return list.memberId === member.id;
  if (list.scope === "subgroup") return seesSubgroup(visible, list.subgroupId);
  return true;
}

/** Packing lists the actor may see, with their items (the task's check items). */
export async function listPackingLists(ctx: Ctx, occasionId: string): Promise<PackingListView[]> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const visible = await visibleSubgroups(ctx, member);
  const rows = await ctx.db
    .select({ list: packingLists, title: tasks.title, groupName: subgroups.name })
    .from(packingLists)
    .innerJoin(tasks, eq(tasks.id, packingLists.taskId))
    .leftJoin(subgroups, eq(subgroups.id, packingLists.subgroupId))
    .where(eq(packingLists.occasionId, id))
    .orderBy(asc(packingLists.createdAt));
  const mine = rows.filter((r) => canSee(member, r.list, visible));
  if (mine.length === 0) return [];
  const items = await ctx.db
    .select({ id: taskCheckItems.id, taskId: taskCheckItems.taskId, label: taskCheckItems.label, done: taskCheckItems.done, revision: sql<number>`coalesce(${checkItemRevisions.revision}, 0)::int` })
    .from(taskCheckItems)
    .leftJoin(checkItemRevisions, eq(checkItemRevisions.itemId, taskCheckItems.id))
    .where(
      inArray(
        taskCheckItems.taskId,
        mine.map((r) => r.list.taskId),
      ),
    )
    .orderBy(asc(taskCheckItems.position), asc(taskCheckItems.createdAt));
  const out: PackingListView[] = [];
  for (const r of mine) {
    const own = items.filter((i) => i.taskId === r.list.taskId).map((i) => ({ id: i.id, label: i.label, done: i.done, revision: i.revision }));
    out.push({
      taskId: r.list.taskId,
      title: r.title,
      scope: r.list.scope,
      subgroupId: r.list.subgroupId,
      subgroupName: r.groupName,
      items: own,
      done: own.filter((i) => i.done).length,
      total: own.length,
      canShape: await canShape(ctx, member, r.list),
      canTick: true,
    });
  }
  return out;
}

const createInput = z.object({
  occasionId: idSchema,
  title: zText(120),
  scope: z.enum(["occasion", "subgroup", "personal"]).default("personal"),
  subgroupId: z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional()),
  template: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["munte", "mare", "city", "festival"]).optional()),
});

/**
 * Creates the task that is the packing list (optionally filled from a starter). Personal lists
 * can be made by any member for themselves; shared ones by trip planners or the subgroup's lead.
 */
export async function createPackingList(ctx: Ctx, input: LooseInput<typeof createInput>): Promise<{ taskId: string }> {
  requireWriteCapable(ctx);
  const data = createInput.parse(input);
  const member = await requireMember(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  if (member.viaBusiness && data.scope === "personal") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (data.scope === "subgroup") {
    if (!data.subgroupId) throw new AppError("VALIDATION", "common.validation.required", { fieldErrors: { subgroupId: ["common.validation.required"] } });
    const [g] = await ctx.db.select().from(subgroups).where(and(eq(subgroups.id, data.subgroupId), eq(subgroups.occasionId, data.occasionId)));
    if (!g) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { subgroupId: ["common.validation.invalid"] } });
    if (!canPlanTrip(member) && g.leadMemberId !== member.id) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  } else if (data.scope === "occasion" && !canPlanTrip(member)) {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  const realId = member.viaBusiness ? null : member.id;
  return inTx(ctx, async (tx) => {
    const [task] = await tx.db
      .insert(tasks)
      .values({ occasionId: data.occasionId, title: data.title, ownerMemberId: data.scope === "personal" ? realId : null, createdByMemberId: realId, createdAt: tx.now })
      .returning({ id: tasks.id });
    await tx.db.insert(packingLists).values({
      taskId: task!.id,
      occasionId: data.occasionId,
      scope: data.scope,
      subgroupId: data.scope === "subgroup" ? (data.subgroupId ?? null) : null,
      memberId: data.scope === "personal" ? realId : null,
      createdAt: tx.now,
    });
    if (data.template) {
      const labels = PACKING_TEMPLATES[data.template][tx.locale === "en" ? "en" : "ro"];
      await tx.db.insert(taskCheckItems).values(labels.map((label, position) => ({ taskId: task!.id, label, position, createdAt: tx.now })));
    }
    await audit(tx, { action: "packing.list_created", objectType: "task", objectId: task!.id, after: { scope: data.scope, template: data.template ?? null } });
    return { taskId: task!.id };
  });
}

async function loadList(ctx: Ctx, taskId: string): Promise<{ list: ListRow; member: Member }> {
  const [list] = await ctx.db.select().from(packingLists).where(eq(packingLists.taskId, idSchema.parse(taskId)));
  if (!list) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, list.occasionId);
  const visible = await visibleSubgroups(ctx, member);
  // a list the member may not see does not exist for them (personal lists stay private)
  if (!canSee(member, list, visible)) throw new AppError(list.scope === "personal" ? "NOT_FOUND" : "FORBIDDEN", list.scope === "personal" ? "common.errors.NOT_FOUND" : "common.errors.FORBIDDEN");
  return { list, member };
}

export async function addPackingItem(ctx: Ctx, input: { taskId: string; label: string }): Promise<{ itemId: string }> {
  requireWriteCapable(ctx);
  const data = z.object({ taskId: idSchema, label: zText(160) }).parse(input);
  const { list, member } = await loadList(ctx, data.taskId);
  if (!(await canShape(ctx, member, list))) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, list.occasionId);
  const [last] = await ctx.db.select({ p: sql<number>`coalesce(max(${taskCheckItems.position}), -1)::int` }).from(taskCheckItems).where(eq(taskCheckItems.taskId, list.taskId));
  const [row] = await ctx.db
    .insert(taskCheckItems)
    .values({ taskId: list.taskId, label: data.label, position: (last?.p ?? -1) + 1, createdAt: ctx.now })
    .returning({ id: taskCheckItems.id });
  return { itemId: row!.id };
}

async function loadItem(ctx: Ctx, itemId: string) {
  const [item] = await ctx.db.select().from(taskCheckItems).where(eq(taskCheckItems.id, idSchema.parse(itemId)));
  if (!item) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const { list, member } = await loadList(ctx, item.taskId);
  await assertOccasionWritable(ctx, list.occasionId);
  return { item, list, member };
}

/** Tick / untick: anyone who sees the list. Idempotent. */
export async function setPackingItem(ctx: Ctx, input: { itemId: string; done: boolean }): Promise<void> {
  requireWriteCapable(ctx);
  const { item } = await loadItem(ctx, input.itemId);
  await ctx.db.update(taskCheckItems).set({ done: Boolean(input.done) }).where(eq(taskCheckItems.id, item.id));
}

export async function removePackingItem(ctx: Ctx, input: { itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { item, list, member } = await loadItem(ctx, input.itemId);
  if (!(await canShape(ctx, member, list))) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await ctx.db.delete(taskCheckItems).where(eq(taskCheckItems.id, item.id));
}

/** Deletes the list — that is, its task (the items go with it). */
export async function deletePackingList(ctx: Ctx, input: { taskId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { list, member } = await loadList(ctx, input.taskId);
  if (!(await canShape(ctx, member, list))) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, list.occasionId);
  await ctx.db.delete(tasks).where(eq(tasks.id, list.taskId));
  await audit(ctx, { action: "packing.list_deleted", objectType: "task", objectId: list.taskId });
}
