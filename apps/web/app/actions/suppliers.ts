"use server";

import { attachQuote, removeQuote, setBookingState, updateBookingTerms } from "@ed/core/bookings";
import { acknowledgeBriefing, publishBriefing } from "@ed/core/briefings";
import { createOrderSnapshot } from "@ed/core/orders";
import {
  addPaymentDeadline,
  correctPaymentPaid,
  markPaymentPaid,
  proposeMovePayment,
  removePaymentDeadline,
} from "@ed/core/payments";
import {
  createSupplier,
  createSupplierLink,
  deleteSupplier,
  revokeSupplierLink,
  updateSupplier,
} from "@ed/core/suppliers";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { runSupplierAction, supplierFormFields } from "@/lib/supplier-link";

// Planner actions for suppliers, bookings, briefings, final orders, payment deadlines and the
// supplier link (B4, B5, B12), plus the one public action of the supplier link itself.
// Every access check lives in @ed/core; these only parse the form and refresh the pages.

const refresh = (occasionId: string) => revalidatePath(`/occasions/${occasionId}`, "layout");
const text = (max: number) => z.string().max(max).optional();

const supplierForm = {
  name: z.string().max(200),
  categoryLabel: text(120),
  contactName: text(200),
  contactEmail: text(300),
  contactPhone: text(60),
  notes: text(2400),
};

export const createSupplierAction = action(z.object({ occasionId: zId, ...supplierForm }), async (ctx, input) => {
  const res = await createSupplier(ctx, input);
  refresh(input.occasionId);
  return res;
});

export const updateSupplierAction = action(z.object({ occasionId: zId, supplierId: zId, ...supplierForm }), async (ctx, input) => {
  const { occasionId, ...rest } = input;
  await updateSupplier(ctx, rest);
  refresh(occasionId);
  return { saved: true };
});

export const deleteSupplierAction = action(z.object({ occasionId: zId, supplierId: zId }), async (ctx, input) => {
  await deleteSupplier(ctx, { supplierId: input.supplierId });
  refresh(input.occasionId);
  return { deleted: true };
});

export const setBookingStateAction = action(
  z.object({ occasionId: zId, bookingId: zId, state: z.enum(["enquired", "quoted", "booked", "confirmed", "delivered", "cancelled"]) }),
  async (ctx, input) => {
    const res = await setBookingState(ctx, { bookingId: input.bookingId, state: input.state });
    refresh(input.occasionId);
    return res;
  },
);

export const updateBookingTermsAction = action(
  z.object({ occasionId: zId, bookingId: zId, agreedAmount: text(40), notes: text(2400) }),
  async (ctx, input) => {
    await updateBookingTerms(ctx, { bookingId: input.bookingId, agreedAmount: input.agreedAmount, notes: input.notes });
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const attachQuoteAction = action(z.object({ occasionId: zId, bookingId: zId, assetId: zId }), async (ctx, input) => {
  const res = await attachQuote(ctx, { bookingId: input.bookingId, assetId: input.assetId });
  refresh(input.occasionId);
  return res;
});

export const removeQuoteAction = action(z.object({ occasionId: zId, bookingId: zId }), async (ctx, input) => {
  await removeQuote(ctx, { bookingId: input.bookingId });
  refresh(input.occasionId);
  return { removed: true };
});

export const publishBriefingAction = action(
  z.object({
    occasionId: zId,
    bookingId: zId,
    what: text(2400),
    when: text(600),
    where: text(600),
    contacts: text(1200),
    specialNotes: text(2400),
    freeText: text(7000),
  }),
  async (ctx, input) => {
    const { occasionId, ...rest } = input;
    const res = await publishBriefing(ctx, rest);
    refresh(occasionId);
    return res;
  },
);

const orderItems = z
  .string()
  .max(40_000)
  .transform((raw, c) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Array<{ label: string; quantity: number | string; unit?: string; note?: string }>;
    } catch {
      // falls through to the issue below
    }
    c.addIssue({ code: "custom", message: "suppliers.errors.itemsRequired" });
    return z.NEVER;
  });

