import { createHmac, timingSafeEqual } from "node:crypto";
import {
  and,
  businesses,
  desc,
  eq,
  featuredSlots,
  inArray,
  invoices,
  isNull,
  lt,
  processorEvents,
  refundRequests,
  sql,
  subscriptionPlanSchema,
  subscriptions,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@ed/db";
import { defineJob, defineSchedule, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { addDays } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { registerApprovalAction, requestApproval, type ApprovalRequest } from "./approvals";
import { audit } from "./audit";
import { requireBusinessMember } from "./business";
import { requireSystem, type Ctx } from "./context";
import { assertMonetizationOn, getMonetizationState, isMonetizationOn, MONETIZATION_ROLES, PERMANENT_FREE_TIER, BUSINESS_PLAN_CAPABILITIES, type MonetizationView } from "./monetization";
import { isSingleOperatorMode, readSetting, requireStaffRole, writeSetting } from "./staff";
import { inTx } from "./tx";

// DORMANT billing (P24–P26, PAY1–PAY5, MON1, MON3). Built, tested, not enabled.
//
//   getPrices / priceWithTva                 operator-set prices (console settings), TVA apart
//   createCheckoutSession(ctx, …)            ONLY while monetization is ON and a key is set
//   createSandboxCheckout(staffCtx, …)       W6: the test-mode run behind the MON4 acceptance
//   verifyStripeSignature / handleStripeWebhook   P24: the ONLY writer of `subscriptions`
//   runBillingSweep(systemCtx)               P25: grace → lapse, cancel at period end → lapse
//   requestRefund(staffCtx, …)               P26: request + a second person ("billing.refund")
//   getPlanView(ctx, businessId)             what the business's plan page may show
//
// MON1: while the switch is OFF every business-facing function here answers NOT_FOUND and
// getPlanView carries NO price. A browser returning from the processor changes nothing — no
// function here reads a redirect; only a signed webhook event moves a subscription (P24).
//
// PAY1/PAY2: the checkout is the processor's hosted page. The wallet order Apple Pay →
// Google Pay → card is the processor's payment-method configuration named by
// STRIPE_PAYMENT_METHOD_CONFIGURATION; there is no bank-app integration (BT Pay is out of
// scope: its cardholders pay by card).
//
// Invariant 8: a lapse sets businesses.planLapsedAt and nothing else. What that stops is
// BUSINESS_PLAN_CAPABILITIES; the PERMANENT_FREE_TIER is never touched.

export const GRACE_DAYS = 14;
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const PRICES_SETTING = "billing.prices";
export const PRICES_ACTION = "billing.prices.set";
export const REFUND_ACTION = "billing.refund";
export const BILLING_SWEEP_JOB = "billing.sweep";
export const REFUND_JOB = "billing.refund-execute";

export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type RefundRequest = typeof refundRequests.$inferSelect;

/* ── Prices (PAY4) ─────────────────────────────────────────────────────── */

export const pricesSchema = z.object({
  /** Minor units (bani), EXCLUDING TVA. */
  businessMonthlyMinor: z.number().int().min(100).max(100_000_00),
  businessYearlyMinor: z.number().int().min(100).max(1_000_000_00),
  featuredMonthlyMinor: z.number().int().min(100).max(100_000_00),
  /** Basis points; 2100 = 21%. 0 = the operator is not TVA-registered (PAY4). */
  tvaRateBp: z.number().int().min(0).max(5000),
});
export type Prices = z.infer<typeof pricesSchema>;

/** OPERATOR DECISION (10-operator-decisions.md): pilot figures, placeholders until confirmed in the console. */
export const PILOT_PRICE_PLACEHOLDERS: Prices = { businessMonthlyMinor: 199_00, businessYearlyMinor: 1_990_00, featuredMonthlyMinor: 149_00, tvaRateBp: 2100 };

export async function getPrices(ctx: Pick<Ctx, "db">): Promise<Prices & { confirmed: boolean }> {
  const saved = pricesSchema.safeParse(await readSetting(ctx, PRICES_SETTING));
  return saved.success ? { ...saved.data, confirmed: true } : { ...PILOT_PRICE_PLACEHOLDERS, confirmed: false };
}

export type PriceBreakdown = { netMinor: number; tvaMinor: number; grossMinor: number; tvaRateBp: number; currency: "RON" };

/** 199,00 + 21% = 41,79 → 240,79 RON. */
export function priceWithTva(netMinor: number, tvaRateBp: number): PriceBreakdown {
  const tvaMinor = Math.round((netMinor * tvaRateBp) / 10_000);
  return { netMinor, tvaMinor, grossMinor: netMinor + tvaMinor, tvaRateBp, currency: "RON" };
}

export function planPrice(prices: Prices, plan: SubscriptionPlan): PriceBreakdown {
  const net = plan === "business_monthly" ? prices.businessMonthlyMinor : plan === "business_yearly" ? prices.businessYearlyMinor : prices.featuredMonthlyMinor;
  return priceWithTva(net, prices.tvaRateBp);
}

registerApprovalAction<Prices>(PRICES_ACTION, {
  roles: ["commercial_manager"],
  approverRoles: ["commercial_manager", "platform_admin"],
  input: pricesSchema,
  describe: (p) => ({ key: "billing.approvals.prices", params: { monthly: p.businessMonthlyMinor / 100, yearly: p.businessYearlyMinor / 100, featured: p.featuredMonthlyMinor / 100, tva: p.tvaRateBp / 100 } }),
  execute: (ctx, p) => writeSetting(ctx, PRICES_SETTING, p),
});

/** W6: a price change is a request; it takes effect when a second person approves it. */
export async function requestPriceChange(ctx: Ctx, input: { prices: Prices; reason: string }): Promise<ApprovalRequest> {
  requireStaffRole(ctx, "commercial_manager");
  return requestApproval(ctx, { action: PRICES_ACTION, payload: pricesSchema.parse(input.prices), reason: input.reason });
}

/* ── Processor client (Stripe REST, no SDK) ────────────────────────────── */

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type StripeConfig = { secretKey: string | null; webhookSecret: string | null; paymentMethodConfiguration: string | null; testMode: boolean };

export function stripeConfig(env: Record<string, string | undefined> = process.env): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || null;
  return {
    secretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    paymentMethodConfiguration: env.STRIPE_PAYMENT_METHOD_CONFIGURATION?.trim() || null,
    testMode: !secretKey || !secretKey.startsWith("sk_live_"),
  };
}

/** Flattens { a: { b: [1] } } into Stripe's form encoding a[b][0]=1. */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripeRequest(
  path: string,
  params: Record<string, unknown>,
  opts: { config?: StripeConfig; fetcher?: Fetcher; idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  const config = opts.config ?? stripeConfig();
  if (!config.secretKey) throw new AppError("CONFLICT", "billing.errors.notConfigured");
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const res = await fetcher(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body: formEncode(params).join("&"),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // the processor's message may carry details: it is logged by the caller's error path, never shown
  if (!res.ok) throw new AppError("CONFLICT", "billing.errors.processor", { status: res.status });
  return body;
}

/* ── Checkout (exists only behind the switch) ──────────────────────────── */

const checkoutInput = z.object({
  businessId: zId,
  plan: subscriptionPlanSchema,
  listingId: zId.optional(),
  categoryId: zId.optional(),
  countyCode: z.string().min(1).max(3).optional(),
});
export type CheckoutInput = z.input<typeof checkoutInput>;
type CheckoutOpts = { config?: StripeConfig; fetcher?: Fetcher };

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function openCheckout(ctx: Ctx, data: z.output<typeof checkoutInput>, opts: CheckoutOpts, sandbox: boolean): Promise<{ url: string }> {
  const config = opts.config ?? stripeConfig();
  if (!config.secretKey) throw new AppError("CONFLICT", "billing.errors.notConfigured");
  // M4 / W9: no live payments while fewer than two people hold a staff role
  if (!config.testMode && (await isSingleOperatorMode(ctx))) throw new AppError("FORBIDDEN", "billing.errors.singleOperator");
  if (sandbox && !config.testMode) throw new AppError("FORBIDDEN", "billing.errors.sandboxNeedsTestKey");
  if (data.plan === "featured_monthly" && (!data.listingId || !data.categoryId)) throw new AppError("VALIDATION", "common.validation.required");
  const prices = await getPrices(ctx);
  const price = planPrice(prices, data.plan);
  const [business] = await ctx.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, data.businessId));
  if (!business) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const back = `${appUrl()}/business/${data.businessId}/plan`;
  const session = await stripeRequest(
    "/checkout/sessions",
    {
      mode: "subscription",
      // P24: these URLs only bring the person back. Nothing is granted from them.
      success_url: `${back}?checkout=returned`,
      cancel_url: `${back}?checkout=cancelled`,
      client_reference_id: data.businessId,
      // PAY1: Apple Pay → Google Pay → card, as ordered in the processor's configuration
      ...(config.paymentMethodConfiguration ? { payment_method_configuration: config.paymentMethodConfiguration } : { payment_method_types: ["card"] }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "ron",
            // PAY4: the total charged includes TVA; the net price and the TVA are in metadata and on the fiscal invoice
            unit_amount: price.grossMinor,
            recurring: { interval: data.plan === "business_yearly" ? "year" : "month" },
            product_data: { name: data.plan === "featured_monthly" ? "EventDesk Promovat" : "EventDesk Business" },
          },
        },
      ],
      subscription_data: {
        metadata: {
          businessId: data.businessId,
          plan: data.plan,
          listingId: data.listingId,
          categoryId: data.categoryId,
          countyCode: data.countyCode,
          netMinor: price.netMinor,
          tvaMinor: price.tvaMinor,
          tvaRateBp: price.tvaRateBp,
        },
      },
    },
    { config, fetcher: opts.fetcher },
  );
  if (typeof session.url !== "string") throw new AppError("CONFLICT", "billing.errors.processor");
  await audit(ctx, { action: sandbox ? "billing.sandbox_checkout_opened" : "billing.checkout_opened", objectType: "business", objectId: data.businessId, meta: { plan: data.plan } });
  return { url: session.url };
}

