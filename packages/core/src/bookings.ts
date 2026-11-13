import { asc, bookingEvents, bookings, bookingStateSchema, eq, BOOKING_STATES, type BookingState } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { getAsset, getAssetUrl, registerUploadPurpose } from "@ed/storage";
import { z } from "zod";
import { audit } from "./audit";
import { actorRef, requireWriteCapable, type Ctx } from "./context";
import { loadBooking, zMoneyText, type Booking } from "./suppliers";
import { inTx } from "./tx";

// Bookings (B4, P12): the state of the agreement with one supplier.
//
//   enquired → quoted → booked → confirmed → delivered        (and cancelled, from anywhere)
//
// The planner may move a booking to any state (real life skips steps and goes back); what is
// never optional is the record: EVERY transition writes a booking_events row (who, when, from,
// to) and an audit entry, in the same transaction.

export { BOOKING_STATES };
export type { Booking, BookingState };
export type BookingEvent = typeof bookingEvents.$inferSelect;

/** The path shown as a stepper; "cancelled" sits beside it. */
export const BOOKING_PATH: BookingState[] = ["enquired", "quoted", "booked", "confirmed", "delivered"];

/** Web upload purpose for a quote: a PDF (or a photo of one) owned by the occasion (P12). */
export const QUOTE_UPLOAD_PURPOSE = "occasion.quote";
registerUploadPurpose(QUOTE_UPLOAD_PURPOSE, { ownerType: "occasion", allowPdf: true });

const idSchema = z.string().min(1).max(64);

async function recordTransition(
  tx: Ctx,
  booking: Pick<Booking, "id" | "occasionId" | "state">,
  to: BookingState,
  note: string | null,
): Promise<void> {
  const ref = actorRef(tx.actor);
  await tx.db.insert(bookingEvents).values({
    bookingId: booking.id,
    occasionId: booking.occasionId,
    fromState: booking.state,
    toState: to,
    actorKind: ref.kind,
    actorId: ref.id,
    note,
    at: tx.now,
  });
  await audit(tx, {
    action: "booking.state_changed",
    objectType: "booking",
    objectId: booking.id,
    before: { state: booking.state },
    after: { state: to },
    meta: { occasionId: booking.occasionId, ...(note ? { note } : {}) },
  });
}

const stateInput = z.object({
  bookingId: idSchema,
  state: bookingStateSchema,
  note: z.string().trim().max(500).optional(),
});

/** Moves the booking to a state. Idempotent: the same state again records nothing. Managers. */
export async function setBookingState(ctx: Ctx, input: z.input<typeof stateInput>): Promise<{ state: BookingState; changed: boolean }> {
  requireWriteCapable(ctx);
  const data = stateInput.parse(input);
  const { booking, canManage } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (booking.state === data.state) return { state: booking.state, changed: false };
  return inTx(ctx, async (tx) => {
    // conditional update: two people tapping at once record one transition each, in order
    const rows = await tx.db
      .update(bookings)
      .set({ state: data.state })
      .where(eq(bookings.id, booking.id))
      .returning({ id: bookings.id });
    if (!rows[0]) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    await recordTransition(tx, booking, data.state, data.note || null);
    return { state: data.state, changed: true };
  });
}

/** Every transition of the booking, oldest first. */
export async function listBookingEvents(ctx: Ctx, bookingId: string): Promise<BookingEvent[]> {
  const { booking } = await loadBooking(ctx, bookingId);
  return ctx.db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, booking.id)).orderBy(asc(bookingEvents.at), asc(bookingEvents.id));
}

const termsInput = z.object({
  bookingId: idSchema,
  /** Text from the form; empty = unknown. Only read when the actor holds the finance grant. */
  agreedAmount: zMoneyText("suppliers.errors.amount").optional(),
  notes: z
    .string()
    .max(2000, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

/**
 * Notes and the agreed amount. The amount is finance data (D2): it is changed only by a
 * manager who holds the finance grant; without the grant the field is ignored, never zeroed.
 */
export async function updateBookingTerms(ctx: Ctx, input: z.input<typeof termsInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = termsInput.parse(input);
  const { booking, canManage, canSeeMoney } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const setAmount = canSeeMoney && data.agreedAmount !== undefined;
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(bookings)
      .set({ notes: data.notes, ...(setAmount ? { agreedMinor: data.agreedAmount } : {}) })
      .where(eq(bookings.id, booking.id));
    await audit(tx, {
      action: "booking.updated",
      objectType: "booking",
      objectId: booking.id,
      before: setAmount ? { agreedMinor: booking.agreedMinor } : undefined,
      after: setAmount ? { agreedMinor: data.agreedAmount } : undefined,
      meta: { occasionId: booking.occasionId },
    });
  });
}

/**
 * Attaches an uploaded file as the booking's quote (P12). The asset must belong to this
 * occasion. A booking still at "enquired" becomes "quoted" — recorded like any transition.
 */
export async function attachQuote(ctx: Ctx, input: { bookingId: string; assetId: string }): Promise<{ state: BookingState }> {
  requireWriteCapable(ctx);
  const data = z.object({ bookingId: idSchema, assetId: idSchema }).parse(input);
  const { booking, canManage } = await loadBooking(ctx, data.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const asset = await getAsset(ctx, data.assetId).catch(() => null);
  if (!asset || asset.ownerType !== "occasion" || asset.ownerId !== booking.occasionId) {
    throw new AppError("VALIDATION", "suppliers.errors.quoteFile", { fieldErrors: { assetId: ["suppliers.errors.quoteFile"] } });
  }
  return inTx(ctx, async (tx) => {
    const next: BookingState = booking.state === "enquired" ? "quoted" : booking.state;
    await tx.db.update(bookings).set({ quoteAssetId: asset.id, state: next }).where(eq(bookings.id, booking.id));
    await audit(tx, {
      action: "booking.quote_attached",
      objectType: "booking",
      objectId: booking.id,
      after: { quoteAssetId: asset.id },
      meta: { occasionId: booking.occasionId },
    });
    if (next !== booking.state) await recordTransition(tx, booking, next, null);
    return { state: next };
  });
}

/** Detaches the quote file from the booking (the file itself stays in the occasion's files). */
export async function removeQuote(ctx: Ctx, input: { bookingId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const { booking, canManage } = await loadBooking(ctx, input.bookingId);
  if (!canManage) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  if (!booking.quoteAssetId) return;
  await inTx(ctx, async (tx) => {
    await tx.db.update(bookings).set({ quoteAssetId: null }).where(eq(bookings.id, booking.id));
    await audit(tx, {
      action: "booking.quote_removed",
      objectType: "booking",
      objectId: booking.id,
      before: { quoteAssetId: booking.quoteAssetId },
      meta: { occasionId: booking.occasionId },
    });
  });
}

/** Short-lived download link of the quote, or null when there is none (or it was removed). */
export async function getQuoteLink(ctx: Ctx, bookingId: string): Promise<{ url: string; name: string } | null> {
  const { booking } = await loadBooking(ctx, bookingId);
  if (!booking.quoteAssetId) return null;
  try {
    const asset = await getAsset(ctx, booking.quoteAssetId);
    return { url: await getAssetUrl(ctx, asset.id), name: asset.name };
  } catch {
    return null;
  }
}
