"use server";

import { checkInByQr, checkInHousehold, correctCheckIn } from "@ed/core/checkin";
import { resolveOfflineConflict } from "@ed/core/offline";
import { createSustainabilityGoal, deleteSustainabilityGoal, recordMeasurement } from "@ed/core/sustainability";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Release E actions (check-in, corrections, offline conflicts, sustainability). The rehearsal
// has no action at all: it is read-only by construction.

const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}/operate`, "layout");
const text = (max: number) => z.string().max(max).optional();
const count = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().min(0).max(200).optional());

/** Scan result or typed code → arrival. Idempotent: a second scan answers `already: true`. */
export const checkInByQrAction = action(z.object({ occasionId: zId, qrId: z.string().max(600) }), async (ctx, input) => {
  const res = await checkInByQr(ctx, { occasionId: input.occasionId, qrId: input.qrId });
  refresh(input.occasionId);
  return { ...res, arrivedAt: res.arrivedAt.toISOString() };
});

export const checkInHouseholdAction = action(z.object({ occasionId: zId, householdId: z.string().max(64), adults: count, children: count }), async (ctx, input) => {
  const res = await checkInHousehold(ctx, { occasionId: input.occasionId, householdId: input.householdId, adults: input.adults, children: input.children, source: "search" });
  refresh(input.occasionId);
  return { ...res, arrivedAt: res.arrivedAt.toISOString() };
});

/** The only way to change a recorded arrival: counts and / or un-check, with a reason. */
export const correctCheckInAction = action(z.object({ occasionId: zId, checkInId: z.string().max(64), adults: count, children: count, undo: text(5), reason: z.string().max(1200) }), async (ctx, input) => {
  const res = await correctCheckIn(ctx, { checkInId: input.checkInId, adults: input.adults, children: input.children, undo: input.undo === "on" || input.undo === "1", reason: input.reason });
  refresh(input.occasionId);
  return res;
});

export const resolveConflictAction = action(z.object({ occasionId: zId, offlineItemId: z.string().max(64), decision: z.enum(["apply", "drop"]) }), async (ctx, input) => {
  const res = await resolveOfflineConflict(ctx, { offlineItemId: input.offlineItemId, decision: input.decision });
  refresh(input.occasionId);
  return res;
});

export const createGoalAction = action(z.object({ occasionId: zId, metric: z.string().max(40), label: text(200), targetValue: text(40), unit: text(40), direction: text(20), aggregate: text(20) }), async (ctx, input) => {
  const res = await createSustainabilityGoal(ctx, { ...input, metric: input.metric as "custom" });
  refresh(input.occasionId);
  return res;
});

export const deleteGoalAction = action(z.object({ occasionId: zId, goalId: z.string().max(64) }), async (ctx, input) => {
  await deleteSustainabilityGoal(ctx, { goalId: input.goalId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const recordMeasurementAction = action(z.object({ occasionId: zId, goalId: z.string().max(64), value: text(40), unknown: text(5), note: text(600) }), async (ctx, input) => {
  const res = await recordMeasurement(ctx, { goalId: input.goalId, value: input.value, unknown: input.unknown, note: input.note });
  refresh(input.occasionId);
  return res;
});