/** A business buys a plan or a Featured placement. NOT_FOUND while monetization is off (MON1). */
export async function createCheckoutSession(ctx: Ctx, input: CheckoutInput, opts: CheckoutOpts = {}): Promise<{ url: string }> {
  await assertMonetizationOn(ctx);
  const data = checkoutInput.parse(input);
  await requireBusinessMember(ctx, data.businessId, { roles: ["owner", "admin"] });
  return openCheckout(ctx, data, opts, false);
}

/** W6: staff run the checkout against the processor's TEST mode — the evidence behind MON4. Never a live key. */
export async function createSandboxCheckout(ctx: Ctx, input: CheckoutInput, opts: CheckoutOpts = {}): Promise<{ url: string }> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  return openCheckout(ctx, checkoutInput.parse(input), opts, true);
}

/** Cancels at period end (P25). Only while monetization is on. */
export async function cancelSubscription(ctx: Ctx, input: { subscriptionId: string }, opts: CheckoutOpts = {}): Promise<void> {
  await assertMonetizationOn(ctx);
  const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.id, zId.parse(input.subscriptionId)));
  if (!sub) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireBusinessMember(ctx, sub.businessId, { roles: ["owner", "admin"] });
  if (!sub.processorSubscriptionId || sub.status === "canceled") throw new AppError("CONFLICT", "common.errors.CONFLICT");
  // the row changes when the processor's webhook confirms it — not here
  await stripeRequest(`/subscriptions/${encodeURIComponent(sub.processorSubscriptionId)}`, { cancel_at_period_end: true }, opts);
  await audit(ctx, { action: "billing.cancel_requested", objectType: "subscription", objectId: sub.id });
}

