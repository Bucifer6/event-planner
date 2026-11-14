import {
  and,
  asc,
  businessLibraryItems,
  businessLibraryLinks,
  eq,
  inArray,
  isNull,
  libraryKindSchema,
  occasions,
  sql,
  taskCheckItems,
  tasks,
  type LibraryBody,
  type LibraryKind,
  type LibraryTemplateTask,
  type WhatIfDeltaRow,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { zId } from "@ed/shared/zod";
import { getAsset, getAssetUrl, registerUploadPurpose } from "@ed/storage";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { recordAssetUse } from "./bizoccasions";
import { assertBusinessCanCreate, requireBusinessMember } from "./business";
import { requireAccount, requireWriteCapable, systemCtx, type Ctx } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { createSupplier } from "./suppliers";
import { formatDay, scheduleDue } from "./templates";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Shared libraries of a business (P19): task templates, checklists, supplier contacts and
// files, kept once and applied to any occasion the business runs.
//
//   listLibrary / createLibraryItem / updateLibraryItem / archiveLibraryItem
//   proposeLibraryApply(ctx, { itemId, occasionId })   → a What-if preview (principle 3);
//       confirmed like any other: a template adds its tasks, a checklist one task with its
//       steps, a contact one supplier. Re-applying never duplicates.
//   shareLibraryFile(ctx, { itemId, occasionId })      a file becomes readable in an occasion
//   listOccasionLibraryFiles(ctx, occasionId)          …for that occasion's members, for good
//
// P23: EDITS (create / update / archive / share a new file) stop when the plan has lapsed.
// APPLYING what is already in the library keeps working, and files already shared stay
// readable — after a lapse and after a handover (P22).

export const LIBRARY_APPLY_KIND = "bizlibrary.apply";
export const LIBRARY_FILE_PURPOSE = "business.library";
export const MAX_LIBRARY_ITEMS = 500;
export const MAX_TEMPLATE_TASKS = 200;

export type LibraryItem = typeof businessLibraryItems.$inferSelect;

const zTitle = z.string().trim().min(2, "common.validation.required").max(160, "common.validation.tooLong");
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, "common.validation.tooLong").nullable().optional());

/**
 * Lines of a template: "Titlu" or "Titlu; 6" — the number is how many MONTHS before the date
 * the task is due ("; 0" = in the last month; no number = no due date offset, due on the day).
 */
export function parseTemplateLines(text: string, previous: LibraryTemplateTask[] = []): LibraryTemplateTask[] {
  const byTitle = new Map(previous.map((t) => [t.title, t.id]));
  const out: LibraryTemplateTask[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?);\s*(\d{1,2})\s*$/.exec(line);
    const title = (m ? m[1]! : line).trim().slice(0, 200);
    if (!title) continue;
    // ids are stable across edits so a re-applied template does not duplicate tasks
    out.push({ id: byTitle.get(title) ?? newId(), title, offsetMonths: m ? Number(m[2]) : 0, offsetDays: 0 });
  }
  return out;
}

export function templateLines(tasksOf: LibraryTemplateTask[]): string {
  return tasksOf.map((t) => (t.offsetMonths > 0 ? `${t.title}; ${t.offsetMonths}` : t.title)).join("\n");
}

const itemInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), title: zTitle, lines: z.string().max(20_000, "common.validation.tooLong") }),
  z.object({ kind: z.literal("checklist"), title: zTitle, lines: z.string().max(10_000, "common.validation.tooLong") }),
  z.object({
    kind: z.literal("contact"),
    title: zTitle,
    category: optionalText(80),
    person: optionalText(160),
    email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().toLowerCase().email("common.validation.invalidEmail").max(320).nullable().optional()),
    phone: optionalText(40),
    notes: optionalText(2000),
  }),
  z.object({ kind: z.literal("asset"), title: zTitle, assetId: zId }),
]);
export type LibraryItemInput = z.input<typeof itemInput>;

function fieldError(field: string, key: string): AppError {
  return new AppError("VALIDATION", key, { fieldErrors: { [field]: [key] } });
}

