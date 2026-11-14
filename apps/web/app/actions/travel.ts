"use server";

import { createLeg, deleteLeg, proposeItineraryImport, updateLeg } from "@ed/core/itinerary";
import { addLedgerEntry } from "@ed/core/ledger";
import { addPackingItem, createPackingList, deletePackingList, removePackingItem, setPackingItem } from "@ed/core/packing";
import { assignRoom, createRoom, deleteRoom, unassignRoom, updateRoom } from "@ed/core/rooms";
import { createActivity, createSubgroup, deleteActivity, deleteSubgroup, optInActivity, optOutActivity, setExchangeNote, setSubgroupPeople } from "@ed/core/subgroups";
import { claimSeat, createTransportLeg, deleteTransportLeg, setTransportPeople } from "@ed/core/transport";
import { AppError } from "@ed/shared/errors";
import { toMinor } from "@ed/shared/money";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Release D actions (itinerary, groups & activities, packing, transport, rooms, settlement).
// Every rule and access check is in @ed/core; these only shape form input and refresh pages.

const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");
const text = (max: number) => z.string().max(max).optional();
const many = z.preprocess((v) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(80)).max(500));

/** "45,50" → 4550 minor units; "" → undefined (unknown). Throws a field error on nonsense. */
function amount(value: string | undefined, field: string, currency = "RON"): number | undefined {
  const v = (value ?? "").trim();
  if (v === "") return undefined;
  try {
    const minor = toMinor(v.replace(/\s/g, ""), currency);
    if (minor < 0) throw new RangeError("negative");
    return minor;
  } catch {
    throw new AppError("VALIDATION", "travel.errors.amount", { fieldErrors: { [field]: ["travel.errors.amount"] } });
  }
}

const legShape = {
  kind: z.string().max(20).optional(),
  title: z.string().max(400),
  startsLocal: z.string().max(40),
  startTz: z.string().max(80),
  endsLocal: text(40),
  endTz: text(80),
  placeFrom: text(400),
  placeTo: text(400),
  reference: text(200),
  notes: text(4000),
  subgroupId: text(64),
};

export const createLegAction = action(z.object({ occasionId: zId, ...legShape }), async (ctx, input) => {
  const res = await createLeg(ctx, { ...input, kind: (input.kind || "other") as "other" });
  refresh(input.occasionId);
  return res;
});

export const updateLegAction = action(z.object({ occasionId: zId, legId: zId, ...legShape }), async (ctx, input) => {
  await updateLeg(ctx, { ...input, kind: (input.kind || "other") as "other" });
  refresh(input.occasionId);
  return { saved: true };
});

export const deleteLegAction = action(z.object({ occasionId: zId, legId: zId }), async (ctx, input) => {
  await deleteLeg(ctx, { legId: input.legId });
  refresh(input.occasionId);
  return { deleted: true };
});

/** Parses the pasted text / .ics content and opens a What-if preview. Nothing is created here. */
export const proposeImportAction = action(z.object({ occasionId: zId, text: z.string().max(400_000), defaultTz: text(80) }), async (ctx, input) => {
  const preview = await proposeItineraryImport(ctx, { occasionId: input.occasionId, text: input.text, defaultTz: input.defaultTz || undefined });
  refresh(input.occasionId);
  return { previewId: preview.id };
});

export const createSubgroupAction = action(z.object({ occasionId: zId, name: z.string().max(200), leadMemberId: text(64), leadEmail: text(300) }), async (ctx, input) => {
  const res = await createSubgroup(ctx, input);
  refresh(input.occasionId);
  return res;
});

export const setSubgroupPeopleAction = action(z.object({ occasionId: zId, subgroupId: zId, personKeys: many }), async (ctx, input) => {
  await setSubgroupPeople(ctx, { subgroupId: input.subgroupId, personKeys: input.personKeys });
  refresh(input.occasionId);
  return { saved: true };
});