/* ── Webhook (P24) ─────────────────────────────────────────────────────── */

export type SignatureResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/**
 * Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>…]". The signed payload is `${t}.${rawBody}`,
 * HMAC-SHA256 with the endpoint secret; compared in constant time; older or newer than five
 * minutes is refused (replay protection together with the per-event id).
 */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string, now: Date, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): SignatureResult {
  if (!header) return { ok: false, reason: "missing" };
  let t: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") candidates.push(v);
  }
  if (!t || !/^\d{1,12}$/.test(t) || candidates.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(t)) > toleranceSeconds) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  for (const c of candidates) {
    if (!/^[0-9a-f]{64}$/i.test(c)) continue;
    if (timingSafeEqual(expected, Buffer.from(c, "hex"))) return { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

/** For tests and the sandbox run: the header a processor would send. */
export function signStripePayload(rawBody: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex")}`;
}

const eventSchema = z.object({
  id: z.string().min(3).max(255),
  type: z.string().min(1).max(120),
  livemode: z.boolean().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type WebhookResult = { status: "processed" | "duplicate" | "ignored"; type: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const unix = (v: unknown): Date | null => (num(v) ? new Date(num(v)! * 1000) : null);

function subscriptionIdOf(o: Record<string, unknown>): string | null {
  return str(o.subscription) ?? str(obj(obj(o.parent).subscription_details).subscription);
}
function periodEndOf(o: Record<string, unknown>): Date | null {
  const items = obj(o.items).data;
  const first = Array.isArray(items) ? obj(items[0]) : {};
  return unix(o.current_period_end) ?? unix(first.current_period_end);
}

/**
 * THE ONLY WAY a subscription changes (P24). Verifies the signature, handles each event id
 * once, and applies the change in one transaction. Throws UNAUTHENTICATED for a bad, stale or
 * missing signature and NOT_FOUND when no webhook secret is configured.
 */
export async function handleStripeWebhook(ctx: Ctx, input: { rawBody: string; signature: string | null | undefined }, opts: { config?: StripeConfig } = {}): Promise<WebhookResult> {
  requireSystem(ctx);
  const config = opts.config ?? stripeConfig();
  if (!config.webhookSecret) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const sig = verifyStripeSignature(input.rawBody, input.signature, config.webhookSecret, ctx.now);
  if (!sig.ok) throw new AppError("UNAUTHENTICATED", "billing.errors.signature", { reason: sig.reason });
  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(input.rawBody));
  } catch {
    throw new AppError("VALIDATION", "common.validation.invalid");
  }
  const on = await isMonetizationOn(ctx);
  const sandbox = parsed.livemode !== true;
  // MON1: with the switch off only TEST-mode events are even recorded (the acceptance run);
  // they never change what a business can do.
  if (!on && !sandbox) return { status: "ignored", type: parsed.type };

  return inTx(ctx, async (tx) => {
    const fresh = await tx.db.insert(processorEvents).values({ id: parsed.id, type: parsed.type, receivedAt: tx.now }).onConflictDoNothing().returning({ id: processorEvents.id });
    if (!fresh[0]) return { status: "duplicate" as const, type: parsed.type };
    const o = parsed.data.object;
    let handled = true;
    switch (parsed.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const meta = obj(o.metadata);
        const plan = subscriptionPlanSchema.safeParse(meta.plan);
        const businessId = str(meta.businessId);
        const processorId = str(o.id);
        if (!plan.success || !businessId || !processorId) break;
        const [known] = await tx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId));
        if (!known) break;
        const raw = str(o.status);
        const deleted = parsed.type === "customer.subscription.deleted" || raw === "canceled" || raw === "incomplete_expired";
        const [existing] = await tx.db.select().from(subscriptions).where(eq(subscriptions.processorSubscriptionId, processorId));
        // "active" comes only from a PAID invoice; an update never promotes, it can only keep or end
        const status: SubscriptionStatus = deleted ? "canceled" : (existing?.status ?? "past_due");
        const values = {
          businessId,
          plan: plan.data,
          status,
          currentPeriodEnd: periodEndOf(o) ?? existing?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: o.cancel_at_period_end === true,
          listingId: str(meta.listingId),
          categoryId: str(meta.categoryId),
          countyCode: str(meta.countyCode),
          sandbox,
          processorCustomerId: str(o.customer),
          processorSubscriptionId: processorId,
        };
        const [row] = existing
          ? await tx.db.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id)).returning()
          : await tx.db.insert(subscriptions).values({ ...values, createdAt: tx.now }).returning();
        if (existing?.status !== row!.status) await applyEntitlement(tx, row!, on);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const processorId = subscriptionIdOf(o);
        const [sub] = processorId ? await tx.db.select().from(subscriptions).where(eq(subscriptions.processorSubscriptionId, processorId)) : [];
        if (!processorId) break;
        // events can arrive out of order: refuse (and roll back) so the processor retries after
        // the subscription event has been handled
        if (!sub) throw new AppError("CONFLICT", "billing.errors.unknownSubscription");
        const lines = obj(o.lines).data;
        const period = Array.isArray(lines) ? obj(obj(lines[0]).period) : {};
        const [row] = await tx.db
          .update(subscriptions)
          .set({ status: "active", graceUntil: null, currentPeriodEnd: unix(period.end) ?? sub.currentPeriodEnd })
          .where(eq(subscriptions.id, sub.id))
          .returning();
        await applyEntitlement(tx, row!, on);
        // PAY3: one fiscal invoice per charge, issued by the invoicing provider (not the processor)
        const gross = num(o.amount_paid) ?? 0;
        const prices = await getPrices(tx);
        const net = prices.tvaRateBp > 0 ? Math.round((gross * 10_000) / (10_000 + prices.tvaRateBp)) : gross;
        if (gross > 0) {
          const added = await tx.db
            .insert(invoices)
            .values({
              subscriptionId: sub.id,
              businessId: sub.businessId,
              netMinor: net,
              tvaMinor: gross - net,
              grossMinor: gross,
              tvaRateBp: prices.tvaRateBp,
              processorInvoiceId: str(o.id),
              processorPaymentId: str(o.payment_intent),
              createdAt: tx.now,
            })
            .onConflictDoNothing()
            .returning({ id: invoices.id });
          if (added[0]) await enqueue(tx, "invoicing.issue", { invoiceId: added[0].id }, { uniqueKey: `invoicing.issue:${added[0].id}` });
        }
        break;
      }
      case "invoice.payment_failed": {
        const processorId = subscriptionIdOf(o);
        const [sub] = processorId ? await tx.db.select().from(subscriptions).where(eq(subscriptions.processorSubscriptionId, processorId)) : [];
        if (!sub || sub.status === "canceled") break;
        // P25: 14 days of grace from the FIRST failure; later retries do not extend it
        if (sub.status !== "grace") await tx.db.update(subscriptions).set({ status: "grace", graceUntil: addDays(tx.now, GRACE_DAYS) }).where(eq(subscriptions.id, sub.id));
        break;
      }
      default:
        // includes checkout.session.completed: the return from checkout grants nothing by itself
        handled = false;
    }
    await audit(tx, { action: "billing.webhook", objectType: "processor_event", objectId: parsed.id, meta: { type: parsed.type, handled, sandbox, monetizationOn: on } });
    return { status: handled ? ("processed" as const) : ("ignored" as const), type: parsed.type };
  });
}

