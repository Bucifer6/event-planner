"use server";

import {
  addDeliveryItem,
  correctDepositRecovered,
  correctReceivedQty,
  correctReturnedQty,
  createDelivery,
  deleteDelivery,
  markDepositRecovered,
  recordReceipt,
  recordReturn,
  removeDeliveryItem,
} from "@ed/core/deliveries";
import { getOccasion } from "@ed/core/occasions";
import { AppError } from "@ed/shared/errors";
import { zonedToUtc } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Planner actions for deliveries, hired items and returns (B6). Access checks and the
// "a recorded quantity changes only through a correction" rule live in @ed/core/deliveries.

const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");
const text = (max: number) => z.string().max(max).optional();

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;

/** Day + "HH:MM" in the occasion's zone → instants. Empty day = slot not agreed yet. */
function slot(day: string | undefined, from: string | undefined, to: string | undefined, tz: string): { expectedFrom: Date | null; expectedTo: Date | null } {
  const d = DAY_RE.exec((day ?? "").trim());
  const fieldErrors: Record<string, string[]> = {};
  if ((day ?? "").trim() !== "" && !d) fieldErrors.day = ["deliveries.errors.day"];
  const parse = (value: string | undefined, name: string): { hour: number; minute: number } | null => {
    const raw = (value ?? "").trim();
    if (raw === "") return null;
    const m = TIME_RE.exec(raw);
    if (!m) {
      fieldErrors[name] = ["deliveries.errors.time"];
      return null;
    }
    return { hour: Number(m[1]), minute: Number(m[2]) };
  };
  const f = parse(from, "fromTime");
  const t = parse(to, "toTime");
  if (!d && (f || t) && !fieldErrors.day) fieldErrors.day = ["deliveries.errors.dayForTime"];
  if (Object.keys(fieldErrors).length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  if (!d) return { expectedFrom: null, expectedTo: null };
  const at = (x: { hour: number; minute: number }) => zonedToUtc({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: x.hour, minute: x.minute }, tz);
  return { expectedFrom: at(f ?? { hour: 12, minute: 0 }), expectedTo: t ? at(t) : null };
}

export const createDeliveryAction = action(
  z.object({
    occasionId: zId,
    title: z.string().max(240),
    kind: z.enum(["delivery", "hire", "return"]).default("delivery"),
    supplierId: text(64),
    day: text(10),
    fromTime: text(5),
    toTime: text(5),
    place: text(400),
    itemLabel: text(240),
    itemQty: text(9),
    itemUnit: text(40),
    itemDeposit: text(40),
  }),
  async (ctx, input) => {
    const occasion = await getOccasion(ctx, input.occasionId);
    const when = slot(input.day, input.fromTime, input.toTime, occasion.timezone);
    const hasItem = (input.itemLabel ?? "").trim() !== "";
    const res = await createDelivery(ctx, {
      occasionId: input.occasionId,
      title: input.title,
      kind: input.kind,
      supplierId: input.supplierId || null,
      place: input.place,
      ...when,
      items: hasItem ? [{ label: input.itemLabel!, expectedQty: (input.itemQty ?? "").trim() === "" ? 1 : input.itemQty!, unit: input.itemUnit, deposit: input.itemDeposit }] : [],
    }).catch((e: unknown) => {
      // core reports item problems as items.0.<field>; the form's fields are item<Field>
      if (e instanceof z.ZodError) {
        const names: Record<string, string> = { "items.0.label": "itemLabel", "items.0.expectedQty": "itemQty", "items.0.unit": "itemUnit", "items.0.deposit": "itemDeposit" };
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of e.issues) {
          const path = issue.path.map(String).join(".");
          (fieldErrors[names[path] ?? path] ??= []).push(issue.message.includes(".") ? issue.message : "common.validation.invalid");
        }
        throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
      }
      throw e;
    });
    refresh(input.occasionId);
    return res;
  },
);

export const deleteDeliveryAction = action(z.object({ occasionId: zId, deliveryId: zId }), async (ctx, input) => {
  await deleteDelivery(ctx, { deliveryId: input.deliveryId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const addDeliveryItemAction = action(
  z.object({ occasionId: zId, deliveryId: zId, label: z.string().max(240), expectedQty: z.string().max(9), unit: text(40), deposit: text(40) }),
  async (ctx, input) => {
    const res = await addDeliveryItem(ctx, { deliveryId: input.deliveryId, label: input.label, expectedQty: input.expectedQty, unit: input.unit, deposit: input.deposit });
    refresh(input.occasionId);
    return res;
  },
);

export const removeDeliveryItemAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  await removeDeliveryItem(ctx, { itemId: input.itemId });
  refresh(input.occasionId);
  return { removed: true };
});

const blankQty = (value: string) => {
  if (value.trim() === "") throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { quantity: ["deliveries.errors.quantity"] } });
  return value.trim();
};

/** First recording of what arrived. A different number later is refused: use the correction. */
export const recordReceiptAction = action(z.object({ occasionId: zId, itemId: zId, quantity: z.string().max(9) }), async (ctx, input) => {
  const res = await recordReceipt(ctx, { itemId: input.itemId, receivedQty: blankQty(input.quantity) });
  refresh(input.occasionId);
  return res;
});

export const recordReturnAction = action(z.object({ occasionId: zId, itemId: zId, quantity: z.string().max(9) }), async (ctx, input) => {
  const res = await recordReturn(ctx, { itemId: input.itemId, returnedQty: blankQty(input.quantity) });
  refresh(input.occasionId);
  return res;
});

const correction = z.object({ occasionId: zId, itemId: zId, quantity: z.string().max(9), reason: z.string().max(1200) });

/** "Corectează cantitatea primită": the reason is required; core writes the corrections row. */
export const correctReceivedQtyAction = action(correction, async (ctx, input) => {
  const res = await correctReceivedQty(ctx, { itemId: input.itemId, receivedQty: input.quantity.trim() === "" ? "x" : input.quantity, reason: input.reason });
  refresh(input.occasionId);
  return res;
});

export const correctReturnedQtyAction = action(correction, async (ctx, input) => {
  const res = await correctReturnedQty(ctx, { itemId: input.itemId, returnedQty: input.quantity.trim() === "" ? "x" : input.quantity, reason: input.reason });
  refresh(input.occasionId);
  return res;
});

export const markDepositRecoveredAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  await markDepositRecovered(ctx, { itemId: input.itemId });
  refresh(input.occasionId);
  return { recovered: true };
});

export const correctDepositRecoveredAction = action(z.object({ occasionId: zId, itemId: zId, reason: z.string().max(1200) }), async (ctx, input) => {
  await correctDepositRecovered(ctx, { itemId: input.itemId, reason: input.reason });
  refresh(input.occasionId);
  return { corrected: true };
});
