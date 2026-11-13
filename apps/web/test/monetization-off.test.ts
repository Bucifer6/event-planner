import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { signStripePayload } from "@ed/core/billing";
import { accounts, businessMembers, businesses, closeDb, eq, invoices, monetizationSwitch, processorEvents, subscriptions } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// MON1 / P24 release gate: while the monetization switch is OFF no pricing, checkout,
// plan-purchase or card-entry route or screen is reachable — and the only billing routes
// that exist (the two webhooks) are dormant until the operator configures their secrets.

const ROOT = resolve(__dirname, "..");
const APP = join(ROOT, "app");
const SECRET = "whsec_route_test_0123456789";

let t: TestDb;
let stripePOST: (r: Request) => Promise<Response>;
let invoicingPOST: (r: Request) => Promise<Response>;

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["monetization"]);
  await closeDb();
  process.env.DATABASE_URL = t.url;
  ({ POST: stripePOST } = await import("../app/api/webhooks/stripe/route"));
  ({ POST: invoicingPOST } = await import("../app/api/webhooks/invoicing/route"));
});
afterAll(async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.INVOICING_WEBHOOK_SECRET;
  await closeDb();
  await t.close();
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");
const post = (handler: (r: Request) => Promise<Response>, body: string, headers: Record<string, string> = {}) =>
  handler(new Request("https://app.example.test/api/webhooks/x", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));

describe("no pricing or checkout route exists (MON1)", () => {
  const files = walk(APP);

  it("the app has no checkout, pricing, payment or card route at all", () => {
    const routes = files.filter((f) => /(page|route)\.tsx?$/.test(f)).map(rel);
    expect(routes.length).toBeGreaterThan(40);
    const priced = routes.filter((r) => /checkout|pricing|preturi|prețuri|pret\b|payment-method|card|subscribe|upgrade|billing/i.test(r.replace(/\/cookie-notice\//, "/")));
    expect(priced).toEqual([]);
    // the only billing routes are the two dormant webhooks
    expect(routes.filter((r) => r.startsWith("app/api/webhooks/")).sort()).toEqual(
      expect.arrayContaining(["app/api/webhooks/invoicing/route.ts", "app/api/webhooks/stripe/route.ts"]),
    );
  });

  it("only one component can render a price or start a purchase, and it is gated by the switch", () => {
    const tsx = files.filter((f) => /\.tsx?$/.test(f));
    const src = (f: string) => readFileSync(f, "utf8");
    // 1. who may touch prices / checkout at all
    const allowed = new Set([
      "app/(app)/business/[businessId]/plan/_paid.tsx", // rendered only when view.paid (monetization ON)
      "app/(app)/business/[businessId]/plan/page.tsx",
      "app/actions/billing.ts",
      "app/console/commercial/page.tsx", // staff console (W6)
      "app/console/commercial/SandboxCheckout.tsx",
      "app/api/webhooks/stripe/route.ts",
    ]);
    const touching = tsx.filter((f) => /@ed\/core\/billing|@\/app\/actions\/billing|startCheckoutAction|PaidPlan|billing\.paid\.|"paid\./.test(src(f))).map(rel);
    expect(touching.filter((f) => !allowed.has(f))).toEqual([]);

    // 2. the plan page renders <PaidPlan> in exactly one place: behind `view.paid`
    const page = src(join(APP, "(app)/business/[businessId]/plan/page.tsx"));
    expect(page.match(/<PaidPlan/g)?.length).toBe(1);
    expect(page).toMatch(/\{view\.paid \? <PaidPlan[^\n]*\/> : null\}/);
    // …and uses no price-bearing message or formatter itself
    const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(pageCode).not.toMatch(/formatMoney|"paid\.|price|Minor/i);
    // 3. `paid` is produced only when the switch is on
    const core = readFileSync(resolve(ROOT, "../../packages/core/src/billing.ts"), "utf8");
    expect(core).toMatch(/if \(monetization\.phase !== "on"\) return \{ \.\.\.base, paid: null \};/);
    expect(core).toMatch(/export async function createCheckoutSession[\s\S]{0,200}await assertMonetizationOn\(ctx\);/);
    expect(core).toMatch(/export async function cancelSubscription[\s\S]{0,200}await assertMonetizationOn\(ctx\);/);

    // 4. no price is written into any screen: the pilot figures exist only as the operator
    //    placeholder constant in core and never in a .tsx file or a message file
    const figures = /\b(199|1[.,\s]?990|149|240[.,]79)\b/;
    const withFigures = tsx.filter((f) => f.endsWith(".tsx") && src(f).split("\n").some((line) => figures.test(line) && /RON|lei|TVA|pre[tț]|price|lun[aă]|month/i.test(line))).map(rel);
    expect(withFigures).toEqual([]);
    for (const locale of ["ro", "en"]) {
      const dir = resolve(ROOT, `../../packages/i18n/messages/${locale}`);
      for (const name of readdirSync(dir)) {
        // the public marketing/legal copy states the future pilot prices in words (LAU6) — outside the app
        if (["site.json", "legal.json", "guides.json"].includes(name)) continue;
        const hits = readFileSync(join(dir, name), "utf8").split("\n").filter((line) => figures.test(line) && /RON|lei\b/i.test(line));
        expect(hits, `${locale}/${name}`).toEqual([]);
      }
    }
    // 5. the free-phase wording a business sees is the plain fact
    const ro = JSON.parse(readFileSync(resolve(ROOT, "../../packages/i18n/messages/ro/billing.json"), "utf8")) as { plan: Record<string, unknown> };
    expect(ro.plan.leadFree).toBe("Totul este gratuit în perioada de lansare.");
    expect(JSON.stringify(ro.plan)).not.toMatch(/RON|lei\b|\d+\s*%|în curând|coming soon/i);
  });
});

describe("the billing routes are dormant, and a redirect grants nothing (MON1, P24)", () => {
  const event = (businessId: string, id: string, type: string, object: Record<string, unknown>) => JSON.stringify({ id, type, livemode: false, data: { object: { metadata: { businessId, plan: "business_monthly" }, ...object } } });

  it("with nothing configured both webhooks answer 404 to anything", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.INVOICING_WEBHOOK_SECRET;
    const body = event("x", "evt_1", "invoice.paid", {});
    expect((await post(stripePOST, body, { "stripe-signature": signStripePayload(body, SECRET, new Date()) })).status).toBe(404);
    expect((await post(stripePOST, "")).status).toBe(404);
    expect((await post(invoicingPOST, JSON.stringify({ invoiceId: "x", status: "issued" }), { authorization: "Bearer anything" })).status).toBe(404);
    expect(await t.db.select().from(processorEvents)).toHaveLength(0);
  });

  it("configured: bad, stale and missing signatures are refused; a good one is handled once; the business stays as free as before", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const accountId = newId();
    await t.db.insert(accounts).values({ id: accountId, kind: "email", email: "plan@example.test" });
    const [business] = await t.db.insert(businesses).values({ name: "Firma Test SRL", ownerAccountId: accountId }).returning();
    await t.db.insert(businessMembers).values({ businessId: business!.id, accountId, role: "owner" });
    const sub = { id: "sub_route_1", customer: "cus_1", status: "active" };
    const created = event(business!.id, "evt_r1", "customer.subscription.created", sub);

    expect((await post(stripePOST, created)).status).toBe(401);
    expect((await post(stripePOST, created, { "stripe-signature": signStripePayload(created, "whsec_wrong", new Date()) })).status).toBe(401);
    expect((await post(stripePOST, created, { "stripe-signature": signStripePayload(created, SECRET, new Date(Date.now() - 6 * 60_000)) })).status).toBe(401);
    expect((await post(stripePOST, "{not json", { "stripe-signature": signStripePayload("{not json", SECRET, new Date()) })).status).toBe(400);
    expect(await t.db.select().from(subscriptions)).toHaveLength(0);

    // a "success" return from checkout: there is no route that takes it — the plan page ignores
    // the query string — and the checkout-completed event alone changes nothing either
    const completed = JSON.stringify({ id: "evt_r0", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_1", payment_status: "paid", subscription: "sub_route_1" } } });
    const res0 = await post(stripePOST, completed, { "stripe-signature": signStripePayload(completed, SECRET, new Date()) });
    expect(await res0.json()).toEqual({ ok: true, status: "ignored" });
    expect(await t.db.select().from(subscriptions)).toHaveLength(0);

    const ok = await post(stripePOST, created, { "stripe-signature": signStripePayload(created, SECRET, new Date()) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: "processed" });
    const again = await post(stripePOST, created, { "stripe-signature": signStripePayload(created, SECRET, new Date()) });
    expect(await again.json()).toEqual({ ok: true, status: "duplicate" });
    const paid = JSON.stringify({ id: "evt_r2", type: "invoice.paid", livemode: false, data: { object: { id: "in_route_1", subscription: "sub_route_1", amount_paid: 24079 } } });
    expect((await post(stripePOST, paid, { "stripe-signature": signStripePayload(paid, SECRET, new Date()) })).status).toBe(200);
    // out of order → 409 so the processor retries
    const early = JSON.stringify({ id: "evt_r3", type: "invoice.paid", livemode: false, data: { object: { id: "in_route_2", subscription: "sub_unknown", amount_paid: 1 } } });
    expect((await post(stripePOST, early, { "stripe-signature": signStripePayload(early, SECRET, new Date()) })).status).toBe(409);
    // a live-mode event while the switch is off is ignored outright
    const live = JSON.stringify({ id: "evt_r4", type: "customer.subscription.deleted", livemode: true, data: { object: { ...sub, metadata: { businessId: business!.id, plan: "business_monthly" } } } });
    expect(await (await post(stripePOST, live, { "stripe-signature": signStripePayload(live, SECRET, new Date()) })).json()).toEqual({ ok: true, status: "ignored" });

    // switch OFF: the test run is recorded as sandbox data and nothing about the business changed
    expect(await t.db.select().from(monetizationSwitch)).toMatchObject([{ state: "off" }]);
    expect(await t.db.select().from(subscriptions)).toMatchObject([{ status: "active", sandbox: true }]);
    expect((await t.db.select().from(businesses).where(eq(businesses.id, business!.id)))[0]!.planLapsedAt).toBeNull();
    expect(await t.db.select().from(invoices)).toMatchObject([{ netMinor: 19900, tvaMinor: 4179, grossMinor: 24079, status: "pending" }]);

    // the invoicing webhook: shared secret, constant-time
    process.env.INVOICING_WEBHOOK_SECRET = "inv-secret-0123456789abcdef";
    const [inv] = await t.db.select().from(invoices);
    const upd = JSON.stringify({ invoiceId: inv!.id, status: "issued", number: "SBX-1", fiscalRef: "SANDBOX-EFACTURA-1" });
    expect((await post(invoicingPOST, upd)).status).toBe(401);
    expect((await post(invoicingPOST, upd, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(invoicingPOST, "{", { authorization: "Bearer inv-secret-0123456789abcdef" })).status).toBe(400);
    expect((await post(invoicingPOST, JSON.stringify({ invoiceId: inv!.id, status: "paid" }), { authorization: "Bearer inv-secret-0123456789abcdef" })).status).toBe(400);
    expect((await post(invoicingPOST, upd, { authorization: "Bearer inv-secret-0123456789abcdef" })).status).toBe(200);
    expect((await t.db.select().from(invoices))[0]).toMatchObject({ status: "issued", number: "SBX-1", fiscalRef: "SANDBOX-EFACTURA-1" });
  });
});