/**
 * Turns a subscription's status into what the business can do — and ONLY while monetization
 * is on (MON1: before that everything is free whatever a test event says).
 *   Business plan: active/grace → not lapsed; canceled with no other live plan → lapsed (P23).
 *   Featured: active/grace → its slot is live; canceled → the slot is switched off.
 */
async function applyEntitlement(tx: Ctx, sub: Subscription, on: boolean): Promise<void> {
  if (!on) return;
  const live = sub.status === "active" || sub.status === "grace" || sub.status === "past_due";
  if (sub.plan === "featured_monthly") {
    if (!sub.listingId || !sub.categoryId) return;
    const [slot] = await tx.db.select().from(featuredSlots).where(eq(featuredSlots.subscriptionId, sub.id));
    if (sub.status === "active" && !slot) {
      await tx.db.insert(featuredSlots).values({ listingId: sub.listingId, categoryId: sub.categoryId, countyCode: sub.countyCode, active: true, startsAt: tx.now, subscriptionId: sub.id, createdAt: tx.now });
    } else if (slot) {
      await tx.db.update(featuredSlots).set({ active: live, endsAt: live ? null : tx.now }).where(eq(featuredSlots.id, slot.id));
    }
    return;
  }
  if (sub.status === "active") {
    await tx.db.update(businesses).set({ planLapsedAt: null }).where(eq(businesses.id, sub.businessId));
    return;
  }
  if (sub.status === "canceled") await lapseIfNoPlan(tx, sub.businessId);
}

