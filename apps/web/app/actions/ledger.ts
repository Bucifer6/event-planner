"use server";

import {
  addLedgerEntry,
  addParticipant,
  recordSettlement,
  removeParticipant,
  voidLedgerEntry,
  type SplitInput,
} from "@ed/core/ledger";
import { instantToDay } from "@ed/core/templates";
import { AppError, isAppError } from "@ed/shared/errors";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount, requireAmount } from "@/app/(app)/occasions/[id]/budget/_lib/money";
import { action } from "@/lib/action";

// Shared-cost ledger actions (B3). The finance-grant check and the balance rules live in
// @ed/core/ledger; these read the split out of the form.

const id = z.string().min(1).max(64);
const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");

export const addLedgerParticipant = action(
  z.object({
    occasionId: id,
    kind: z.enum(["member", "household", "other"]),
    memberId: z.string().max(64).optional(),
    householdId: z.string().max(64).optional(),
    name: z.string().max(500).optional(),
  }),
  async (ctx, input) => {
    const p = await addParticipant(ctx, {
      occasionId: input.occasionId,
      kind: input.kind,
      memberId: input.kind === "member" ? input.memberId || undefined : undefined,
      householdId: input.kind === "household" ? input.householdId || undefined : undefined,
      name: input.kind === "other" ? input.name : undefined,
    });
    refresh(input.occasionId);
    return { id: p.id };
  },
);

export const removeLedgerParticipant = action(z.object({ occasionId: id, participantId: id }), async (ctx, input) => {
  await removeParticipant(ctx, { participantId: input.participantId });
  refresh(input.occasionId);
  return { removed: true };
});

/**
 * The split arrives as one field per participant: `in_<id>` (ticked = benefits, even split),
 * `w_<id>` (shares) or `x_<id>` (exact amount). An exact split that does not add up comes back
 * as an error beside the split, saying the difference.
 */
export const addSharedCost = action(
  z.looseObject({
    occasionId: id,
    idempotencyKey: z.string().max(200),
    description: z.string().max(500),
    amount: z.string().max(2000).optional(),
    occurredOn: z.string().max(10),
    paidBy: z.string().max(64),
    mode: z.enum(["even", "shares", "exact"]),
  }),
  async (ctx, input) => {
    const amountMinor = requireAmount(input.amount, "amount", "ledger");
    const fields = Object.entries(input as Record<string, unknown>);
    const pick = (prefix: string) =>
      fields.filter(([k, v]) => k.startsWith(prefix) && typeof v === "string").map(([k, v]) => [k.slice(prefix.length), v as string] as const);
    const splitError = (key: string): never => {
      throw new AppError("VALIDATION", key, { fieldErrors: { split: [key] } });
    };
    let split: SplitInput;
    if (input.mode === "even") {
      split = { mode: "even", participantIds: pick("in_").map(([pid]) => pid) };
    } else if (input.mode === "shares") {
      split = {
        mode: "shares",
        shares: pick("w_").map(([participantId, v]) => {
          const weight = v.trim() === "" ? 0 : Number(v);
          if (!Number.isInteger(weight) || weight < 0) splitError("ledger.errors.badShares");
          return { participantId, weight };
        }),
      };
    } else {
      split = {
        mode: "exact",
        amounts: pick("x_").map(([participantId, v]) => {
          const parsed = parseAmount(v);
          if (parsed === "invalid") splitError("budget.errors.amountInvalid");
          return { participantId, amountMinor: (parsed as number | null) ?? 0 };
        }),
      };
    }
    try {
      const entry = await addLedgerEntry(ctx, {
        occasionId: input.occasionId,
        description: input.description,
        amountMinor,
        paidByParticipantId: input.paidBy,
        occurredOn: input.occurredOn,
        split,
        idempotencyKey: input.idempotencyKey,
      });
      refresh(input.occasionId);
      return { id: entry.id };
    } catch (e) {
      // put the message WITH its numbers (the difference) beside the split field
      if (isAppError(e) && e.details?.fieldErrors?.split && e.details.params) {
        const t = await getTranslations();
        const message = t(e.messageKey as never, e.details.params as never);
        throw new AppError("VALIDATION", e.messageKey, { params: e.details.params, fieldErrors: { split: [message] } });
      }
      throw e;
    }
  },
);

/** "Înregistrează plata" beside a suggested transfer: a settle-up entry, dated today. */
export const settleTransfer = action(
  z.object({
    occasionId: id,
    fromParticipantId: id,
    toParticipantId: id,
    amountMinor: z.coerce.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    idempotencyKey: z.string().max(200),
  }),
  async (ctx, input) => {
    const entry = await recordSettlement(ctx, { ...input, occurredOn: instantToDay(ctx.now, "Europe/Bucharest") });
    refresh(input.occasionId);
    return { id: entry.id };
  },
);

export const voidEntry = action(z.object({ occasionId: id, entryId: id, reason: z.string().max(2000) }), async (ctx, input) => {
  await voidLedgerEntry(ctx, { entryId: input.entryId, reason: input.reason });
  refresh(input.occasionId);
  return { voided: true };
});