async function buildBody(ctx: Ctx, businessId: string, data: z.output<typeof itemInput>, previous?: LibraryItem): Promise<{ body: LibraryBody; assetId: string | null }> {
  switch (data.kind) {
    case "template": {
      const prev = previous?.body.kind === "template" ? previous.body.tasks : [];
      const list = parseTemplateLines(data.lines, prev);
      if (list.length === 0) throw fieldError("lines", "bizoccasions.errors.linesRequired");
      if (list.length > MAX_TEMPLATE_TASKS) throw fieldError("lines", "bizoccasions.errors.tooManyLines");
      return { body: { kind: "template", tasks: list }, assetId: null };
    }
    case "checklist": {
      const items = data.lines.split(/\r?\n/).map((l) => l.trim().slice(0, 200)).filter(Boolean);
      if (items.length === 0) throw fieldError("lines", "bizoccasions.errors.linesRequired");
      if (items.length > 100) throw fieldError("lines", "bizoccasions.errors.tooManyLines");
      return { body: { kind: "checklist", items }, assetId: null };
    }
    case "contact":
      return { body: { kind: "contact", category: data.category ?? null, person: data.person ?? null, email: data.email ?? null, phone: data.phone ?? null, notes: data.notes ?? null }, assetId: null };
    case "asset": {
      const asset = await getAsset(ctx, data.assetId);
      if (asset.ownerType !== "business" || asset.ownerId !== businessId) throw fieldError("assetId", "bizoccasions.errors.fileInvalid");
      return { body: { kind: "asset", assetKind: asset.kind === "pdf" ? "pdf" : "image" }, assetId: asset.id };
    }
  }
}

export type LibraryView = { items: Array<LibraryItem & { url: string | null }>; canEdit: boolean };

/** Everything in the library, by kind then title. Members only. */
export async function listLibrary(ctx: Ctx, businessId: string): Promise<LibraryView> {
  const { business } = await requireBusinessMember(ctx, businessId);
  const rows = await ctx.db
    .select()
    .from(businessLibraryItems)
    .where(and(eq(businessLibraryItems.businessId, businessId), isNull(businessLibraryItems.archivedAt)))
    .orderBy(asc(businessLibraryItems.kind), asc(businessLibraryItems.title));
  const items = [];
  for (const r of rows) items.push({ ...r, url: r.assetId ? await signed(ctx, r.assetId) : null });
  return { items, canEdit: business.status === "active" && business.planLapsedAt === null };
}

async function signed(ctx: Ctx, assetId: string): Promise<string | null> {
  try {
    return await getAssetUrl(systemCtx(ctx.db, { now: ctx.now }), assetId, { ttlSeconds: 3600 });
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
}

/** Adds an item. Any live member; the business must be active and its plan not lapsed (P23). */
export async function createLibraryItem(ctx: Ctx, input: { businessId: string; item: LibraryItemInput }): Promise<LibraryItem> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const businessId = zId.parse(input.businessId);
  await requireBusinessMember(ctx, businessId);
  await assertBusinessCanCreate(ctx, businessId);
  const data = itemInput.parse(input.item);
  const built = await buildBody(ctx, businessId, data);
  return inTx(ctx, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(businessLibraryItems)
      .where(and(eq(businessLibraryItems.businessId, businessId), isNull(businessLibraryItems.archivedAt)));
    if (Number(n) >= MAX_LIBRARY_ITEMS) throw new AppError("LIMIT", "bizoccasions.errors.libraryFull");
    const [row] = await tx.db
      .insert(businessLibraryItems)
      .values({ businessId, kind: data.kind, title: data.title, body: built.body, assetId: built.assetId, createdByAccountId: accountId, createdAt: tx.now })
      .returning();
    await audit(tx, { action: "business_library.created", objectType: "business_library_item", objectId: row!.id, after: { businessId, kind: data.kind, title: data.title } });
    return row!;
  });
}

async function loadItem(ctx: Ctx, itemId: string): Promise<LibraryItem> {
  const [item] = await ctx.db.select().from(businessLibraryItems).where(eq(businessLibraryItems.id, zId.parse(itemId)));
  if (!item || item.archivedAt) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return item;
}

/** Changes an item's title and content (same kind). */
export async function updateLibraryItem(ctx: Ctx, input: { itemId: string; item: LibraryItemInput }): Promise<LibraryItem> {
  requireWriteCapable(ctx);
  const item = await loadItem(ctx, input.itemId);
  await requireBusinessMember(ctx, item.businessId);
  await assertBusinessCanCreate(ctx, item.businessId);
  const data = itemInput.parse(input.item);
  if (data.kind !== item.kind) throw new AppError("VALIDATION", "common.validation.invalid");
  const built = await buildBody(ctx, item.businessId, data, item);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.update(businessLibraryItems).set({ title: data.title, body: built.body, assetId: built.assetId }).where(eq(businessLibraryItems.id, item.id)).returning();
    await audit(tx, { action: "business_library.updated", objectType: "business_library_item", objectId: item.id, before: { title: item.title }, after: { title: data.title } });
    return row!;
  });
}