async function lapseIfNoPlan(tx: Ctx, businessId: string): Promise<void> {
  const [other] = await tx.db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.businessId, businessId), inArray(subscriptions.plan, ["business_monthly", "business_yearly"]), inArray(subscriptions.status, ["active", "grace", "past_due"])))
    .limit(1);
  if (other) return;
  const done = await tx.db.update(businesses).set({ planLapsedAt: tx.now }).where(and(eq(businesses.id, businessId), isNull(businesses.planLapsedAt))).returning({ id: businesses.id });
  if (done[0]) await audit(tx, { action: "business.plan_lapsed", objectType: "business", objectId: businessId });
}

/* ── Nightly sweep (P25, MON3) ─────────────────────────────────────────── */

/**
 * Ends what has run out: a grace period that passed, a cancellation whose period ended. When
 * monetization is in force it also places every business without a live Business plan on the
 * permanent free tier (MON3). Idempotent. Does nothing to businesses while the switch is off.
 */
export async function runBillingSweep(ctx: Ctx): Promise<{ ended: number; freeTier: number }> {
  requireSystem(ctx);
  const on = await isMonetizationOn(ctx);
  return inTx(ctx, async (tx) => {
    const due = await tx.db
      .select()
      .from(subscriptions)
      .where(
        sql`(${subscriptions.status} = 'grace' and ${subscriptions.graceUntil} <= ${tx.now}) or (${subscriptions.status} in ('active', 'past_due') and ${subscriptions.cancelAtPeriodEnd} and ${subscriptions.currentPeriodEnd} <= ${tx.now})`,
      );
    for (const sub of due) {
      const [row] = await tx.db.update(subscriptions).set({ status: "canceled", graceUntil: null }).where(eq(subscriptions.id, sub.id)).returning();
      await applyEntitlement(tx, row!, on);
      await audit(tx, { action: "subscription.ended", objectType: "subscription", objectId: sub.id, before: { status: sub.status }, after: { status: "canceled" } });
    }
    let freeTier = 0;
    if (on) {
      const moved = await tx.db.execute(sql`
        update businesses b set plan_lapsed_at = ${tx.now}
        where b.plan_lapsed_at is null and not exists (
          select 1 from subscriptions s where s.business_id = b.id
            and s.plan in ('business_monthly', 'business_yearly') and s.status in ('active', 'grace', 'past_due'))`);
      freeTier = moved.rowCount ?? 0;
      // Featured slots whose time is over
      await tx.db.update(featuredSlots).set({ active: false }).where(and(eq(featuredSlots.active, true), lt(featuredSlots.endsAt, tx.now)));
    }
    return { ended: due.length, freeTier };
  });
}