export const deleteSubgroupAction = action(z.object({ occasionId: zId, subgroupId: zId }), async (ctx, input) => {
  await deleteSubgroup(ctx, { subgroupId: input.subgroupId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const createActivityAction = action(
  z.object({ occasionId: zId, title: z.string().max(400), startsLocal: text(40), endsLocal: text(40), tz: text(80), place: text(400), cost: text(40), currency: text(3), capacity: text(10), subgroupId: text(64), notes: text(4000) }),
  async (ctx, input) => {
    const { localToInstant } = await import("@ed/core/itinerary");
    const tz = input.tz || "Europe/Bucharest";
    const at = (v: string | undefined, field: string) => {
      if (!v) return undefined;
      const d = localToInstant(v, tz);
      if (!d) throw new AppError("VALIDATION", "travel.errors.dateTime", { fieldErrors: { [field]: ["travel.errors.dateTime"] } });
      return d;
    };
    const currency = (input.currency || "RON").toUpperCase();
    const res = await createActivity(ctx, {
      occasionId: input.occasionId,
      title: input.title,
      startsAt: at(input.startsLocal, "startsLocal"),
      endsAt: at(input.endsLocal, "endsLocal"),
      tz,
      place: input.place,
      costMinor: amount(input.cost, "cost", currency),
      currency,
      capacity: input.capacity,
      subgroupId: input.subgroupId,
      notes: input.notes,
    });
    refresh(input.occasionId);
    return res;
  },
);

export const deleteActivityAction = action(z.object({ occasionId: zId, activityId: zId }), async (ctx, input) => {
  await deleteActivity(ctx, { activityId: input.activityId });
  refresh(input.occasionId);
  return { deleted: true };
});

/** Atomic and idempotent: the loser of the last place gets TAKEN with the places left. */
export const optInAction = action(z.object({ occasionId: zId, activityId: zId, join: z.enum(["1", "0"]) }), async (ctx, input) => {
  const res = input.join === "1" ? await optInActivity(ctx, { activityId: input.activityId }) : await optOutActivity(ctx, { activityId: input.activityId });
  refresh(input.occasionId);
  return res;
});

export const createPackingListAction = action(z.object({ occasionId: zId, title: z.string().max(300), scope: z.enum(["occasion", "subgroup", "personal"]).optional(), subgroupId: text(64), template: text(20) }), async (ctx, input) => {
  const res = await createPackingList(ctx, { occasionId: input.occasionId, title: input.title, scope: input.scope ?? "personal", subgroupId: input.subgroupId, template: input.template });
  refresh(input.occasionId);
  return res;
});

export const addPackingItemAction = action(z.object({ occasionId: zId, taskId: zId, label: z.string().max(400) }), async (ctx, input) => {
  const res = await addPackingItem(ctx, { taskId: input.taskId, label: input.label });
  refresh(input.occasionId);
  return res;
});

export const setPackingItemAction = action(z.object({ occasionId: zId, itemId: zId, done: z.boolean() }), async (ctx, input) => {
  await setPackingItem(ctx, { itemId: input.itemId, done: input.done });
  refresh(input.occasionId);
  return { done: input.done };
});

export const removePackingItemAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  await removePackingItem(ctx, { itemId: input.itemId });
  refresh(input.occasionId);
  return { removed: true };
});

export const deletePackingListAction = action(z.object({ occasionId: zId, taskId: zId }), async (ctx, input) => {
  await deletePackingList(ctx, { taskId: input.taskId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const createTransportAction = action(
  z.object({ occasionId: zId, label: z.string().max(300), departsLocal: text(40), arrivesLocal: text(40), tz: text(80), placeFrom: text(400), placeTo: text(400), seats: text(10), notes: text(2000) }),
  async (ctx, input) => {
    const res = await createTransportLeg(ctx, { ...input, tz: input.tz || "Europe/Bucharest" });
    refresh(input.occasionId);
    return res;
  },
);

export const deleteTransportAction = action(z.object({ occasionId: zId, transportLegId: zId }), async (ctx, input) => {
  await deleteTransportLeg(ctx, { transportLegId: input.transportLegId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const setTransportPeopleAction = action(z.object({ occasionId: zId, transportLegId: zId, personKeys: many }), async (ctx, input) => {
  const res = await setTransportPeople(ctx, { transportLegId: input.transportLegId, personKeys: input.personKeys });
  refresh(input.occasionId);
  return res;
});

export const claimSeatAction = action(z.object({ occasionId: zId, transportLegId: zId }), async (ctx, input) => {
  const res = await claimSeat(ctx, { transportLegId: input.transportLegId });
  refresh(input.occasionId);
  return res;
});

const roomShape = { name: z.string().max(200), capacity: z.string().max(10), notes: text(2000), price: text(40), currency: text(3) };

export const createRoomAction = action(z.object({ occasionId: zId, ...roomShape }), async (ctx, input) => {
  const currency = (input.currency || "RON").toUpperCase();
  const res = await createRoom(ctx, { occasionId: input.occasionId, name: input.name, capacity: input.capacity, notes: input.notes, priceMinor: amount(input.price, "price", currency), currency });
  refresh(input.occasionId);
  return res;
});

export const updateRoomAction = action(z.object({ occasionId: zId, roomId: zId, ...roomShape }), async (ctx, input) => {
  const currency = (input.currency || "RON").toUpperCase();
  await updateRoom(ctx, { roomId: input.roomId, name: input.name, capacity: input.capacity, notes: input.notes, priceMinor: amount(input.price, "price", currency), currency });
  refresh(input.occasionId);
  return { saved: true };
});

export const deleteRoomAction = action(z.object({ occasionId: zId, roomId: zId }), async (ctx, input) => {
  await deleteRoom(ctx, { roomId: input.roomId });
  refresh(input.occasionId);
  return { deleted: true };
});

/** "Cazează aici": atomic; over capacity comes back as TAKEN with the beds left. */
export const assignRoomAction = action(z.object({ occasionId: zId, roomId: zId, personKeys: many }), async (ctx, input) => {
  if (input.personKeys.length === 0) throw new AppError("VALIDATION", "travel.errors.pickPeople", { fieldErrors: { personKeys: ["travel.errors.pickPeople"] } });
  const res = await assignRoom(ctx, { roomId: input.roomId, personKeys: input.personKeys });
  refresh(input.occasionId);
  return res;
});

export const unassignRoomAction = action(z.object({ occasionId: zId, roomId: zId, personKey: z.string().max(80) }), async (ctx, input) => {
  await unassignRoom(ctx, { roomId: input.roomId, personKey: input.personKey });
  refresh(input.occasionId);
  return { removed: true };
});

/** A shared cost in ANY currency, split evenly between the ticked participants (the one ledger, B3). */
export const addTripCostAction = action(
  z.object({ occasionId: zId, idempotencyKey: z.string().max(200), description: z.string().max(500), amount: text(40), currency: text(3), currencyOther: text(8), paidBy: z.string().max(64), occurredOn: z.string().max(10), participantIds: many }),
  async (ctx, input) => {
    const typed = (input.currencyOther ?? "").trim().toUpperCase();
    const currency = typed !== "" ? typed : (input.currency || "RON").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new AppError("VALIDATION", "travel.errors.currency", { fieldErrors: { currencyOther: ["travel.errors.currency"] } });
    const amountMinor = amount(input.amount, "amount", currency);
    if (amountMinor === undefined || amountMinor === 0) throw new AppError("VALIDATION", "travel.errors.amount", { fieldErrors: { amount: ["travel.errors.amount"] } });
    if (input.participantIds.length === 0) throw new AppError("VALIDATION", "travel.errors.pickPeople", { fieldErrors: { participantIds: ["travel.errors.pickPeople"] } });
    const entry = await addLedgerEntry(ctx, {
      occasionId: input.occasionId,
      description: input.description,
      amountMinor,
      currency,
      paidByParticipantId: input.paidBy,
      occurredOn: input.occurredOn,
      split: { mode: "even", participantIds: input.participantIds },
      idempotencyKey: input.idempotencyKey,
    });
    refresh(input.occasionId);
    return { id: entry.id };
  },
);

export const setExchangeNoteAction = action(z.object({ occasionId: zId, currency: z.string().max(3), note: text(400) }), async (ctx, input) => {
  await setExchangeNote(ctx, { occasionId: input.occasionId, currency: input.currency, note: input.note });
  refresh(input.occasionId);
  return { saved: true };
});