/** Takes an item out of the library. What was already applied or shared stays where it is. */
export async function archiveLibraryItem(ctx: Ctx, input: { itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const item = await loadItem(ctx, input.itemId);
  await requireBusinessMember(ctx, item.businessId);
  await assertBusinessCanCreate(ctx, item.businessId);
  await inTx(ctx, async (tx) => {
    await tx.db.update(businessLibraryItems).set({ archivedAt: tx.now }).where(eq(businessLibraryItems.id, item.id));
    await audit(tx, { action: "business_library.archived", objectType: "business_library_item", objectId: item.id, before: { title: item.title } });
  });
}

/* ── Apply to an occasion — through What-if (P19, principle 3) ─────────── */

const applyInput = z.object({ itemId: zId });
type OccasionRow = typeof occasions.$inferSelect;

/** The item and the occasion, checked: the occasion is run by the item's business and the actor manages it. */
async function loadApply(ctx: Ctx, itemId: string, occasionId: string | null, manage: boolean): Promise<{ item: LibraryItem; occasion: OccasionRow; memberId: string }> {
  if (!occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, occasionId, manage ? { manage: true } : {});
  const item = await loadItem(ctx, itemId);
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!occasion || occasion.businessId !== item.businessId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireBusinessMember(ctx, item.businessId);
  return { item, occasion, memberId: member.id };
}

const taskKey = (itemId: string, taskId?: string) => (taskId ? `lib:${itemId}:${taskId}` : `lib:${itemId}`);

async function planApply(ctx: Ctx, item: LibraryItem, occasion: OccasionRow): Promise<{ delta: WhatIfDeltaRow[]; creates: Array<{ key: string; title: string; dueAt: Date | null; offsetMonths: number; items?: string[] }> }> {
  const delta: WhatIfDeltaRow[] = [];
  const creates: Array<{ key: string; title: string; dueAt: Date | null; offsetMonths: number; items?: string[] }> = [];
  const body = item.body;
  if (body.kind === "contact") {
    delta.push({ key: item.id, what: item.title, kindLabelKey: "bizoccasions.whatif.supplierAdded", after: body.person ?? body.email ?? body.phone ?? { key: "bizoccasions.whatif.noContact" } });
    return { delta, creates };
  }
  const wanted =
    body.kind === "template"
      ? body.tasks.map((t) => ({ key: taskKey(item.id, t.id), title: t.title, offsetMonths: t.offsetMonths, dueAt: scheduleDue(occasion.startsAt, occasion.timezone, t.offsetMonths, t.offsetDays) }))
      : body.kind === "checklist"
        ? [{ key: taskKey(item.id), title: item.title, offsetMonths: 0, dueAt: null as Date | null, items: body.items }]
        : [];
  const existing = wanted.length
    ? await ctx.db.select({ key: tasks.templateTaskKey }).from(tasks).where(and(eq(tasks.occasionId, occasion.id), inArray(tasks.templateTaskKey, wanted.map((w) => w.key))))
    : [];
  const have = new Set(existing.map((e) => e.key));
  for (const w of wanted) {
    if (have.has(w.key)) continue;
    creates.push(w);
    delta.push({
      key: w.key,
      what: w.title,
      kindLabelKey: "whatif.kinds.added",
      after: "items" in w && w.items ? { key: "bizoccasions.whatif.steps", params: { count: w.items.length } } : w.dueAt ? formatDay(w.dueAt, occasion.timezone) : { key: "templates.whatif.noDate" },
    });
  }
  const skipped = wanted.length - creates.length;
  if (skipped > 0) delta.push({ key: "_skipped", what: { key: "bizoccasions.whatif.alreadyThere", params: { count: skipped } } });
  return { delta: delta.slice(0, 400), creates };
}

registerWhatIf<z.infer<typeof applyInput>>(LIBRARY_APPLY_KIND, {
  input: applyInput,
  authorize: async (ctx, subject, action) => {
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? {} : { manage: true });
  },
  compute: async (ctx, input, subject) => {
    const { item, occasion } = await loadApply(ctx, input.itemId, subject.occasionId, true);
    const { delta } = await planApply(ctx, item, occasion);
    return { title: { key: `bizoccasions.whatif.applyTitle.${item.kind}`, params: { title: item.title } }, delta };
  },
  apply: async (tx, preview) => {
    const { item, occasion, memberId } = await loadApply(tx, preview.input.itemId, preview.occasionId, true);
    await assertOccasionWritable(tx, occasion.id);
    const body = item.body;
    let created = 0;
    if (body.kind === "contact") {
      await createSupplier(tx, {
        occasionId: occasion.id,
        name: item.title,
        categoryLabel: body.category ?? undefined,
        contactName: body.person ?? undefined,
        contactEmail: body.email ?? undefined,
        contactPhone: body.phone ?? undefined,
        notes: body.notes ?? undefined,
      });
      created = 1;
    } else {
      // recomputed now: whatever changed since the preview, nothing is duplicated
      const { creates } = await planApply(tx, item, occasion);
      for (const c of creates) {
        const [row] = await tx.db
          .insert(tasks)
          .values({
            occasionId: occasion.id,
            title: c.title,
            dueAt: c.dueAt,
            templateTaskKey: c.key,
            offsetMonths: c.offsetMonths,
            offsetDays: 0,
            // a team member without a seat has a synthetic id: not stored in a member column
            createdByMemberId: memberId.startsWith("bm_") ? null : memberId,
            createdAt: tx.now,
          })
          .onConflictDoNothing()
          .returning({ id: tasks.id });
        if (!row) continue;
        created += 1;
        if (c.items?.length) {
          await tx.db.insert(taskCheckItems).values(c.items.map((label, position) => ({ taskId: row.id, label, position, createdAt: tx.now })));
        }
      }
    }
    await recordAssetUse(tx, { businessId: item.businessId, kind: `library_${item.kind}`, itemId: item.id });
    await audit(tx, { action: "business_library.applied", objectType: "occasion", objectId: occasion.id, meta: { itemId: item.id, kind: item.kind, created } });
  },
});

