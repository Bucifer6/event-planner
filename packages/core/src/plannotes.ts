import { and, asc, eq, planNotes, type PlanNoteKind, type PlanNoteShortlistItem } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zCurrency, zId, zText } from "@ed/shared/zod";
import { z } from "zod";
import { getMember, hasGrant, isManager, requireMember } from "./access";
import { audit } from "./audit";
import { addCategories, listCategories, plainMoney, requireFinance, updateCategory } from "./budget";
import { requireWriteCapable, type Ctx } from "./context";
import { getPublicListing } from "./directory";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfDeltaRow, type WhatIfPreview } from "./whatif";

// Plan notes and the three What-if kinds behind the MCP tools propose_supplier_shortlist,
// propose_budget and propose_budget_note (MCP3, SEC15, P8, P16, D3).
//
//   plan.shortlistNote      a planner-side note listing directory listings to consider. It is
//                           ONLY a note: it notifies nobody, creates no supplier record and
//                           sends no enquiry — the planner still writes to a business personally.
//   budget.proposeEstimates category estimates (and optional notes). Finance grant. Every
//                           number is an ESTIMATE and says so; it is never a quote.
//   budget.proposeNote      a note on a budget category (or on the budget). Finance grant.
//
// Nothing here is applied until a person confirms the preview in the app.

export const SHORTLIST_NOTE_KIND = "plan.shortlistNote";
export const BUDGET_ESTIMATES_KIND = "budget.proposeEstimates";
export const BUDGET_NOTE_KIND = "budget.proposeNote";
export const MAX_SHORTLIST_ITEMS = 20;
export const MAX_PLAN_NOTES_PER_OCCASION = 200;

export type PlanNote = typeof planNotes.$inferSelect;
export type { PlanNoteKind, PlanNoteShortlistItem };

/** Delta texts are capped at 500 characters: longer text is shown whole, in consecutive rows. */
export function chunkText(text: string, max = 480): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const sourceOf = (preview: Pick<WhatIfPreview, "proposedByKind">) => (preview.proposedByKind === "mcp" ? ("external_assistant" as const) : ("planner" as const));

async function assertRoom(tx: Ctx, occasionId: string, adding = 1): Promise<void> {
  const rows = await tx.db.select({ id: planNotes.id }).from(planNotes).where(eq(planNotes.occasionId, occasionId));
  if (rows.length + adding > MAX_PLAN_NOTES_PER_OCCASION) throw new AppError("LIMIT", "mcp.errors.tooManyNotes");
}

/* ── Reading and removing notes ─────────────────────────────────────────── */

/**
 * The occasion's plan notes the actor may see: shortlist notes for planning members, budget
 * notes only with the finance grant (D2). Oldest first.
 */
export async function listPlanNotes(ctx: Ctx, occasionId: string, opts: { kind?: PlanNoteKind } = {}): Promise<PlanNote[]> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const rows = await ctx.db
    .select()
    .from(planNotes)
    .where(and(eq(planNotes.occasionId, occasionId), opts.kind ? eq(planNotes.kind, opts.kind) : undefined))
    .orderBy(asc(planNotes.createdAt), asc(planNotes.id));
  const finance = hasGrant(member, "finance");
  return rows.filter((n) => n.kind !== "budget_note" || finance);
}

