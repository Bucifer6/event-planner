import {
  and,
  asc,
  corrections,
  deliveries,
  deliveryItems,
  deliveryKindSchema,
  eq,
  gte,
  inArray,
  lt,
  sql,
  suppliers,
  DELIVERY_KINDS,
  DELIVERY_STATES,
  type DeliveryKind,
  type DeliveryState,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { recordCorrection, type Correction } from "./corrections";
import { registerCloseoutSection, registerLifecycleImpact } from "./lifecycle";
import { supplierAccess, zMoneyText, type SupplierAccess } from "./suppliers";
import { dayToInstant, formatDay, shiftDay } from "./templates";
import { inTx } from "./tx";

// Deliveries, hired items and returns (B6, principle 4).
//
// FACTS: received_qty, returned_qty and deposit_recovered_at. The first recording is free
// (recordReceipt / recordReturn / markDepositRecovered). Every later change goes through a
// correction — correctReceivedQty() etc. write the corrections row (before, after, actor,
// reason → audit log) and the new value in ONE transaction. A direct overwrite is impossible:
// recordReceipt refuses it here, and the database trigger (021_delivery_facts.sql) refuses any
// UPDATE of a recorded fact unless that same transaction declared a correction.
//
// Who: planning members read and record what arrives (the people at the door); owner and
// project manager plan deliveries and make corrections. Deposits are money: finance grant.

export { DELIVERY_KINDS, DELIVERY_STATES };
export type { DeliveryKind, DeliveryState };
export type Delivery = typeof deliveries.$inferSelect;
export type DeliveryItem = typeof deliveryItems.$inferSelect;

export const DELIVERY_ITEMS_TABLE = "delivery_items";

const idSchema = z.string().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const qty = (key = "deliveries.errors.quantity") =>
  z.coerce.number(key).int(key).min(0, key).max(1_000_000, key);

export type DeliveryItemView = {
  id: string;
  label: string;
  unit: string | null;
  expectedQty: number;
  receivedQty: number | null;
  receivedAt: Date | null;
  returnedQty: number | null;
  returnedAt: Date | null;
  /** undefined = viewer has no finance grant; null = no deposit. */
  depositMinor: number | null | undefined;
  currency: string;
  depositRecoveredAt: Date | null | undefined;
  /** Correction history of this item's facts, oldest first. */
  corrections: Correction[];
};

export type DeliveryView = {
  id: string;
  occasionId: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierPhone: string | null;
  title: string;
  kind: DeliveryKind;
  state: DeliveryState;
  expectedFrom: Date | null;
  expectedTo: Date | null;
  place: string | null;
  notes: string | null;
  items: DeliveryItemView[];
};

export type DeliveryList = {
  items: DeliveryView[];
  canManage: boolean;
  canSeeMoney: boolean;
  suppliers: Array<{ id: string; name: string }>;
};

/** What the delivery's state is, from its item facts (never stored by hand). */
export function deriveDeliveryState(kind: DeliveryKind, items: Array<Pick<DeliveryItem, "expectedQty" | "receivedQty" | "returnedQty">>): DeliveryState {
  if (items.length === 0) return "expected";
  const recorded = items.filter((i) => i.receivedQty !== null);
  if (recorded.length === 0) return "expected";
  const complete = recorded.length === items.length && items.every((i) => (i.receivedQty ?? 0) >= i.expectedQty);
  if (kind !== "delivery" && complete && items.every((i) => i.returnedQty !== null && i.returnedQty >= (i.receivedQty ?? 0))) {
    return "returned";
  }
  return complete ? "received" : "partial";
}

async function toViews(ctx: Ctx, rows: Delivery[], access: Pick<SupplierAccess, "canSeeMoney">, withCorrections: boolean): Promise<DeliveryView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((d) => d.id);
  const supplierIds = [...new Set(rows.map((d) => d.supplierId).filter((x): x is string => !!x))];
  const [items, sups] = await Promise.all([
    ctx.db.select().from(deliveryItems).where(inArray(deliveryItems.deliveryId, ids)).orderBy(asc(deliveryItems.position), asc(deliveryItems.createdAt), asc(deliveryItems.id)),
    supplierIds.length ? ctx.db.select().from(suppliers).where(inArray(suppliers.id, supplierIds)) : Promise.resolve([]),
  ]);
  const history =
    withCorrections && items.length
      ? await ctx.db
          .select()
          .from(corrections)
          .where(and(eq(corrections.targetTable, DELIVERY_ITEMS_TABLE), inArray(corrections.targetId, items.map((i) => i.id))))
          .orderBy(asc(corrections.createdAt), asc(corrections.id))
      : [];
  return rows.map((d) => {
    const s = sups.find((x) => x.id === d.supplierId);
    return {
      id: d.id,
      occasionId: d.occasionId,
      supplierId: d.supplierId,
      supplierName: s?.name ?? null,
      supplierPhone: s?.contactPhone ?? null,
      title: d.title,
      kind: d.kind,
      state: d.state,
      expectedFrom: d.expectedFrom,
      expectedTo: d.expectedTo,
      place: d.place,
      notes: d.notes,
      items: items
        .filter((i) => i.deliveryId === d.id)
        .map((i) => ({
          id: i.id,
          label: i.label,
          unit: i.unit,
          expectedQty: i.expectedQty,
          receivedQty: i.receivedQty,
          receivedAt: i.receivedAt,
          returnedQty: i.returnedQty,
          returnedAt: i.returnedAt,
          depositMinor: access.canSeeMoney ? i.depositMinor : undefined,
          currency: i.currency,
          depositRecoveredAt: access.canSeeMoney ? i.depositRecoveredAt : undefined,
          corrections: history.filter((c) => c.targetId === i.id),
        })),
    };
  });
}

