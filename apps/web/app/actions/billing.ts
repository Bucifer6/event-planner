"use server";

import { cancelSubscription, createCheckoutSession, createSandboxCheckout, requestPriceChange, requestRefund, setMonthlyCost } from "@ed/core/billing";
import { recordBillingAcceptance, requestMonetizationDisable, requestMonetizationEnable } from "@ed/core/monetization";
import { subscriptionPlanSchema } from "@ed/db";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action } from "@/lib/action";
import { staffAction } from "@/app/console/_lib";

// Commercial console (W6) and the DORMANT purchase actions (P24–P26, MON1–MON4).
// MON1: while the monetization switch is off, startCheckoutAction and
// cancelSubscriptionAction answer "not found" (the guard is assertMonetizationOn in
// @ed/core/billing) and no page renders a form that posts to them.

const PATH = "/console/commercial";
const reason = z.string().max(1000);

/** "20000" or "199,50" (RON) → bani. */
const zRon = z
  .string()
  .trim()
  .regex(/^\d{1,9}([.,]\d{1,2})?$/, "billing.errors.amount")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));
const zPercent = z
  .string()
  .trim()
  .regex(/^\d{1,2}([.,]\d{1,2})?$/, "billing.errors.percent")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));

export const recordAcceptanceAction = staffAction(z.object({ evidenceRef: z.string().max(300), notes: z.string().max(2000).optional() }), async (ctx, input) => {
  await recordBillingAcceptance(ctx, input);
  revalidatePath(PATH);
  return { recorded: true };
});

export const requestEnableAction = staffAction(z.object({ reason }), async (ctx, input) => {
  await requestMonetizationEnable(ctx, input);
  revalidatePath(PATH);
  return { requested: true };
});

export const requestDisableAction = staffAction(z.object({ reason }), async (ctx, input) => {
  await requestMonetizationDisable(ctx, input);
  revalidatePath(PATH);
  return { requested: true };
});

export const setMonthlyCostAction = staffAction(z.object({ amount: zRon }), async (ctx, input) => {
  await setMonthlyCost(ctx, { minor: input.amount });
  revalidatePath(PATH);
  return { saved: true };
});

export const requestPriceChangeAction = staffAction(z.object({ businessMonthly: zRon, businessYearly: zRon, featuredMonthly: zRon, tva: zPercent, reason }), async (ctx, input) => {
  await requestPriceChange(ctx, {
    prices: { businessMonthlyMinor: input.businessMonthly, businessYearlyMinor: input.businessYearly, featuredMonthlyMinor: input.featuredMonthly, tvaRateBp: input.tva },
    reason: input.reason,
  });
  revalidatePath(PATH);
  return { requested: true };
});

export const requestRefundAction = staffAction(z.object({ subscriptionId: z.string().min(1, "common.validation.required").max(64), kind: z.enum(["refund", "credit"], "common.validation.required"), amount: zRon, reason }), async (ctx, input) => {
  await requestRefund(ctx, { subscriptionId: input.subscriptionId, kind: input.kind, amountMinor: input.amount, reason: input.reason });
  revalidatePath(PATH);
  return { requested: true };
});

/** W6: the test-mode run behind the MON4 acceptance. Returns the processor's test checkout link. */
export const sandboxCheckoutAction = staffAction(z.object({ businessId: z.string().min(1, "common.validation.required").max(64), plan: subscriptionPlanSchema }), async (ctx, input) => {
  // a Featured test run is placed by hand in the console instead (it needs a listing and a category)
  if (input.plan === "featured_monthly") return { url: null as string | null };
  return { url: (await createSandboxCheckout(ctx, { businessId: input.businessId, plan: input.plan })).url as string | null };
});

/** A business starts a purchase. Exists only while monetization is ON; "not found" otherwise. */
export const startCheckoutAction = action(
  z.object({ businessId: zId, plan: subscriptionPlanSchema, listingId: z.string().max(64).optional(), categoryId: z.string().max(64).optional(), countyCode: z.string().max(3).optional() }),
  async (ctx, input) => {
    const { url } = await createCheckoutSession(ctx, {
      businessId: input.businessId,
      plan: input.plan,
      listingId: input.listingId || undefined,
      categoryId: input.categoryId || undefined,
      countyCode: input.countyCode || undefined,
    });
    redirect(url);
  },
);

export const cancelSubscriptionAction = action(z.object({ businessId: zId, subscriptionId: zId }), async (ctx, input) => {
  await cancelSubscription(ctx, { subscriptionId: input.subscriptionId });
  revalidatePath(`/business/${input.businessId}/plan`);
  return { requested: true };
});