/** Removes a note: managers for shortlist notes, finance-grant holders for budget notes. Idempotent. */
export async function deletePlanNote(ctx: Ctx, input: { noteId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const id = zId.parse(input.noteId);
  const [note] = await ctx.db.select().from(planNotes).where(eq(planNotes.id, id));
  if (!note) return;
  const member = await getMember(ctx, note.occasionId);
  if (!member) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const allowed = note.kind === "budget_note" ? hasGrant(member, "finance") : isManager(member);
  if (!allowed) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await inTx(ctx, async (tx) => {
    const gone = await tx.db.delete(planNotes).where(eq(planNotes.id, id)).returning({ id: planNotes.id });
    if (gone.length > 0) await audit(tx, { action: "plan_note.removed", objectType: "plan_note", objectId: id, meta: { occasionId: note.occasionId, kind: note.kind } });
  });
}

/* ── plan.shortlistNote ─────────────────────────────────────────────────── */

const shortlistInput = z.object({
  title: zText(120).optional(),
  items: z
    .array(
      z.object({
        listingId: zId,
        /** The listing's public name, resolved by the server (never trusted from a caller). */
        name: zText(200),
        reason: z.string().trim().max(400).nullish(),
        /** P14: true when the search result carried the paid label — kept verbatim. */
        featured: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(MAX_SHORTLIST_ITEMS)
    .refine((items) => new Set(items.map((i) => i.listingId)).size === items.length, { message: "common.validation.invalid" }),
});

registerWhatIf<z.output<typeof shortlistInput>>(SHORTLIST_NOTE_KIND, {
  input: shortlistInput,
  authorize: async (ctx, subject, action) => {
    // in the app only managers add supplier records; the same people decide on a shortlist
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? { roles: PLANNING_ROLES } : { manage: true });
  },
  compute: async (ctx, input) => {
    const delta: WhatIfDeltaRow[] = [];
    for (const item of input.items) {
      const listing = await getPublicListing(ctx, item.listingId);
      if (!listing || listing.name !== item.name) throw new AppError("VALIDATION", "mcp.errors.listingNotPublic");
      delta.push({
        key: `listing:${item.listingId}`,
        what: listing.name,
        kindLabelKey: item.featured ? "featured.label" : "mcp.whatif.shortlist.listing",
        before: undefined,
        after: item.reason ? item.reason : { key: "mcp.whatif.shortlist.noReason" },
        noteKey: "mcp.whatif.shortlist.noteOnly",
      });
    }
    return { title: { key: "mcp.whatif.shortlist.title", params: { count: input.items.length } }, delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    const member = await requireMember(tx, occasionId, { manage: true });
    await assertOccasionWritable(tx, occasionId);
    await assertRoom(tx, occasionId);
    const items: PlanNoteShortlistItem[] = preview.input.items.map((i) => ({ listingId: i.listingId, name: i.name, reason: i.reason ?? null, featured: i.featured }));
    const [row] = await tx.db
      .insert(planNotes)
      .values({ occasionId, kind: "supplier_shortlist", title: preview.input.title ?? null, items, source: sourceOf(preview), previewId: preview.id, createdByAccountId: member.accountId, createdAt: tx.now })
      .returning({ id: planNotes.id });
    // A NOTE and nothing else: no supplier, no booking, no enquiry, no email, no notification.
    await audit(tx, { action: "plan_note.added", objectType: "plan_note", objectId: row!.id, meta: { occasionId, kind: "supplier_shortlist", listings: items.length, source: sourceOf(preview) } });
  },
});

/**
 * A preview of a shortlist note. Listing names are resolved here from the public directory;
 * a listing that is not public is refused. Managers only (SEC15).
 */
export async function proposeSupplierShortlist(
  ctx: Ctx,
  input: { occasionId: string; title?: string; items: Array<{ listingId: string; reason?: string | null; featured?: boolean }>; source?: string },
): Promise<WhatIfPreview> {
  const occasionId = zId.parse(input.occasionId);
  await requireMember(ctx, occasionId, { manage: true });
  const items = [];
  for (const item of input.items.slice(0, MAX_SHORTLIST_ITEMS + 1)) {
    const listing = await getPublicListing(ctx, item.listingId);
    if (!listing) throw new AppError("VALIDATION", "mcp.errors.listingNotPublic");
    items.push({ listingId: listing.id, name: listing.name, reason: item.reason ?? null, featured: item.featured === true });
  }
  return createPreview(ctx, { kind: SHORTLIST_NOTE_KIND, occasionId, subjectType: "occasion", subjectId: occasionId, input: { title: input.title, items }, source: input.source });
}

/* ── budget.proposeEstimates ────────────────────────────────────────────── */

const zEstimate = z.number().int().safe().min(0, "common.validation.tooSmall").max(9_000_000_000_00, "common.validation.tooBig");
const estimatesInput = z.object({
  categories: z
    .array(
      z
        .object({
          /** An existing category … */
          categoryId: zId.optional(),
          /** … or the name of one (an existing name is updated, a new name is added). */
          name: zText(80).optional(),
          estimateMinor: zEstimate,
          /** New categories only; existing ones keep their currency. */
          currency: zCurrency.optional(),
          note: z.string().trim().max(1000).optional(),
        })
        .refine((c) => (c.categoryId ? 1 : 0) + (c.name ? 1 : 0) === 1, { message: "common.validation.invalid" }),
    )
    .min(1)
    .max(60),
});

type EstimateLine = z.output<typeof estimatesInput>["categories"][number];

async function matchCategories(ctx: Ctx, occasionId: string, lines: EstimateLine[], stale: "VALIDATION" | "CONFLICT") {
  const existing = await listCategories(ctx, occasionId); // finance grant inside
  const seen = new Set<string>();
  return lines.map((line) => {
    const found = line.categoryId ? existing.find((c) => c.id === line.categoryId) : existing.find((c) => c.name.toLowerCase() === line.name!.toLowerCase());
    if (line.categoryId && !found) throw new AppError(stale, "mcp.errors.categoryMissing");
    const key = found ? found.id : `new:${line.name!.toLowerCase()}`;
    if (seen.has(key)) throw new AppError("VALIDATION", "mcp.errors.categoryTwice");
    seen.add(key);
    return { line, found: found ?? null };
  });
}

registerWhatIf<z.output<typeof estimatesInput>>(BUDGET_ESTIMATES_KIND, {
  input: estimatesInput,
  // D2: money is visible only with the finance grant — for reading the proposal too
  authorize: async (ctx, subject) => {
    await requireFinance(ctx, subject.occasionId ?? "");
  },
  compute: async (ctx, input, subject) => {
    const matched = await matchCategories(ctx, subject.occasionId!, input.categories, "VALIDATION");
    const delta: WhatIfDeltaRow[] = [];
    matched.forEach(({ line, found }, i) => {
      const currency = found?.currency ?? line.currency ?? "RON";
      delta.push({
        key: `estimate:${found?.id ?? i}`,
        what: found?.name ?? line.name!,
        kindLabelKey: found ? "mcp.whatif.budget.estimate" : "mcp.whatif.budget.newCategory",
        // null = the estimate is unknown today (never shown as 0)
        before: found ? (found.estimateMinor === null ? null : plainMoney(found.estimateMinor, found.currency)) : undefined,
        after: plainMoney(line.estimateMinor, currency),
        noteKey: "mcp.whatif.budget.estimateNote",
      });
      chunkText(line.note ?? "").forEach((part, n) => delta.push({ key: `note:${i}:${n}`, what: { key: "mcp.whatif.budget.noteOn", params: { name: found?.name ?? line.name! } }, before: undefined, after: part }));
    });
    return { title: { key: "mcp.whatif.budget.title", params: { count: input.categories.length } }, delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    const member = await requireFinance(tx, occasionId);
    await assertOccasionWritable(tx, occasionId);
    const matched = await matchCategories(tx, occasionId, preview.input.categories, "CONFLICT");
    const notes = matched.filter((m) => m.line.note).length;
    if (notes > 0) await assertRoom(tx, occasionId, notes);
    for (const { line, found } of matched) {
      // the same core writes as the budget page: same checks, same audit rows
      const category = found
        ? await updateCategory(tx, { categoryId: found.id, estimateMinor: line.estimateMinor })
        : (await addCategories(tx, { occasionId, categories: [{ name: line.name!, estimateMinor: line.estimateMinor, currency: line.currency }] }))[0];
      if (line.note && category) {
        await tx.db.insert(planNotes).values({ occasionId, kind: "budget_note", body: line.note, budgetCategoryId: category.id, source: sourceOf(preview), previewId: preview.id, createdByAccountId: member.accountId, createdAt: tx.now });
      }
    }
    await audit(tx, { action: "budget.estimates_applied", objectType: "occasion", objectId: occasionId, meta: { categories: matched.length, notes, source: sourceOf(preview), previewId: preview.id } });
  },
});

/** A preview of category estimates. Finance grant required (SEC15). */
export async function proposeBudgetEstimates(ctx: Ctx, input: { occasionId: string; categories: z.input<typeof estimatesInput>["categories"]; source?: string }): Promise<WhatIfPreview> {
  const occasionId = zId.parse(input.occasionId);
  await requireFinance(ctx, occasionId);
  return createPreview(ctx, { kind: BUDGET_ESTIMATES_KIND, occasionId, subjectType: "occasion", subjectId: occasionId, input: { categories: input.categories }, source: input.source });
}

/* ── budget.proposeNote ─────────────────────────────────────────────────── */

const budgetNoteInput = z.object({ categoryId: zId.optional(), text: zText(1000) });

async function noteCategory(ctx: Ctx, occasionId: string, categoryId: string | undefined, stale: "VALIDATION" | "CONFLICT") {
  const categories = await listCategories(ctx, occasionId); // finance grant inside
  if (!categoryId) return null;
  const found = categories.find((c) => c.id === categoryId);
  if (!found) throw new AppError(stale, "mcp.errors.categoryMissing");
  return found;
}

registerWhatIf<z.output<typeof budgetNoteInput>>(BUDGET_NOTE_KIND, {
  input: budgetNoteInput,
  authorize: async (ctx, subject) => {
    await requireFinance(ctx, subject.occasionId ?? "");
  },
  compute: async (ctx, input, subject) => {
    const category = await noteCategory(ctx, subject.occasionId!, input.categoryId, "VALIDATION");
    const what = category ? { key: "mcp.whatif.budget.noteOn", params: { name: category.name } } : { key: "mcp.whatif.budget.noteGeneral" };
    return {
      title: { key: "mcp.whatif.budget.noteTitle" },
      delta: chunkText(input.text).map((part, n) => ({ key: `note:${n}`, what, before: undefined, after: part })),
    };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    const member = await requireFinance(tx, occasionId);
    await assertOccasionWritable(tx, occasionId);
    const category = await noteCategory(tx, occasionId, preview.input.categoryId, "CONFLICT");
    await assertRoom(tx, occasionId);
    const [row] = await tx.db
      .insert(planNotes)
      .values({ occasionId, kind: "budget_note", body: preview.input.text, budgetCategoryId: category?.id ?? null, source: sourceOf(preview), previewId: preview.id, createdByAccountId: member.accountId, createdAt: tx.now })
      .returning({ id: planNotes.id });
    await audit(tx, { action: "plan_note.added", objectType: "plan_note", objectId: row!.id, meta: { occasionId, kind: "budget_note", source: sourceOf(preview) } });
  },
});

/** A preview of a note on a budget category. Finance grant required (SEC15). */
export async function proposeBudgetNote(ctx: Ctx, input: { occasionId: string; categoryId?: string; text: string; source?: string }): Promise<WhatIfPreview> {
  const occasionId = zId.parse(input.occasionId);
  await requireFinance(ctx, occasionId);
  return createPreview(ctx, { kind: BUDGET_NOTE_KIND, occasionId, subjectType: "occasion", subjectId: occasionId, input: { categoryId: input.categoryId, text: input.text }, source: input.source });
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(planNotes).where(eq(planNotes.occasionId, occasionId));
});
