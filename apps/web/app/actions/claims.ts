"use server";

import { cancelClaim, startClaim, verifyClaimCode } from "@ed/core/claims";
import { submitObjection } from "@ed/core/discovery";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Public claim flow (P30) and the removal / objection form (BD6). Claiming needs an account
// (the action wrapper refuses anyone signed out); the removal form is public and guarded by
// the honeypot, the render stamp and per-IP / per-listing limits inside core (SEC11).

export const startClaimAction = action(z.object({ listingId: zId, businessName: z.string().max(200).optional(), statement: z.string().max(1200).optional() }), async (ctx, input) => {
  const res = await startClaim(ctx, input);
  revalidatePath(`/claim/${input.listingId}`);
  return res;
});

/** Asks for a fresh code on the open claim (the same call as starting: core reuses the open claim). */
export const resendClaimCodeAction = action(z.object({ listingId: zId }), async (ctx, input) => {
  const res = await startClaim(ctx, { listingId: input.listingId });
  revalidatePath(`/claim/${input.listingId}`);
  return res;
});

export const verifyClaimCodeAction = action(z.object({ listingId: zId, claimId: z.string().max(64), code: z.string().max(12).default("") }), async (ctx, input) => {
  const res = await verifyClaimCode(ctx, { claimId: input.claimId, code: input.code });
  revalidatePath(`/claim/${input.listingId}`);
  return res;
});

export const cancelClaimAction = action(z.object({ listingId: zId, claimId: z.string().max(64) }), async (ctx, input) => {
  await cancelClaim(ctx, { claimId: input.claimId });
  revalidatePath(`/claim/${input.listingId}`);
  return { cancelled: true };
});

export const submitObjectionAction = action(
  z.object({
    listingId: zId,
    kind: z.enum(["removal", "objection", "correction"], "common.validation.required"),
    message: z.string().max(2200).optional(),
    contactEmail: z.string().max(320).optional(),
    token: z.string().max(200).optional(),
    [HONEYPOT_FIELD]: z.string().max(500).optional(),
    [FORM_STAMP_FIELD]: z.string().max(200).optional(),
  }),
  async (ctx, input) => {
    const res = await submitObjection(ctx, {
      listingId: input.listingId,
      kind: input.kind,
      message: input.message,
      contactEmail: input.contactEmail,
      token: input.token || null,
      honeypot: input[HONEYPOT_FIELD],
      renderedAt: input[FORM_STAMP_FIELD],
    });
    return { honoured: res.honoured };
  },
  { auth: "public" },
);
