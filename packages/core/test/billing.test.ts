import { createHmac } from "node:crypto";
import { accounts, approvalRequests, auditLog, businessNotices, businesses, eq, featuredSlots, invoices, jobs, monetizationHistory, monetizationSwitch, processorEvents, refundRequests, sessions, staffMembers, subscriptions, type StaffRole } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveRequest } from "../src/approvals";
import {
  createCheckoutSession,
  createSandboxCheckout,
  executeRefund,
  formEncode,
  getMonthlyCost,
  getPlanView,
  getPrices,
  GRACE_DAYS,
  handleStripeWebhook,
  PILOT_PRICE_PLACEHOLDERS,
  priceWithTva,
  requestPriceChange,
  requestRefund,
  runBillingSweep,
  signStripePayload,
  verifyStripeSignature,
  type Fetcher,
  type StripeConfig,
} from "../src/billing";
import { assertBusinessCanCreate, createBusiness } from "../src/business";
import { accountCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { handleInvoicingWebhook, issueInvoice, getInvoicingProvider } from "../src/invoicing";
import {
  getMonetizationConsole,
  getMonetizationState,
  isMonetizationOn,
  NOTICE_DAYS,
  recordBillingAcceptance,
  requestMonetizationDisable,
  requestMonetizationEnable,
  sendNoticeRound,
} from "../src/monetization";

let t: TestDb;
const T0 = new Date("2026-05-04T08:00:00Z");
const DAY = 86_400_000;
let seq = 0;

const SECRET = "whsec_test_0123456789abcdef";
const config: StripeConfig = { secretKey: "sk_test_abc", webhookSecret: SECRET, paymentMethodConfiguration: "pmc_test_1", testMode: true };

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["monetization"]);
});
afterAll(async () => {
  await t.close();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (isAppError(e)) return `${e.code}:${e.messageKey ?? ""}`;
    throw e;
  }
}
async function mkAccount(): Promise<{ id: string; ctx: Ctx }> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `b${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * DAY), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }) };
}
async function mkStaff(roles: StaffRole[], now = T0): Promise<Ctx & { staffId: string }> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return Object.assign(makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now }), { staffId: row!.id });
}
const at = (ctx: Ctx, now: Date): Ctx => ({ ...ctx, now });
const sys = (now = T0) => systemCtx(t.db, { now });

async function mkBusiness() {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `Firma ${++seq} SRL` });
  return { owner, business };
}

/** Sends a signed event exactly as the processor would. */
async function send(event: Record<string, unknown>, now = T0, opts: { secret?: string; signedAt?: Date } = {}) {
  const rawBody = JSON.stringify(event);
  return handleStripeWebhook(sys(now), { rawBody, signature: signStripePayload(rawBody, opts.secret ?? SECRET, opts.signedAt ?? now) }, { config });
}
const subEvent = (id: string, type: string, sub: Record<string, unknown>) => ({ id, type, livemode: false, data: { object: sub } });

describe("monetization switch (MON1–MON4, P28)", () => {
  it("is OFF by default and seeded; nothing about billing is reachable", async () => {
    expect(await t.db.select().from(monetizationSwitch)).toMatchObject([{ id: "switch", state: "off" }]);
    expect(await isMonetizationOn(sys())).toBe(false);
    expect(await getMonetizationState(sys())).toMatchObject({ state: "off", phase: "off", effectiveAt: null });
    const { owner, business } = await mkBusiness();
    // MON1: every business-facing billing function answers "not found"
    expect(await code(createCheckoutSession(owner.ctx, { businessId: business.id, plan: "business_monthly" }, { config }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    // …and the plan view carries no price at all
    const view = await getPlanView(owner.ctx, business.id);
    expect(view.paid).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/Minor|price|RON|199|149|tva/i);
    expect(view.freeTier).toContain("existingOccasions");
  });

  it("ON is refused without a test-mode acceptance, in single-operator mode, and without a second approver", async () => {
    const manager = await mkStaff(["commercial_manager"]);
    // single operator + no acceptance
    await expect(requestMonetizationEnable(manager, { reason: "Pornim monetizarea conform planului." })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "billing.errors.acceptanceMissing" });
    // only these roles may record an acceptance
    const editor = await mkStaff(["content_editor"]);
    expect(await code(recordBillingAcceptance(editor, { evidenceRef: "RUN-1" }))).toBe("FORBIDDEN:console.errors.roleRequired");
    await t.db.update(staffMembers).set({ active: false }).where(eq(staffMembers.id, editor.staffId));
    const acceptance = await recordBillingAcceptance(manager, { evidenceRef: "Raport sandbox 2026-05-03, tichet OPS-41", notes: "P24–P26, PAY1–PAY5 verificate" });
    expect(acceptance.recordedByStaffId).toBe(manager.staffId);
    // still one person on the staff: refused (W9, M4)
    await expect(requestMonetizationEnable(manager, { reason: "Pornim monetizarea conform planului." })).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "billing.errors.singleOperator" });

    const admin = await mkStaff(["platform_admin"]);
    const request = await requestMonetizationEnable(manager, { reason: "Pornim monetizarea conform planului." });
    expect(await isMonetizationOn(sys())).toBe(false); // a request changes nothing
    // the requester cannot approve their own request; a role that is not an approver cannot either
    expect(await code(approveRequest(manager, request.id))).toMatch(/^FORBIDDEN/);
    const manager2 = await mkStaff(["commercial_manager"]);
    expect(await code(approveRequest(manager2, request.id))).toMatch(/^FORBIDDEN/);
    expect((await getMonetizationState(sys())).state).toBe("off");

    const { business } = await mkBusiness();
    const res = await approveRequest(admin, request.id);
    expect(res.executed).toBe(true);

    // MON2: history with requester, approver and the notice dates
    const [h] = await t.db.select().from(monetizationHistory);
    expect(h).toMatchObject({ change: "enable", requestedByStaffId: manager.staffId, approverStaffIds: [admin.staffId], approvalRequestId: request.id, acceptanceId: acceptance.id });
    expect(h!.noticeStartsAt!.getTime()).toBe(T0.getTime());
    expect(h!.effectiveAt!.getTime()).toBe(T0.getTime() + NOTICE_DAYS * DAY);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, "monetization.enabled"))).length).toBe(1);

    // P28: the switch only takes effect after the 60 days
    expect(await getMonetizationState(sys())).toMatchObject({ state: "on", phase: "notice" });
    expect(await isMonetizationOn(sys())).toBe(false);
    expect(await isMonetizationOn(sys(new Date(T0.getTime() + 59 * DAY)))).toBe(false);
    expect(await isMonetizationOn(sys(new Date(T0.getTime() + 60 * DAY)))).toBe(true);

    // the notice now and reminders 30 and 7 days before, as unique jobs at the right times
    const reminderJobs = (await t.db.select().from(jobs)).filter((j) => j.name === "monetization.notice-reminder");
    const effective = T0.getTime() + 60 * DAY;
    expect(reminderJobs.map((j) => (effective - j.runAt.getTime()) / DAY).sort((a, b) => a - b)).toEqual([7, 30, 60]);
    expect(new Set(reminderJobs.map((j) => j.uniqueKey)).size).toBe(3);

    // a round reaches every business once, in-app + one email job each, however often it runs
    const n = await sendNoticeRound(sys(new Date(effective - 30 * DAY)), { effectiveAt: new Date(effective), daysBefore: 30 });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await sendNoticeRound(sys(new Date(effective - 30 * DAY)), { effectiveAt: new Date(effective), daysBefore: 30 })).toBe(0);
    const notices = await t.db.select().from(businessNotices).where(eq(businessNotices.businessId, business.id));
    expect(notices.map((x) => x.kind)).toEqual(["monetization.notice30"]);
    expect(notices[0]!.reason).toBe("03.07.2026");
    const consoleView = await getMonetizationConsole(admin);
    expect(consoleView.reminders.find((r) => r.daysBefore === 30)?.sentAt).not.toBeNull();
    expect(consoleView.reminders.find((r) => r.daysBefore === 7)?.sentAt).toBeNull();

    // already on: a second request is refused; OFF again is an approval too
    expect(await code(requestMonetizationEnable(manager, { reason: "Încă o dată, din greșeală." }))).toBe("CONFLICT:billing.errors.alreadyOn");
    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, business.id));
    const off = await requestMonetizationDisable(manager, { reason: "Oprim: amânăm lansarea plătită." });
    expect((await getMonetizationState(sys())).state).toBe("on");
    await approveRequest(admin, off.id);
    expect(await getMonetizationState(sys())).toMatchObject({ state: "off", phase: "off" });
    expect((await t.db.select().from(monetizationHistory)).map((x) => x.change).sort()).toEqual(["disable", "enable"]);
    // everything is free again: no business stays lapsed
    expect((await t.db.select().from(businesses).where(eq(businesses.id, business.id)))[0]!.planLapsedAt).toBeNull();
    // a round for the old dates is void
    expect(await sendNoticeRound(sys(new Date(effective - 7 * DAY)), { effectiveAt: new Date(effective), daysBefore: 7 })).toBe(0);
  });
});

describe("prices and TVA (PAY3, PAY4)", () => {
  it("pilot placeholders until confirmed; TVA is its own figure: 199 + 41,79 = 240,79", async () => {
    expect(PILOT_PRICE_PLACEHOLDERS).toMatchObject({ businessMonthlyMinor: 19900, businessYearlyMinor: 199000, featuredMonthlyMinor: 14900, tvaRateBp: 2100 });
    expect(priceWithTva(19900, 2100)).toEqual({ netMinor: 19900, tvaMinor: 4179, grossMinor: 24079, tvaRateBp: 2100, currency: "RON" });
    expect(priceWithTva(19900, 0)).toMatchObject({ tvaMinor: 0, grossMinor: 19900 }); // not TVA-registered
    expect((await getPrices(sys())).confirmed).toBe(false);
    expect(await getMonthlyCost(sys())).toEqual({ minor: 2_000_000, placeholder: true });
    // a price change needs a second person
    const manager = await mkStaff(["commercial_manager"]);
    const other = await mkStaff(["commercial_manager"]);
    const req = await requestPriceChange(manager, { prices: { ...PILOT_PRICE_PLACEHOLDERS, businessMonthlyMinor: 24900 }, reason: "Preț final de lansare." });
    expect((await getPrices(sys())).businessMonthlyMinor).toBe(19900);
    expect(await code(approveRequest(manager, req.id))).toMatch(/^FORBIDDEN/);
    await approveRequest(other, req.id);
    expect(await getPrices(sys())).toMatchObject({ businessMonthlyMinor: 24900, confirmed: true });
    await approveRequest(manager, (await requestPriceChange(other, { prices: PILOT_PRICE_PLACEHOLDERS, reason: "Înapoi la prețurile pilot." })).id);
  });
});

describe("webhook signature (P24)", () => {
  const body = JSON.stringify({ id: "evt_sig", type: "ping", data: { object: {} } });
  it("accepts a good signature; rejects bad, stale, missing and malformed ones", () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, T0), SECRET, T0)).toEqual({ ok: true });
    // real maths: the same header computed by hand
    const ts = Math.floor(T0.getTime() / 1000);
    const hand = `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
    expect(hand).toBe(signStripePayload(body, SECRET, T0));
    expect(verifyStripeSignature(body, `${hand},v0=ignored`, SECRET, T0)).toEqual({ ok: true });
    // several v1 (secret rotation): any valid one passes
    expect(verifyStripeSignature(body, `t=${ts},v1=${"0".repeat(64)},v1=${hand.split("v1=")[1]}`, SECRET, T0)).toEqual({ ok: true });

    expect(verifyStripeSignature(body, signStripePayload(body, "whsec_other", T0), SECRET, T0)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyStripeSignature(`${body} `, hand, SECRET, T0)).toEqual({ ok: false, reason: "mismatch" }); // body changed
    expect(verifyStripeSignature(body, hand, SECRET, new Date(T0.getTime() + 299_000))).toEqual({ ok: true });
    expect(verifyStripeSignature(body, hand, SECRET, new Date(T0.getTime() + 301_000))).toEqual({ ok: false, reason: "stale" });
    expect(verifyStripeSignature(body, hand, SECRET, new Date(T0.getTime() - 301_000))).toEqual({ ok: false, reason: "stale" });
    expect(verifyStripeSignature(body, null, SECRET, T0)).toEqual({ ok: false, reason: "missing" });
    expect(verifyStripeSignature(body, "v1=abc", SECRET, T0)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyStripeSignature(body, `t=${ts},v1=zz`, SECRET, T0)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("the handler refuses unsigned, wrongly signed and stale requests, and anything without a configured secret", async () => {
    const raw = JSON.stringify({ id: "evt_x1", type: "invoice.paid", livemode: false, data: { object: {} } });
    expect(await code(handleStripeWebhook(sys(), { rawBody: raw, signature: null }, { config }))).toBe("UNAUTHENTICATED:billing.errors.signature");
    expect(await code(handleStripeWebhook(sys(), { rawBody: raw, signature: signStripePayload(raw, "nope", T0) }, { config }))).toBe("UNAUTHENTICATED:billing.errors.signature");
    expect(await code(handleStripeWebhook(sys(new Date(T0.getTime() + 600_000)), { rawBody: raw, signature: signStripePayload(raw, SECRET, T0) }, { config }))).toBe("UNAUTHENTICATED:billing.errors.signature");
    expect(await code(handleStripeWebhook(sys(), { rawBody: raw, signature: signStripePayload(raw, SECRET, T0) }, { config: { ...config, webhookSecret: null } }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    // only the system (the route) may call it
    const { owner } = await mkBusiness();
    await expect(handleStripeWebhook(owner.ctx, { rawBody: raw, signature: signStripePayload(raw, SECRET, T0) }, { config })).rejects.toThrow();
    expect(await t.db.select().from(processorEvents)).toHaveLength(0);
  });
});

describe("dormant billing with the switch forced ON in a test database (P24–P26)", () => {
  let manager: Ctx & { staffId: string };
  let admin: Ctx & { staffId: string };
  const ON_AT = new Date(T0.getTime() + 100 * DAY);

  beforeAll(async () => {
    manager = await mkStaff(["commercial_manager"]);
    admin = await mkStaff(["platform_admin"]);
    await t.db.update(monetizationSwitch).set({ state: "on", noticeStartsAt: T0, effectiveAt: new Date(T0.getTime() + 60 * DAY) });
  });

  it("checkout exists only now, needs a key, sends the TVA-inclusive total and the wallet configuration", async () => {
    const { owner, business } = await mkBusiness();
    const calls: Array<{ url: string; body: string; auth: string }> = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, body: decodeURIComponent(init.body ?? ""), auth: init.headers.authorization ?? "" });
      return { ok: true, status: 200, json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/c/cs_test_1" }) };
    };
    const on = at(owner.ctx, ON_AT);
    expect(await code(createCheckoutSession(on, { businessId: business.id, plan: "business_monthly" }, { config: { ...config, secretKey: null }, fetcher }))).toBe("CONFLICT:billing.errors.notConfigured");
    const outsider = await mkAccount();
    expect(await code(createCheckoutSession(at(outsider.ctx, ON_AT), { businessId: business.id, plan: "business_monthly" }, { config, fetcher }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    const { url } = await createCheckoutSession(on, { businessId: business.id, plan: "business_monthly" }, { config, fetcher });
    expect(url).toBe("https://checkout.stripe.test/c/cs_test_1");
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(sent.auth).toBe("Bearer sk_test_abc");
    expect(sent.body).toContain("mode=subscription");
    expect(sent.body).toContain("line_items[0][price_data][unit_amount]=24079"); // 199 + 21% TVA
    expect(sent.body).toContain("line_items[0][price_data][currency]=ron");
    expect(sent.body).toContain("subscription_data[metadata][netMinor]=19900");
    expect(sent.body).toContain("subscription_data[metadata][tvaMinor]=4179");
    expect(sent.body).toContain("payment_method_configuration=pmc_test_1"); // PAY1: wallet order lives in the processor
    expect(sent.body).not.toMatch(/bt[_ ]?pay/i); // PAY2
    expect(formEncode({ a: { b: [1, "x y"] } })).toEqual(["a%5Bb%5D%5B0%5D=1", "a%5Bb%5D%5B1%5D=x%20y"]);

    // the plan page may now state prices — excluding TVA, with TVA apart
    const view = await getPlanView(on, business.id);
    expect(view.paid!.prices.businessMonthly).toEqual({ netMinor: 19900, tvaMinor: 4179, grossMinor: 24079, tvaRateBp: 2100, currency: "RON" });
    expect(view.paid!.prices.businessYearly.netMinor).toBe(199000);
    expect(view.paid!.prices.featuredMonthly.netMinor).toBe(14900);

    // the sandbox run: staff only, never with a live key, allowed for the acceptance
    expect(await code(createSandboxCheckout(owner.ctx, { businessId: business.id, plan: "business_monthly" }, { config, fetcher }))).toBe("FORBIDDEN:console.errors.roleRequired");
    expect(await code(createSandboxCheckout(manager, { businessId: business.id, plan: "business_monthly" }, { config: { ...config, secretKey: "sk_live_x", testMode: false }, fetcher }))).toBe("FORBIDDEN:billing.errors.sandboxNeedsTestKey");
    expect((await createSandboxCheckout(manager, { businessId: business.id, plan: "business_yearly" }, { config, fetcher })).url).toContain("checkout.stripe.test");
  });

  it("a browser return grants nothing; only the verified webhook switches features, once per event", async () => {
    const { owner, business } = await mkBusiness();
    await t.db.update(businesses).set({ planLapsedAt: T0 }).where(eq(businesses.id, business.id)); // on the free tier
    const sub = { id: `sub_${business.id}`, customer: "cus_1", status: "incomplete", cancel_at_period_end: false, metadata: { businessId: business.id, plan: "business_monthly" } };

    // the person comes back from checkout: there is no code path that reads the redirect —
    // and the "checkout completed" event by itself changes nothing either
    expect((await send({ id: "evt_co", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", subscription: sub.id, metadata: sub.metadata } } }, ON_AT)).status).toBe("ignored");
    expect(await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id))).toHaveLength(0);
    await expect(assertBusinessCanCreate(at(owner.ctx, ON_AT), business.id)).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });

    // a subscription object alone is not a payment: recorded, not active, nothing granted
    await send(subEvent("evt_s1", "customer.subscription.created", sub), ON_AT);
    expect((await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id)))[0]).toMatchObject({ status: "past_due", plan: "business_monthly" });
    await expect(assertBusinessCanCreate(at(owner.ctx, ON_AT), business.id)).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });

    // the paid invoice, verified → active; the business can create again
    const periodEnd = Math.floor(ON_AT.getTime() / 1000) + 30 * 86400;
    const paid = { id: "evt_p1", type: "invoice.paid", livemode: false, data: { object: { id: "in_1", subscription: sub.id, payment_intent: "pi_1", amount_paid: 24079, lines: { data: [{ period: { end: periodEnd } }] } } } };
    expect((await send(paid, ON_AT)).status).toBe("processed");
    const [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
    expect(row).toMatchObject({ status: "active", graceUntil: null, sandbox: true });
    expect(row!.currentPeriodEnd!.getTime()).toBe(periodEnd * 1000);
    await assertBusinessCanCreate(at(owner.ctx, ON_AT), business.id);

    // replayed: same event id → handled once (one invoice, one job)
    expect((await send(paid, ON_AT)).status).toBe("duplicate");
    expect((await send(paid, new Date(ON_AT.getTime() + 60_000))).status).toBe("duplicate");
    const inv = await t.db.select().from(invoices).where(eq(invoices.subscriptionId, row!.id));
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ netMinor: 19900, tvaMinor: 4179, grossMinor: 24079, tvaRateBp: 2100, status: "pending" });
    expect((await t.db.select().from(jobs)).filter((j) => j.name === "invoicing.issue" && (j.payload as { invoiceId: string }).invoiceId === inv[0]!.id)).toHaveLength(1);
    // an old capture replayed later fails on the timestamp even with a fresh event id impossible to forge
    const raw = JSON.stringify({ ...paid, id: "evt_p1_again" });
    expect(await code(handleStripeWebhook(sys(new Date(ON_AT.getTime() + 10 * 60_000)), { rawBody: raw, signature: signStripePayload(raw, SECRET, ON_AT) }, { config }))).toBe("UNAUTHENTICATED:billing.errors.signature");
    // a paid invoice for a subscription we have not heard of yet → retry later, nothing recorded
    expect(await code(send({ id: "evt_early", type: "invoice.paid", livemode: false, data: { object: { id: "in_x", subscription: "sub_unknown", amount_paid: 1 } } }, ON_AT))).toBe("CONFLICT:billing.errors.unknownSubscription");
    expect(await t.db.select().from(processorEvents).where(eq(processorEvents.id, "evt_early"))).toHaveLength(0);

    // PAY3: the sandbox provider issues a fiscal reference with the TVA line; the provider webhook confirms
    expect(getInvoicingProvider({})).toBeNull();
    expect(await issueInvoice(sys(ON_AT), inv[0]!.id, { provider: null })).toBe("pending"); // no provider chosen: nothing pretends
    let seen: { lines: Array<{ netMinor: number; tvaMinor: number; grossMinor: number; tvaRateBp: number }> } | null = null;
    const sandbox = getInvoicingProvider({ INVOICING_PROVIDER: "sandbox" })!;
    expect(await issueInvoice(sys(ON_AT), inv[0]!.id, { provider: { name: "sandbox", issue: async (r) => ((seen = r), sandbox.issue(r)) } })).toBe("issued");
    expect(seen!.lines).toEqual([{ label: "EventDesk Business", netMinor: 19900, tvaRateBp: 2100, tvaMinor: 4179, grossMinor: 24079 }]);
    const [issued] = await t.db.select().from(invoices).where(eq(invoices.id, inv[0]!.id));
    expect(issued!.fiscalRef).toMatch(/^SANDBOX-EFACTURA-\d{8}-/);
    expect(issued!.number).toMatch(/^SBX-/);
    expect(await issueInvoice(sys(ON_AT), inv[0]!.id, { provider: sandbox })).toBe("issued"); // idempotent
    const env = { INVOICING_WEBHOOK_SECRET: "inv-secret-0123456789" };
    expect(await code(handleInvoicingWebhook(sys(ON_AT), { secret: "wrong", body: { invoiceId: issued!.id, status: "failed" } }, env))).toBe("UNAUTHENTICATED:billing.errors.signature");
    expect(await code(handleInvoicingWebhook(sys(ON_AT), { secret: env.INVOICING_WEBHOOK_SECRET, body: { invoiceId: issued!.id, status: "failed" } }, {}))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    expect(await handleInvoicingWebhook(sys(ON_AT), { secret: env.INVOICING_WEBHOOK_SECRET, body: { fiscalRef: issued!.fiscalRef, status: "cancelled" } }, env)).toMatchObject({ invoiceId: issued!.id, status: "cancelled" });
  });

  it("P25: a failed renewal gives 14 days of grace, then the plan lapses; cancelling takes effect at period end", async () => {
    const { owner, business } = await mkBusiness();
    const sub = { id: `sub_${business.id}`, customer: "cus_2", status: "active", cancel_at_period_end: false, metadata: { businessId: business.id, plan: "business_yearly" } };
    await send(subEvent(`evt_a_${business.id}`, "customer.subscription.created", sub), ON_AT);
    await send({ id: `evt_b_${business.id}`, type: "invoice.paid", livemode: false, data: { object: { id: `in_${business.id}`, subscription: sub.id, amount_paid: 240790 } } }, ON_AT);
    const failAt = new Date(ON_AT.getTime() + 365 * DAY);
    await send({ id: `evt_c_${business.id}`, type: "invoice.payment_failed", livemode: false, data: { object: { id: "in_f", subscription: sub.id } } }, failAt);
    let [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
    expect(row!.status).toBe("grace");
    expect(row!.graceUntil!.getTime()).toBe(failAt.getTime() + GRACE_DAYS * DAY);
    // a second failed retry does not extend the grace
    await send({ id: `evt_d_${business.id}`, type: "invoice.payment_failed", livemode: false, data: { object: { id: "in_f", subscription: sub.id } } }, new Date(failAt.getTime() + 5 * DAY));
    [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
    expect(row!.graceUntil!.getTime()).toBe(failAt.getTime() + GRACE_DAYS * DAY);
    // during grace everything works
    await runBillingSweep(sys(new Date(failAt.getTime() + 13 * DAY)));
    await assertBusinessCanCreate(at(owner.ctx, new Date(failAt.getTime() + 13 * DAY)), business.id);
    // after it: canceled → lapsed (P23 guard), and only NEW things stop
    const after = new Date(failAt.getTime() + 14 * DAY + 1000);
    expect((await runBillingSweep(sys(after))).ended).toBeGreaterThanOrEqual(1);
    [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
    expect(row!.status).toBe("canceled");
    const [b] = await t.db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(b!.planLapsedAt).not.toBeNull();
    await expect(assertBusinessCanCreate(at(owner.ctx, after), business.id)).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    expect((await runBillingSweep(sys(after))).ended).toBe(0); // idempotent

    // cancel at period end
    const two = await mkBusiness();
    const sub2 = { id: `sub_${two.business.id}`, customer: "cus_3", status: "active", cancel_at_period_end: false, metadata: { businessId: two.business.id, plan: "business_monthly" } };
    const end = Math.floor(ON_AT.getTime() / 1000) + 30 * 86400;
    await send(subEvent(`evt_a_${two.business.id}`, "customer.subscription.created", sub2), ON_AT);
    await send({ id: `evt_b_${two.business.id}`, type: "invoice.paid", livemode: false, data: { object: { id: `in_${two.business.id}`, subscription: sub2.id, amount_paid: 24079, lines: { data: [{ period: { end } }] } } } }, ON_AT);
    await send(subEvent(`evt_c_${two.business.id}`, "customer.subscription.updated", { ...sub2, cancel_at_period_end: true, current_period_end: end }), ON_AT);
    [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, two.business.id));
    expect(row).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await runBillingSweep(sys(new Date(end * 1000 - DAY)));
    await assertBusinessCanCreate(at(two.owner.ctx, new Date(end * 1000 - DAY)), two.business.id); // still running until the period ends
    await runBillingSweep(sys(new Date(end * 1000 + 1000)));
    await expect(assertBusinessCanCreate(at(two.owner.ctx, new Date(end * 1000 + 1000)), two.business.id)).rejects.toMatchObject({ messageKey: "business.errors.lapsed" });
    // MON3: businesses that bought nothing are on the permanent free tier once paid tiers are in force
    const three = await mkBusiness();
    await runBillingSweep(sys(ON_AT));
    expect((await t.db.select().from(businesses).where(eq(businesses.id, three.business.id)))[0]!.planLapsedAt).not.toBeNull();
  });

  it("a paid Featured subscription opens its slot; cancelling closes it", async () => {
    const { business } = await mkBusiness();
    const { listings } = await import("@ed/db");
    const [listing] = await t.db.insert(listings).values({ businessId: business.id, name: "Foto Test", status: "live", claimed: true }).returning();
    const sub = { id: `sub_f_${business.id}`, customer: "cus_f", status: "active", metadata: { businessId: business.id, plan: "featured_monthly", listingId: listing!.id, categoryId: "cat_x", countyCode: "CJ" } };
    await send(subEvent(`evt_fa_${business.id}`, "customer.subscription.created", sub), ON_AT);
    expect(await t.db.select().from(featuredSlots).where(eq(featuredSlots.listingId, listing!.id))).toHaveLength(0); // not paid yet
    await send({ id: `evt_fb_${business.id}`, type: "invoice.paid", livemode: false, data: { object: { id: `in_f_${business.id}`, subscription: sub.id, amount_paid: 18029 } } }, ON_AT);
    expect(await t.db.select().from(featuredSlots).where(eq(featuredSlots.listingId, listing!.id))).toMatchObject([{ active: true, categoryId: "cat_x", countyCode: "CJ" }]);
    await send(subEvent(`evt_fc_${business.id}`, "customer.subscription.deleted", { ...sub, status: "canceled" }), ON_AT);
    expect(await t.db.select().from(featuredSlots).where(eq(featuredSlots.listingId, listing!.id))).toMatchObject([{ active: false }]);
  });

  it("P26: a refund is a request; it needs a second person and is refused in single-operator mode", async () => {
    const { business } = await mkBusiness();
    const sub = { id: `sub_r_${business.id}`, customer: "cus_r", status: "active", metadata: { businessId: business.id, plan: "business_monthly" } };
    await send(subEvent(`evt_ra_${business.id}`, "customer.subscription.created", sub), ON_AT);
    await send({ id: `evt_rb_${business.id}`, type: "invoice.paid", livemode: false, data: { object: { id: `in_r_${business.id}`, subscription: sub.id, payment_intent: "pi_r", amount_paid: 24079 } } }, ON_AT);
    const [row] = await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id));
    const [inv] = await t.db.select().from(invoices).where(eq(invoices.subscriptionId, row!.id));
    const m = at(manager, ON_AT) as typeof manager;

    expect(await code(requestRefund(at(admin, ON_AT), { subscriptionId: row!.id, kind: "refund", amountMinor: 24079, reason: "Client taxat de două ori." }))).toBe("FORBIDDEN:console.errors.roleRequired");
    const { refund, approval } = await requestRefund(m, { subscriptionId: row!.id, invoiceId: inv!.id, kind: "refund", amountMinor: 24079, reason: "Client taxat de două ori." });
    expect(refund.state).toBe("requested");
    // nothing has moved; the requester cannot approve; a job exists only after approval
    expect(await code(approveRequest(m, approval.id))).toMatch(/^FORBIDDEN/);
    expect((await t.db.select().from(jobs)).filter((j) => j.name === "billing.refund-execute")).toHaveLength(0);
    expect(await executeRefund(sys(ON_AT), refund.id, { config })).toBe("requested");

    const calls: string[] = [];
    const fetcher: Fetcher = async (url, init) => (calls.push(`${url}?${decodeURIComponent(init.body ?? "")}`), { ok: true, status: 200, json: async () => ({ id: "re_1" }) });
    await approveRequest(at(admin, ON_AT), approval.id);
    const [approved] = await t.db.select().from(refundRequests).where(eq(refundRequests.id, refund.id));
    expect(approved).toMatchObject({ state: "approved", approvedByStaffId: admin.staffId, requestedByStaffId: manager.staffId });
    expect(await executeRefund(sys(ON_AT), refund.id, { config, fetcher })).toBe("done");
    expect(calls).toEqual(["https://api.stripe.com/v1/refunds?payment_intent=pi_r&amount=24079"]);
    expect(await executeRefund(sys(ON_AT), refund.id, { config, fetcher })).toBe("done"); // never twice
    expect(calls).toHaveLength(1);

    // single-operator mode (M4): refused outright, and an approval already queued cannot run
    const second = await requestRefund(m, { subscriptionId: row!.id, kind: "credit", amountMinor: 5000, reason: "Credit de curtoazie pentru întârziere." });
    await t.db.update(staffMembers).set({ active: false });
    await t.db.update(staffMembers).set({ active: true }).where(eq(staffMembers.id, manager.staffId));
    await expect(requestRefund(m, { subscriptionId: row!.id, kind: "refund", amountMinor: 100, reason: "Singur în consolă, test." })).rejects.toMatchObject({ code: "FORBIDDEN", messageKey: "billing.errors.singleOperator" });
    await t.db.update(staffMembers).set({ active: true });
    expect((await t.db.select().from(approvalRequests).where(eq(approvalRequests.id, second.approval.id)))[0]!.state).toBe("pending");
    expect((await t.db.select().from(refundRequests).where(eq(refundRequests.id, second.refund.id)))[0]!.state).toBe("requested");
  });

  it("with the switch OFF: live events are ignored, test events are recorded but change nothing for the business", async () => {
    await t.db.update(monetizationSwitch).set({ state: "off", noticeStartsAt: null, effectiveAt: null });
    const { owner, business } = await mkBusiness();
    const sub = { id: `sub_off_${business.id}`, customer: "cus_o", status: "active", metadata: { businessId: business.id, plan: "business_monthly" } };
    expect((await send({ ...subEvent("evt_live_1", "customer.subscription.created", sub), livemode: true })).status).toBe("ignored");
    expect(await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id))).toHaveLength(0);
    await send(subEvent("evt_off_1", "customer.subscription.created", sub));
    await send({ id: "evt_off_2", type: "invoice.paid", livemode: false, data: { object: { id: "in_off", subscription: sub.id, amount_paid: 24079 } } });
    await send(subEvent("evt_off_3", "customer.subscription.deleted", { ...sub, status: "canceled" }));
    expect(await t.db.select().from(subscriptions).where(eq(subscriptions.businessId, business.id))).toMatchObject([{ status: "canceled", sandbox: true }]);
    // the acceptance run left the business exactly as free as before
    expect((await t.db.select().from(businesses).where(eq(businesses.id, business.id)))[0]!.planLapsedAt).toBeNull();
    await assertBusinessCanCreate(owner.ctx, business.id);
    expect((await runBillingSweep(sys())).freeTier).toBe(0);
    expect((await getPlanView(owner.ctx, business.id)).paid).toBeNull();
  });
});