/* ── Refunds and credits (P26) ─────────────────────────────────────────── */

const refundInput = z.object({
  subscriptionId: zId,
  invoiceId: zId.optional(),
  kind: z.enum(["refund", "credit"], "common.validation.required"),
  amountMinor: z.number().int().positive("billing.errors.amount").max(10_000_000),
  reason: z.string().trim().min(10, "billing.errors.reasonRequired").max(1000, "common.validation.tooLong"),
});

registerApprovalAction<{ refundId: string }>(REFUND_ACTION, {
  roles: ["commercial_manager"],
  approverRoles: ["commercial_manager", "platform_admin"],
  input: z.object({ refundId: zId }),
  describe: (p) => ({ key: "billing.approvals.refund", params: { id: p.refundId.slice(-6) } }),
  execute: async (tx, p, request) => {
    if (await isSingleOperatorMode(tx)) throw new AppError("FORBIDDEN", "billing.errors.singleOperator");
    const staffId = tx.actor.kind === "staff" ? tx.actor.staffId : null;
    const done = await tx.db
      .update(refundRequests)
      .set({ state: "approved", approvedByStaffId: staffId, decidedAt: tx.now })
      .where(and(eq(refundRequests.id, p.refundId), eq(refundRequests.state, "requested")))
      .returning();
    if (!done[0]) throw new AppError("CONFLICT", "common.errors.CONFLICT");
    await enqueue(tx, REFUND_JOB, { refundId: p.refundId }, { uniqueKey: `billing.refund:${p.refundId}` });
    await audit(tx, { action: "billing.refund_approved", objectType: "refund_request", objectId: p.refundId, meta: { requesterStaffId: request.requesterStaffId, approvedByStaffId: staffId } });
  },
});

/**
 * P26: asks for a refund or a credit. Nothing moves until ANOTHER person approves it; in
 * single-operator mode it is refused outright (W9, M4 — no live payments with one person).
 */
export async function requestRefund(ctx: Ctx, input: z.input<typeof refundInput>): Promise<{ refund: RefundRequest; approval: ApprovalRequest }> {
  const staffId = requireStaffRole(ctx, "commercial_manager");
  await assertMonetizationOn(ctx);
  const data = refundInput.parse(input);
  if (await isSingleOperatorMode(ctx)) throw new AppError("FORBIDDEN", "billing.errors.singleOperator");
  const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.id, data.subscriptionId));
  if (!sub) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return inTx(ctx, async (tx) => {
    const [refund] = await tx.db
      .insert(refundRequests)
      .values({ subscriptionId: sub.id, invoiceId: data.invoiceId ?? null, kind: data.kind, amountMinor: data.amountMinor, reason: data.reason, requestedByStaffId: staffId, createdAt: tx.now })
      .returning();
    const approval = await requestApproval(tx, { action: REFUND_ACTION, payload: { refundId: refund!.id }, reason: data.reason });
    await tx.db.update(refundRequests).set({ approvalRequestId: approval.id }).where(eq(refundRequests.id, refund!.id));
    return { refund: { ...refund!, approvalRequestId: approval.id }, approval };
  });
}