/** All deliveries of the occasion (earliest slot first, undated last) with their items. */
export async function listDeliveries(ctx: Ctx, occasionId: string): Promise<DeliveryList> {
  const access = await supplierAccess(ctx, occasionId);
  const [rows, sups] = await Promise.all([
    ctx.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.occasionId, occasionId))
      .orderBy(sql`${deliveries.expectedFrom} asc nulls last`, asc(deliveries.createdAt)),
    ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.occasionId, occasionId)).orderBy(asc(suppliers.name)),
  ]);
  return {
    items: await toViews(ctx, rows, access, true),
    canManage: access.canManage,
    canSeeMoney: access.canSeeMoney,
    suppliers: sups,
  };
}

/**
 * Deliveries whose slot starts on one calendar day of the occasion's zone — for the event-day
 * view. NO access check and no money: call from code that already checked membership.
 */
export async function listDeliveriesForDayUnchecked(ctx: Ctx, occasionId: string, day: string, tz: string): Promise<DeliveryView[]> {
  const from = new Date(dayToInstant(day, tz).getTime() - 12 * 3600_000);
  const to = new Date(dayToInstant(shiftDay(day, { days: 1 }), tz).getTime() - 12 * 3600_000);
  const rows = await ctx.db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.occasionId, occasionId), gte(deliveries.expectedFrom, from), lt(deliveries.expectedFrom, to)))
    .orderBy(asc(deliveries.expectedFrom), asc(deliveries.createdAt));
  return toViews(ctx, rows, { canSeeMoney: false }, false);
}