export const createOrderSnapshotAction = action(z.object({ occasionId: zId, bookingId: zId, items: orderItems }), async (ctx, input) => {
  // rows the planner left completely empty are not part of the order
  const items = input.items.filter((i) => `${i.label ?? ""}`.trim() !== "" || `${i.quantity ?? ""}`.trim() !== "");
  const res = await createOrderSnapshot(ctx, { bookingId: input.bookingId, items });
  refresh(input.occasionId);
  return res;
});

/* ── Payment deadlines (finance grant, checked in core) ─────────────────── */

export const addPaymentDeadlineAction = action(
  z.object({ occasionId: zId, bookingId: zId, kind: z.enum(["advance", "instalment", "final"]), dueOn: z.string().max(10), amount: text(40), note: text(400) }),
  async (ctx, input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
      throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { dueOn: ["suppliers.errors.dueOn"] } });
    }
    const res = await addPaymentDeadline(ctx, { bookingId: input.bookingId, kind: input.kind, dueOn: input.dueOn, amount: input.amount, note: input.note });
    refresh(input.occasionId);
    return res;
  },
);

export const removePaymentDeadlineAction = action(z.object({ occasionId: zId, deadlineId: zId }), async (ctx, input) => {
  await removePaymentDeadline(ctx, { deadlineId: input.deadlineId });
  refresh(input.occasionId);
  return { removed: true };
});

export const markPaymentPaidAction = action(z.object({ occasionId: zId, deadlineId: zId }), async (ctx, input) => {
  await markPaymentPaid(ctx, { deadlineId: input.deadlineId });
  refresh(input.occasionId);
  return { paid: true };
});

export const correctPaymentPaidAction = action(z.object({ occasionId: zId, deadlineId: zId, reason: z.string().max(1200) }), async (ctx, input) => {
  await correctPaymentPaid(ctx, { deadlineId: input.deadlineId, reason: input.reason });
  refresh(input.occasionId);
  return { corrected: true };
});

/** Creates the What-if preview of moving a payment; the page then shows it for confirmation. */
export const proposeMovePaymentAction = action(z.object({ occasionId: zId, deadlineId: zId, dueOn: z.string().max(10) }), async (ctx, input) => {
  const preview = await proposeMovePayment(ctx, { deadlineId: input.deadlineId, dueOn: input.dueOn });
  refresh(input.occasionId);
  return { previewId: preview.id };
});

/* ── Supplier link ──────────────────────────────────────────────────────── */

/** A new link for the booking; an older one stops working. The path is returned ONCE. */
export const createSupplierLinkAction = action(
  z.object({ occasionId: zId, bookingId: zId, language: z.enum(["ro", "en"]).optional() }),
  async (ctx, input) => {
    const res = await createSupplierLink(ctx, { bookingId: input.bookingId, language: input.language });
    refresh(input.occasionId);
    return { path: res.path };
  },
);

export const revokeSupplierLinkAction = action(z.object({ occasionId: zId, bookingId: zId }), async (ctx, input) => {
  await revokeSupplierLink(ctx, { bookingId: input.bookingId });
  refresh(input.occasionId);
  return { revoked: true };
});

/** PUBLIC — the supplier's "Am primit și am înțeles briefingul" (token + bot guard, no account). */
export async function acknowledgeBriefingAction(...args: unknown[]) {
  return runSupplierAction(args, {
    schema: z.object({ ...supplierFormFields, versionId: zId, name: z.string().max(200) }),
    formKey: "supplier_ack",
    handler: async (ctx, input) => {
      const res = await acknowledgeBriefing(ctx, { token: input.token, versionId: input.versionId, name: input.name });
      revalidatePath(`/s/${input.token}`);
      return { version: res.version, name: res.name, at: res.at.toISOString(), alreadyAcknowledged: res.alreadyAcknowledged };
    },
  });
}