/** Sends an APPROVED refund or credit to the processor. Without a key it stays "approved" for manual handling. */
export async function executeRefund(ctx: Ctx, refundId: string, opts: CheckoutOpts = {}): Promise<RefundRequest["state"]> {
  requireSystem(ctx);
  const [refund] = await ctx.db.select().from(refundRequests).where(eq(refundRequests.id, refundId));
  if (!refund || refund.state !== "approved") return refund?.state ?? "rejected";
  const config = opts.config ?? stripeConfig();
  if (!config.secretKey) return "approved";
  const [sub] = await ctx.db.select().from(subscriptions).where(eq(subscriptions.id, refund.subscriptionId));
  const [invoice] = refund.invoiceId ? await ctx.db.select().from(invoices).where(eq(invoices.id, refund.invoiceId)) : [];
  let ref: string | null;
  if (refund.kind === "refund" && invoice?.processorPaymentId) {
    const res = await stripeRequest("/refunds", { payment_intent: invoice.processorPaymentId, amount: refund.amountMinor }, { ...opts, config, idempotencyKey: `refund:${refund.id}` });
    ref = str(res.id);
  } else if (refund.kind === "credit" && sub?.processorCustomerId) {
    const res = await stripeRequest(
      `/customers/${encodeURIComponent(sub.processorCustomerId)}/balance_transactions`,
      { amount: -refund.amountMinor, currency: "ron" },
      { ...opts, config, idempotencyKey: `credit:${refund.id}` },
    );
    ref = str(res.id);
  } else {
    return "approved"; // nothing to send to: stays visible in the console for manual handling
  }
  await ctx.db.update(refundRequests).set({ state: "done", processorRef: ref }).where(and(eq(refundRequests.id, refund.id), eq(refundRequests.state, "approved")));
  await audit(ctx, { action: "billing.refund_done", objectType: "refund_request", objectId: refund.id, meta: { kind: refund.kind } });
  return "done";
}

/* ── Views ─────────────────────────────────────────────────────────────── */

export type PlanView = {
  monetization: MonetizationView;
  lapsed: boolean;
  /** True while a Business plan subscription is live (always false while monetization is off). */
  hasBusinessPlan: boolean;
  freeTier: readonly string[];
  planCapabilities: readonly string[];
  /** Present ONLY while monetization is on (MON1). */
  paid: null | {
    prices: { businessMonthly: PriceBreakdown; businessYearly: PriceBreakdown; featuredMonthly: PriceBreakdown; tvaRegistered: boolean };
    subscriptions: Subscription[];
    canBuy: boolean;
    checkoutConfigured: boolean;
  };
};

/** The plan page of a business. While the switch is off it carries facts only — no price exists in it. */
export async function getPlanView(ctx: Ctx, businessId: string): Promise<PlanView> {
  const { business, role } = await requireBusinessMember(ctx, businessId);
  const monetization = await getMonetizationState(ctx);
  const base = { monetization, lapsed: business.planLapsedAt !== null, hasBusinessPlan: false, freeTier: PERMANENT_FREE_TIER, planCapabilities: BUSINESS_PLAN_CAPABILITIES };
  if (monetization.phase !== "on") return { ...base, paid: null };
  const prices = await getPrices(ctx);
  const subs = await ctx.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.businessId, businessId), eq(subscriptions.sandbox, false)))
    .orderBy(desc(subscriptions.createdAt))
    .limit(50);
  return {
    ...base,
    hasBusinessPlan: subs.some((x) => x.plan !== "featured_monthly" && x.status !== "canceled"),
    paid: {
      prices: {
        businessMonthly: planPrice(prices, "business_monthly"),
        businessYearly: planPrice(prices, "business_yearly"),
        featuredMonthly: planPrice(prices, "featured_monthly"),
        tvaRegistered: prices.tvaRateBp > 0,
      },
      subscriptions: subs,
      canBuy: role !== "staff" && business.status === "active",
      checkoutConfigured: stripeConfig().secretKey !== null,
    },
  };
}