async function loadDelivery(ctx: Ctx, deliveryId: string): Promise<{ delivery: Delivery } & SupplierAccess> {
  const id = idSchema.safeParse(deliveryId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [delivery] = await ctx.db.select().from(deliveries).where(eq(deliveries.id, id.data));
  if (!delivery) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const access = await supplierAccess(ctx, delivery.occasionId);
  return { delivery, ...access };
}

async function loadItem(ctx: Ctx, itemId: string): Promise<{ item: DeliveryItem; delivery: Delivery } & SupplierAccess> {
  const id = idSchema.safeParse(itemId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db
    .select({ i: deliveryItems, d: deliveries })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
    .where(eq(deliveryItems.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const access = await supplierAccess(ctx, row.d.occasionId);
  return { item: row.i, delivery: row.d, ...access };
}

export async function getDelivery(ctx: Ctx, deliveryId: string): Promise<DeliveryView & { canManage: boolean; canSeeMoney: boolean }> {
  const { delivery, canManage, canSeeMoney } = await loadDelivery(ctx, deliveryId);
  const [view] = await toViews(ctx, [delivery], { canSeeMoney }, true);
  return { ...view!, canManage, canSeeMoney };
}

const slotFields = {
  supplierId: idSchema.nullish().transform((v) => v || null),
  title: z.string().trim().min(1, "deliveries.errors.titleRequired").max(200, "common.validation.tooLong"),
  kind: deliveryKindSchema.default("delivery"),
  expectedFrom: z.date().nullish().transform((v) => v ?? null),
  expectedTo: z.date().nullish().transform((v) => v ?? null),
  place: optionalText(300),
  notes: optionalText(2000),
};
const itemFields = {
  label: z.string().trim().min(1, "deliveries.errors.labelRequired").max(200, "common.validation.tooLong"),
  expectedQty: qty(),
  unit: optionalText(30),
  /** Deposit as typed; only stored when the actor holds the finance grant. */
  deposit: zMoneyText("deliveries.errors.amount").optional(),
};

const createInput = z.object({ occasionId: idSchema, ...slotFields, items: z.array(z.object(itemFields)).max(60).default([]) });

async function assertSupplierInOccasion(ctx: Ctx, supplierId: string | null, occasionId: string): Promise<void> {
  if (!supplierId) return;
  const [s] = await ctx.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.occasionId, occasionId)));
  if (!s) throw new AppError("VALIDATION", "deliveries.errors.supplier", { fieldErrors: { supplierId: ["deliveries.errors.supplier"] } });
}

function assertSlot(from: Date | null, to: Date | null): void {
  if (from && to && to.getTime() < from.getTime()) {
    throw new AppError("VALIDATION", "deliveries.errors.slotOrder", { fieldErrors: { expectedTo: ["deliveries.errors.slotOrder"] } });
  }
}

/** Plans a delivery, a hire or a return, optionally with its first items. Managers only. */
export async function createDelivery(ctx: Ctx, input: z.input<typeof createInput>): Promise<{ deliveryId: string }> {
  requireWriteCapable(ctx);
  const data = createInput.parse(input);
  const access = await supplierAccess(ctx, data.occasionId);
  if (!access.canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertSupplierInOccasion(ctx, data.supplierId, data.occasionId);
  assertSlot(data.expectedFrom, data.expectedTo);
  return inTx(ctx, async (tx) => {
    const { items, ...slot } = data;
    const [row] = await tx.db.insert(deliveries).values(slot).returning();
    if (items.length) {
      await tx.db.insert(deliveryItems).values(
        items.map((i, position) => ({
          position,
          deliveryId: row!.id,
          occasionId: data.occasionId,
          label: i.label,
          expectedQty: i.expectedQty,
          unit: i.unit,
          depositMinor: access.canSeeMoney ? (i.deposit ?? null) : null,
        })),
      );
    }
    await audit(tx, {
      action: "delivery.created",
      objectType: "delivery",
      objectId: row!.id,
      after: { title: row!.title, kind: row!.kind, expectedFrom: row!.expectedFrom, items: items.length },
      meta: { occasionId: data.occasionId },
    });
    return { deliveryId: row!.id };
  });
}

const updateInput = z.object({ deliveryId: idSchema, ...slotFields });

/** Changes the plan of a delivery (slot, place, supplier). Never touches received facts. */
export async function updateDelivery(ctx: Ctx, input: z.input<typeof updateInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateInput.parse(input);
  const { delivery, canManage } = await loadDelivery(ctx, data.deliveryId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertSupplierInOccasion(ctx, data.supplierId, delivery.occasionId);
  assertSlot(data.expectedFrom, data.expectedTo);
  const { deliveryId, ...fields } = data;
  await inTx(ctx, async (tx) => {
    await tx.db.update(deliveries).set(fields).where(eq(deliveries.id, deliveryId));
    await refreshState(tx, deliveryId);
    await audit(tx, {
      action: "delivery.updated",
      objectType: "delivery",
      objectId: deliveryId,
      before: { title: delivery.title, expectedFrom: delivery.expectedFrom, expectedTo: delivery.expectedTo, place: delivery.place },
      after: { title: fields.title, expectedFrom: fields.expectedFrom, expectedTo: fields.expectedTo, place: fields.place },
      meta: { occasionId: delivery.occasionId },
    });
  });
}

/** Removes a planned delivery. Refused once anything was recorded as received or returned. */
export async function deleteDelivery(ctx: Ctx, input: { deliveryId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { delivery, canManage } = await loadDelivery(ctx, input.deliveryId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const items = await ctx.db.select().from(deliveryItems).where(eq(deliveryItems.deliveryId, delivery.id));
  if (items.some((i) => i.receivedQty !== null || i.returnedQty !== null || i.depositRecoveredAt !== null)) {
    throw new AppError("CONFLICT", "deliveries.errors.hasFacts");
  }
  await inTx(ctx, async (tx) => {
    await tx.db.delete(deliveries).where(eq(deliveries.id, delivery.id));
    await audit(tx, {
      action: "delivery.deleted",
      objectType: "delivery",
      objectId: delivery.id,
      before: { title: delivery.title },
      meta: { occasionId: delivery.occasionId },
    });
  });
}

const addItemInput = z.object({ deliveryId: idSchema, ...itemFields });

export async function addDeliveryItem(ctx: Ctx, input: z.input<typeof addItemInput>): Promise<{ itemId: string }> {
  requireWriteCapable(ctx);
  const data = addItemInput.parse(input);
  const { delivery, canManage, canSeeMoney } = await loadDelivery(ctx, data.deliveryId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  return inTx(ctx, async (tx) => {
    const [last] = await tx.db
      .select({ p: sql<number>`coalesce(max(${deliveryItems.position}), -1)::int` })
      .from(deliveryItems)
      .where(eq(deliveryItems.deliveryId, delivery.id));
    const [row] = await tx.db
      .insert(deliveryItems)
      .values({
        position: (last?.p ?? -1) + 1,
        deliveryId: delivery.id,
        occasionId: delivery.occasionId,
        label: data.label,
        expectedQty: data.expectedQty,
        unit: data.unit,
        depositMinor: canSeeMoney ? (data.deposit ?? null) : null,
      })
      .returning({ id: deliveryItems.id });
    await refreshState(tx, delivery.id);
    await audit(tx, {
      action: "delivery_item.added",
      objectType: "delivery_item",
      objectId: row!.id,
      after: { label: data.label, expectedQty: data.expectedQty },
      meta: { occasionId: delivery.occasionId, deliveryId: delivery.id },
    });
    return { itemId: row!.id };
  });
}

/** Removes an item line. Refused once a fact was recorded on it. */
export async function removeDeliveryItem(ctx: Ctx, input: { itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { item, delivery, canManage } = await loadItem(ctx, input.itemId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (item.receivedQty !== null || item.returnedQty !== null || item.depositRecoveredAt !== null) {
    throw new AppError("CONFLICT", "deliveries.errors.hasFacts");
  }
  await inTx(ctx, async (tx) => {
    await tx.db.delete(deliveryItems).where(eq(deliveryItems.id, item.id));
    await refreshState(tx, delivery.id);
    await audit(tx, {
      action: "delivery_item.removed",
      objectType: "delivery_item",
      objectId: item.id,
      before: { label: item.label, expectedQty: item.expectedQty },
      meta: { occasionId: delivery.occasionId, deliveryId: delivery.id },
    });
  });
}

async function refreshState(tx: Ctx, deliveryId: string): Promise<DeliveryState> {
  const [d] = await tx.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  const items = await tx.db.select().from(deliveryItems).where(eq(deliveryItems.deliveryId, deliveryId));
  const state = deriveDeliveryState(d!.kind, items);
  if (state !== d!.state) await tx.db.update(deliveries).set({ state }).where(eq(deliveries.id, deliveryId));
  return state;
}

/* ── Recording facts (first time: free) ─────────────────────────────────────────── */

type FactField = "receivedQty" | "returnedQty";
const FACT_COLUMNS = {
  receivedQty: { at: "receivedAt", action: "delivery_item.received", useCorrection: "deliveries.errors.useCorrection" },
  returnedQty: { at: "returnedAt", action: "delivery_item.returned", useCorrection: "deliveries.errors.useCorrectionReturn" },
} as const;

async function recordFact(ctx: Ctx, field: FactField, input: { itemId: string; quantity: unknown }): Promise<{ state: DeliveryState; recorded: boolean }> {
  requireWriteCapable(ctx);
  const data = z.object({ itemId: idSchema, quantity: qty() }).safeParse(input);
  if (!data.success) {
    throw new AppError("VALIDATION", "deliveries.errors.quantity", { fieldErrors: { quantity: ["deliveries.errors.quantity"] } });
  }
  const { item, delivery } = await loadItem(ctx, data.data.itemId);
  const meta = FACT_COLUMNS[field];
  if (field === "returnedQty" && item.receivedQty === null) {
    throw new AppError("CONFLICT", "deliveries.errors.returnBeforeReceipt");
  }
  if (item[field] !== null) {
    // already a fact: the same number again is a harmless repeat, anything else needs a correction
    if (item[field] === data.data.quantity) return { state: delivery.state, recorded: false };
    throw new AppError("CONFLICT", meta.useCorrection, { fieldErrors: { quantity: [meta.useCorrection] } });
  }
  return inTx(ctx, async (tx) => {
    // conditional: only the first recording wins; a concurrent second one is told to correct
    const rows = await tx.db
      .update(deliveryItems)
      .set({ [field]: data.data.quantity, [meta.at]: tx.now })
      .where(and(eq(deliveryItems.id, item.id), sql`${field === "receivedQty" ? deliveryItems.receivedQty : deliveryItems.returnedQty} is null`))
      .returning({ id: deliveryItems.id });
    if (!rows[0]) throw new AppError("CONFLICT", meta.useCorrection, { fieldErrors: { quantity: [meta.useCorrection] } });
    const state = await refreshState(tx, delivery.id);
    await audit(tx, {
      action: meta.action,
      objectType: "delivery_item",
      objectId: item.id,
      after: { [field]: data.data.quantity },
      meta: { occasionId: delivery.occasionId, deliveryId: delivery.id },
    });
    return { state, recorded: true };
  });
}

/**
 * Records how many arrived — the FIRST time. Planning members. A second call with the same
 * number is a no-op; with a different number it is refused (CONFLICT
 * deliveries.errors.useCorrection): a recorded quantity changes only through a correction.
 */
export function recordReceipt(ctx: Ctx, input: { itemId: string; receivedQty: unknown }): Promise<{ state: DeliveryState; recorded: boolean }> {
  return recordFact(ctx, "receivedQty", { itemId: input.itemId, quantity: input.receivedQty });
}

/** Records how many hired items went back — the first time (same rules as recordReceipt). */
export function recordReturn(ctx: Ctx, input: { itemId: string; returnedQty: unknown }): Promise<{ state: DeliveryState; recorded: boolean }> {
  return recordFact(ctx, "returnedQty", { itemId: input.itemId, quantity: input.returnedQty });
}

/* ── Corrections (the only way to change a recorded fact) ────────────────────────── */

const reasonSchema = z.string().trim().min(3, "corrections.errors.reasonRequired").max(1000, "common.validation.tooLong");

async function correctFact(
  ctx: Ctx,
  field: FactField,
  input: { itemId: string; quantity: unknown; reason: string },
): Promise<{ correctionId: string; state: DeliveryState }> {
  requireWriteCapable(ctx);
  const parsed = z.object({ itemId: idSchema, quantity: qty(), reason: reasonSchema }).safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "quantity");
      (fieldErrors[key] ??= []).push(key === "reason" ? "corrections.errors.reasonRequired" : "deliveries.errors.quantity");
    }
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  }
  const data = parsed.data;
  const { item, delivery, canManage } = await loadItem(ctx, data.itemId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const before = item[field];
  if (before === null) throw new AppError("CONFLICT", "deliveries.errors.nothingToCorrect");
  if (before === data.quantity) {
    throw new AppError("VALIDATION", "deliveries.errors.sameQuantity", { fieldErrors: { quantity: ["deliveries.errors.sameQuantity"] } });
  }
  return inTx(ctx, async (tx) => {
    const correctionId = await recordCorrection(tx, {
      occasionId: delivery.occasionId,
      targetTable: DELIVERY_ITEMS_TABLE,
      targetId: item.id,
      field,
      before,
      after: data.quantity,
      reason: data.reason,
    });
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    await tx.db.update(deliveryItems).set({ [field]: data.quantity }).where(eq(deliveryItems.id, item.id));
    await tx.db.execute(sql`select set_config('ed.correction', 'off', true)`);
    const state = await refreshState(tx, delivery.id);
    return { correctionId, state };
  });
}

/**
 * Corrects a received quantity that is already on record: writes the corrections row (before,
 * after, actor, reason — and through it the audit entry) and the new value in one transaction.
 * Managers only; a reason of at least 3 characters is required.
 */
export function correctReceivedQty(ctx: Ctx, input: { itemId: string; receivedQty: unknown; reason: string }): Promise<{ correctionId: string; state: DeliveryState }> {
  return correctFact(ctx, "receivedQty", { itemId: input.itemId, quantity: input.receivedQty, reason: input.reason });
}

/** Same as correctReceivedQty, for the returned quantity of a hired item. */
export function correctReturnedQty(ctx: Ctx, input: { itemId: string; returnedQty: unknown; reason: string }): Promise<{ correctionId: string; state: DeliveryState }> {
  return correctFact(ctx, "returnedQty", { itemId: input.itemId, quantity: input.returnedQty, reason: input.reason });
}

/** Correction history of one item's facts, oldest first. */
export async function listItemCorrections(ctx: Ctx, itemId: string): Promise<Correction[]> {
  const { item } = await loadItem(ctx, itemId);
  return ctx.db
    .select()
    .from(corrections)
    .where(and(eq(corrections.targetTable, DELIVERY_ITEMS_TABLE), eq(corrections.targetId, item.id)))
    .orderBy(asc(corrections.createdAt), asc(corrections.id));
}

/* ── Deposits (finance grant) ────────────────────────────────────────────────────── */

/** Sets or clears the deposit of an item (plan data, not a fact). Manager with finance grant. */
export async function setItemDeposit(ctx: Ctx, input: { itemId: string; deposit: string | null | undefined }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ itemId: idSchema, deposit: zMoneyText("deliveries.errors.amount") }).parse(input);
  const { item, delivery, canManage, canSeeMoney } = await loadItem(ctx, data.itemId);
  if (!canManage || !canSeeMoney) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await inTx(ctx, async (tx) => {
    await tx.db.update(deliveryItems).set({ depositMinor: data.deposit }).where(eq(deliveryItems.id, item.id));
    await audit(tx, {
      action: "delivery_item.deposit_set",
      objectType: "delivery_item",
      objectId: item.id,
      before: { depositMinor: item.depositMinor },
      after: { depositMinor: data.deposit },
      meta: { occasionId: delivery.occasionId },
    });
  });
}

/** Records that the deposit came back (a fact). Idempotent. Finance grant. */
export async function markDepositRecovered(ctx: Ctx, input: { itemId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { item, delivery, canSeeMoney } = await loadItem(ctx, input.itemId);
  if (!canSeeMoney) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (item.depositMinor === null) throw new AppError("CONFLICT", "deliveries.errors.noDeposit");
  if (item.depositRecoveredAt) return;
  await inTx(ctx, async (tx) => {
    const rows = await tx.db
      .update(deliveryItems)
      .set({ depositRecoveredAt: tx.now })
      .where(and(eq(deliveryItems.id, item.id), sql`${deliveryItems.depositRecoveredAt} is null`))
      .returning({ id: deliveryItems.id });
    if (!rows[0]) return;
    await audit(tx, {
      action: "delivery_item.deposit_recovered",
      objectType: "delivery_item",
      objectId: item.id,
      after: { depositRecoveredAt: tx.now },
      meta: { occasionId: delivery.occasionId },
    });
  });
}

/** Takes back "deposit recovered" — a fact, so only with a reason, as a correction. Finance grant. */
export async function correctDepositRecovered(ctx: Ctx, input: { itemId: string; reason: string }): Promise<{ correctionId: string }> {
  requireWriteCapable(ctx);
  const { item, delivery, canSeeMoney } = await loadItem(ctx, input.itemId);
  if (!canSeeMoney) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (!item.depositRecoveredAt) throw new AppError("CONFLICT", "deliveries.errors.nothingToCorrect");
  return inTx(ctx, async (tx) => {
    const correctionId = await recordCorrection(tx, {
      occasionId: delivery.occasionId,
      targetTable: DELIVERY_ITEMS_TABLE,
      targetId: item.id,
      field: "depositRecoveredAt",
      before: item.depositRecoveredAt,
      after: null,
      reason: input.reason,
    });
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    await tx.db.update(deliveryItems).set({ depositRecoveredAt: null }).where(eq(deliveryItems.id, item.id));
    await tx.db.execute(sql`select set_config('ed.correction', 'off', true)`);
    return { correctionId };
  });
}

/* ── Lifecycle (cancel / postpone preview) and closeout ──────────────────────────── */

registerLifecycleImpact({
  key: "deliveries.scheduled",
  async collect(ctx, occasionId, change) {
    if (change.kind === "close") return [];
    await supplierAccess(ctx, occasionId);
    const [o] = await ctx.db.execute<{ timezone: string }>(sql`select timezone from occasions where id = ${occasionId}`).then((r) => r.rows);
    const tz = o?.timezone ?? "Europe/Bucharest";
    const rows = await ctx.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.occasionId, occasionId), inArray(deliveries.state, ["expected", "partial"])))
      .orderBy(sql`${deliveries.expectedFrom} asc nulls last`);
    return rows.map((d) => ({
      key: `delivery:${d.id}`,
      what: d.title,
      kindLabelKey: "deliveries.lifecycle.kind",
      before: d.expectedFrom ? formatDay(d.expectedFrom, tz) : null,
      after: { key: change.kind === "cancel" ? "deliveries.lifecycle.toCancel" : "deliveries.lifecycle.toReschedule" },
    }));
  },
});

registerCloseoutSection({
  key: "deliveries.notReturned",
  titleKey: "deliveries.closeout.notReturned",
  async collect(ctx, occasionId) {
    await supplierAccess(ctx, occasionId);
    const rows = await ctx.db
      .select({ i: deliveryItems, d: deliveries })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
      .where(and(eq(deliveries.occasionId, occasionId), inArray(deliveries.kind, ["hire", "return"])))
      .orderBy(asc(deliveries.createdAt), asc(deliveryItems.position));
    return rows
      .filter(({ i }) => i.receivedQty !== null && (i.returnedQty ?? 0) < i.receivedQty)
      .map(({ i, d }) => ({
        key: `item:${i.id}`,
        label: {
          key: "deliveries.closeout.notReturnedLine",
          params: { label: i.label, delivery: d.title, left: (i.receivedQty ?? 0) - (i.returnedQty ?? 0) },
        },
      }));
  },
});

registerCloseoutSection({
  key: "deliveries.deposits",
  titleKey: "deliveries.closeout.deposits",
  async collect(ctx, occasionId) {
    const access = await supplierAccess(ctx, occasionId);
    if (!access.canSeeMoney) return [];
    const rows = await ctx.db
      .select({ i: deliveryItems, d: deliveries })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
      .where(and(eq(deliveries.occasionId, occasionId), sql`${deliveryItems.depositMinor} is not null`, sql`${deliveryItems.depositRecoveredAt} is null`))
      .orderBy(asc(deliveries.createdAt), asc(deliveryItems.position));
    return rows.map(({ i, d }) => ({
      key: `deposit:${i.id}`,
      label: { key: "deliveries.closeout.depositLine", params: { label: i.label, delivery: d.title } },
      amountMinor: i.depositMinor,
      currency: i.currency,
    }));
  },
});