/** Preview of applying a template, checklist or contact to an occasion the business runs. */
export async function proposeLibraryApply(ctx: Ctx, input: { itemId: string; occasionId: string }): Promise<WhatIfPreview> {
  const data = z.object({ itemId: zId, occasionId: zId }).parse(input);
  const { item } = await loadApply(ctx, data.itemId, data.occasionId, true);
  if (item.kind === "asset") throw new AppError("VALIDATION", "common.validation.invalid");
  return createPreview(ctx, { kind: LIBRARY_APPLY_KIND, occasionId: data.occasionId, subjectType: "occasion", subjectId: data.occasionId, input: { itemId: data.itemId } });
}

/* ── Files shared into an occasion ─────────────────────────────────────── */

/** Makes a library file readable by the members of one occasion. Idempotent. */
export async function shareLibraryFile(ctx: Ctx, input: { itemId: string; occasionId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ itemId: zId, occasionId: zId }).parse(input);
  const { item, occasion } = await loadApply(ctx, data.itemId, data.occasionId, true);
  if (item.kind !== "asset" || !item.assetId) throw new AppError("VALIDATION", "common.validation.invalid");
  await assertBusinessCanCreate(ctx, item.businessId); // P23: a NEW share is a library edit
  await inTx(ctx, async (tx) => {
    const added = await tx.db
      .insert(businessLibraryLinks)
      .values({ itemId: item.id, occasionId: occasion.id, title: item.title, assetId: item.assetId!, createdAt: tx.now })
      .onConflictDoNothing()
      .returning({ id: businessLibraryLinks.id });
    if (added.length === 0) return;
    await recordAssetUse(tx, { businessId: item.businessId, kind: "library_asset", itemId: item.id });
    await audit(tx, { action: "business_library.shared", objectType: "occasion", objectId: occasion.id, meta: { itemId: item.id } });
  });
}

export type OccasionLibraryFile = { id: string; itemId: string; title: string; url: string | null; sharedAt: Date };

/**
 * Files a business shared into this occasion, for ANY member of the occasion. Deliberately
 * independent of the business: they stay readable after a plan lapse (P23, invariant 8) and
 * after the occasion was handed over (P22).
 */
export async function listOccasionLibraryFiles(ctx: Ctx, occasionId: string): Promise<OccasionLibraryFile[]> {
  await requireMember(ctx, occasionId);
  const rows = await ctx.db.select().from(businessLibraryLinks).where(eq(businessLibraryLinks.occasionId, occasionId)).orderBy(asc(businessLibraryLinks.createdAt));
  const out: OccasionLibraryFile[] = [];
  for (const r of rows) out.push({ id: r.id, itemId: r.itemId, title: r.title, url: await signed(ctx, r.assetId), sharedAt: r.createdAt });
  return out;
}

export type { LibraryKind };
export { libraryKindSchema };

registerUploadPurpose(LIBRARY_FILE_PURPOSE, { ownerType: "business", allowPdf: true });