export type CommercialOverview = {
  subscriptions: Array<Subscription & { businessName: string }>;
  refunds: RefundRequest[];
  invoices: Invoice[];
  prices: Prices & { confirmed: boolean };
  processor: { keyPresent: boolean; webhookSecretPresent: boolean; testMode: boolean; paymentMethodConfiguration: boolean };
};

/** W6: what the commercial console lists. Names of businesses only — never planner content. */
export async function getCommercialOverview(ctx: Ctx): Promise<CommercialOverview> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  const subs = await ctx.db
    .select({ s: subscriptions, businessName: businesses.name })
    .from(subscriptions)
    .innerJoin(businesses, eq(businesses.id, subscriptions.businessId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(200);
  const config = stripeConfig();
  return {
    subscriptions: subs.map((r) => ({ ...r.s, businessName: r.businessName })),
    refunds: await ctx.db.select().from(refundRequests).orderBy(desc(refundRequests.createdAt)).limit(100),
    invoices: await ctx.db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(100),
    prices: await getPrices(ctx),
    processor: { keyPresent: !!config.secretKey, webhookSecretPresent: !!config.webhookSecret, testMode: config.testMode, paymentMethodConfiguration: !!config.paymentMethodConfiguration },
  };
}

/* ── Free-phase cost dashboard (W6) ────────────────────────────────────── */

export const MONTHLY_COST_SETTING = "commercial.monthlyFixedCostMinor";
/** OPERATOR DECISION: 20.000 RON is a placeholder until the real monthly fixed cost is entered. */
export const MONTHLY_COST_PLACEHOLDER_MINOR = 20_000_00;

export async function getMonthlyCost(ctx: Pick<Ctx, "db">): Promise<{ minor: number; placeholder: boolean }> {
  const saved = z.number().int().min(0).max(100_000_000_00).safeParse(await readSetting(ctx, MONTHLY_COST_SETTING));
  return saved.success ? { minor: saved.data, placeholder: false } : { minor: MONTHLY_COST_PLACEHOLDER_MINOR, placeholder: true };
}

export async function setMonthlyCost(ctx: Ctx, input: { minor: number }): Promise<void> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  await writeSetting(ctx, MONTHLY_COST_SETTING, z.number().int().min(0).max(100_000_000_00).parse(input.minor));
}

type EnquiryCounter = (ctx: Ctx, input: { since: Date }) => Promise<number>;
const counters = globalThis as unknown as { __edPlatformEnquiryCounter?: EnquiryCounter };
/** The enquiries domain plugs its platform-wide count in here (a number only); without it the dashboard says "unknown". */
export function setPlatformEnquiryCounter(fn: EnquiryCounter | null): void {
  counters.__edPlatformEnquiryCounter = fn ?? undefined;
}

export type FreePhaseDashboard = {
  monthlyCost: { minor: number; placeholder: boolean };
  businesses: number;
  liveListings: number;
  /** Enquiries sent in the last 30 days; null = unknown. */
  enquiries30: number | null;
  /** Business plans (monthly, excl. TVA) that would cover the monthly cost at the current prices. */
  breakEvenPlans: number;
  pricesConfirmed: boolean;
};

/** W6, free phase: what the platform costs each month and how much supply there is. Counts only. */
export async function getFreePhaseDashboard(ctx: Ctx): Promise<FreePhaseDashboard> {
  requireStaffRole(ctx, ...MONETIZATION_ROLES);
  const monthlyCost = await getMonthlyCost(ctx);
  const prices = await getPrices(ctx);
  const [b] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(businesses);
  const live = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from listings where status = 'live'`);
  return {
    monthlyCost,
    businesses: Number(b?.n ?? 0),
    liveListings: Number(live.rows[0]?.n ?? 0),
    enquiries30: counters.__edPlatformEnquiryCounter ? await counters.__edPlatformEnquiryCounter(ctx, { since: addDays(ctx.now, -30) }) : null,
    breakEvenPlans: Math.ceil(monthlyCost.minor / prices.businessMonthlyMinor),
    pricesConfirmed: prices.confirmed,
  };
}

export function registerJobs(): void {
  defineJob(BILLING_SWEEP_JOB, z.object({}), async (ctx) => {
    await runBillingSweep(ctx);
  });
  defineSchedule({ name: "billing.sweep.daily", job: BILLING_SWEEP_JOB, every: { kind: "daily", at: "03:20" } });
  defineJob(REFUND_JOB, z.object({ refundId: z.string() }), async (ctx, p) => {
    await executeRefund(ctx, p.refundId);
  });
}
