import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@eventdesk/db';
import { AppError, now, startOfUtcDay } from '@eventdesk/shared';
import { audit } from './audit';
import { createApprovalRequest, requireStaff, staffCount } from './staff';
import { setPlanLapsed } from './bizoccasions';

// P-12 (MON1-MON5, P24-P28, PAY1-PAY5): billing is BUILT BUT DORMANT. While the
// monetization switch is OFF there is no pricing/checkout/card UI anywhere (MON1)
// and this module changes nothing. Feature grants flip ONLY from a verified
// processor webhook (P24) — never from a browser redirect. Refunds/credits need a
// second person (P26, W9 queue). Fiscal invoicing (PAY3/PAY4) goes to the RO
// e-Factura-connected provider (SmartBill/Oblio) by webhook; in sandbox/test mode
// the invoice is generated locally with the TVA line separate and a SANDBOX ref.

export const TVA_RATE = 0.19; // PAY4: prices excl. TVA, TVA shown separately
export const PILOT_PRICES_BANI = {
  businessMonthly: 199_00,
  businessYearly: 1990_00,
  featuredMonthly: 149_00,
}; // MON3, excl. TVA

export async function recordBillingAcceptance(staffAccountId: string, notes: string) {
  await requireStaff(staffAccountId, 'commercial_manager');
  const row = await prisma.billingAcceptance.upsert({
    where: { id: 'main' },
    update: { testModePassedAt: now(), verifiedBy: staffAccountId, notes },
    create: { id: 'main', testModePassedAt: now(), verifiedBy: staffAccountId, notes },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: 'billing_acceptance_recorded',
    objectType: 'BillingAcceptance',
    objectId: 'main',
    after: { testMode: true, notes },
  });
  return row;
}

export async function billingAcceptedInTestMode(): Promise<boolean> {
  const row = await prisma.billingAcceptance.findUnique({ where: { id: 'main' } });
  return !!row?.testModePassedAt;
}

// MON4: the switch can go ON only after billing acceptance in test mode.
export async function canEnableMonetization(): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (!(await billingAcceptedInTestMode()))
    reasons.push('billing acceptance in test mode missing (MON4)');
  if ((await staffCount()) < 2) reasons.push('two staff members required (W9/M4)');
  return { ok: reasons.length === 0, reasons };
}

// P24: Stripe webhook signature verification — HMAC_SHA256(secret, `${t}.${payload}`)
// compared against the v1 signature, with a 5-minute tolerance. No SDK needed.
export function verifyWebhookSignature(
  rawBody: string,
  sigHeader: string,
  secret: string
): boolean {
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k, v];
    })
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(now().getTime() / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// P24/P25: verified webhook events only. A browser redirect changes nothing.
export async function handleProcessorWebhook(rawBody: string, sigHeader: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) throw new AppError('INVALID_INPUT', 'Webhook secret not configured.');
  if (!verifyWebhookSignature(rawBody, sigHeader, secret)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature.');
  }
  const event = JSON.parse(rawBody) as {
    type: string;
    data: { object: Record<string, unknown> };
  };
  switch (event.type) {
    case 'invoice.paid': {
      const inv = event.data.object;
      const subId = String(inv.subscription ?? '');
      if (subId) {
        const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: subId } });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { state: 'active', graceUntil: null },
          });
        }
      }
      await audit({
        actorKind: 'system',
        action: 'webhook_invoice_paid',
        objectType: 'Invoice',
        after: { invoice: inv.id },
      });
      break;
    }
    case 'invoice.payment_failed': {
      // P25: 14 days of grace after a failed renewal
      const inv = event.data.object;
      const subId = String(inv.subscription ?? '');
      const sub = await prisma.subscription.findFirst({ where: { stripeSubscriptionId: subId } });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { state: 'past_due', graceUntil: new Date(now().getTime() + 14 * 86_400_000) },
        });
      }
      await audit({
        actorKind: 'system',
        action: 'webhook_payment_failed_grace14d',
        objectType: 'Subscription',
        objectId: sub?.id ?? undefined,
        after: { invoice: inv.id },
      });
      break;
    }
    case 'customer.subscription.updated': {
      // P25: cancellation takes effect at period end
      const s = event.data.object;
      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: String(s.id) },
      });
      if (sub) {
        const cancelAtPeriodEnd = !!s.cancel_at_period_end;
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { cancelAtPeriodEnd: cancelAtPeriodEnd },
        });
        if (cancelAtPeriodEnd && s.status === 'canceled') {
          await prisma.subscription.update({ where: { id: sub.id }, data: { state: 'lapsed' } });
          await setPlanLapsed(sub.businessId, true); // P23
        }
      }
      await audit({
        actorKind: 'system',
        action: 'webhook_subscription_updated',
        objectType: 'Subscription',
        objectId: sub?.id ?? undefined,
      });
      break;
    }
    default:
      await audit({
        actorKind: 'system',
        action: 'webhook_ignored',
        objectType: 'Webhook',
        after: { type: event.type },
      });
  }
}

// P24/PAY1/PAY2 (dormant): checkout only exists while MON is ON and a processor key
// is configured; wallet methods offered in the order Apple Pay, Google Pay, card.
export async function createCheckoutSession(
  businessId: string,
  plan: 'business_monthly' | 'business_yearly' | 'featured_monthly'
) {
  const mon = await prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } });
  if (mon.state !== 'ON')
    throw new AppError('FORBIDDEN', 'Monetization is OFF — no checkout exists (MON1/MON5).');
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key) throw new AppError('INVALID_INPUT', 'Processor not configured in this environment.');
  const priceBani =
    plan === 'business_monthly'
      ? PILOT_PRICES_BANI.businessMonthly
      : plan === 'business_yearly'
        ? PILOT_PRICES_BANI.businessYearly
        : PILOT_PRICES_BANI.featuredMonthly;
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price_data][currency]': 'ron',
      'line_items[0][price_data][unit_amount]': String(priceBani), // PAY4: excl. TVA
      'line_items[0][price_data][product_data][name]': `EventDesk ${plan}`,
      'line_items[0][quantity]': '1',
      'payment_method_types[0]': 'apple_pay', // PAY1/PAY2 order
      'payment_method_types[1]': 'google_pay',
      'payment_method_types[2]': 'card',
      success_url: `${process.env.APP_URL ?? ''}/business?billing=success`, // redirect alone grants nothing (P24)
      cancel_url: `${process.env.APP_URL ?? ''}/business?billing=cancel`,
      'metadata[businessId]': businessId,
    }),
  });
  if (!res.ok) throw new AppError('INVALID_INPUT', 'Processor rejected the checkout session.');
  const session = (await res.json()) as { id: string; url: string };
  await audit({
    actorKind: 'system',
    action: 'checkout_session_created',
    objectType: 'Subscription',
    after: { sessionId: session.id, plan, priceBani },
  });
  return session;
}

// PAY3/PAY4: fiscal invoice with TVA separate, prices excl. TVA. Provider webhook
// (SmartBill/Oblio) only when EFACTURA_PROVIDER + key are configured; otherwise the
// sandbox invoice is generated locally with a SANDBOX fiscal reference (gate M2).
export async function issueInvoice(input: {
  businessId: string;
  subscriptionId?: string;
  amountBani: number; // excl. TVA (PAY4)
  description: string;
}) {
  const tvaBani = Math.round(input.amountBani * TVA_RATE);
  const invoice = await prisma.invoice.create({
    data: {
      businessId: input.businessId,
      subscriptionId: input.subscriptionId ?? null,
      number: `ED-${now().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      amountBani: input.amountBani,
      tvaBani,
      currency: 'RON',
      status: 'issued',
      issuedAt: now(),
    },
  });
  let fiscalRef: string;
  const provider = process.env.EFACTURA_PROVIDER ?? '';
  const providerKey = process.env.EFACTURA_API_KEY ?? '';
  if (provider && providerKey) {
    const res = await fetch(`https://api.${provider}.ro/v1/efactura`, {
      method: 'POST',
      headers: { authorization: `Bearer ${providerKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        number: invoice.number,
        amountExclTvaBani: input.amountBani,
        tvaBani,
        currency: 'RON',
        description: input.description,
      }),
    });
    if (!res.ok) throw new AppError('INVALID_INPUT', 'e-Factura provider rejected the invoice.');
    fiscalRef = String((await res.json()).ref ?? '');
  } else {
    fiscalRef = `SANDBOX-${invoice.number}`; // test-mode invoice, end-to-end in sandbox (M2)
  }
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { fiscalRef },
  });
  await audit({
    actorKind: 'system',
    action: 'invoice_issued',
    objectType: 'Invoice',
    objectId: invoice.id,
    after: {
      number: invoice.number,
      amountBani: input.amountBani,
      tvaBani,
      fiscalRef,
      sandbox: fiscalRef.startsWith('SANDBOX-'),
    },
  });
  return updated;
}

// P26: refunds and credits need a request AND a second person's approval (W9 queue);
// nothing is refunded by a single actor.
export async function requestRefund(
  subscriptionId: string,
  amountBani: number,
  reason: string,
  requesterId: string
) {
  await requireStaff(requesterId, 'commercial_manager');
  return createApprovalRequest('refund', { subscriptionId, amountBani, reason }, requesterId);
}

// W6: free-phase cost dashboard — counts and storage only, never planner content.
export async function freePhaseCostDashboard() {
  const [accounts, businesses, listings, occasions, enquiries, assets] = await Promise.all([
    prisma.account.count(),
    prisma.business.count(),
    prisma.listing.count(),
    prisma.occasion.count(),
    prisma.enquiry.count(),
    prisma.asset.count(),
  ]);
  const assetBytes = await prisma.asset.aggregate({ _sum: { sizeBytes: true } });
  return {
    accounts,
    businesses,
    listings,
    occasions,
    enquiries,
    assets,
    storageBytes: assetBytes._sum.sizeBytes ?? 0,
    monetization: (await prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } }))
      .state,
  };
}

// P15: directory search stats are daily aggregates per category x county — no
// visitor identifier (D4/INF11).
export async function recordDirectorySearch(categoryId: string, countyId: string) {
  const day = startOfUtcDay(now());
  await prisma.directorySearchDaily.upsert({
    where: { day_categoryId_countyId: { day, categoryId, countyId } },
    update: { searches: { increment: 1 } },
    create: { day, categoryId, countyId, searches: 1 },
  });
}

export async function last30DaysSearches(categoryId: string, countyId: string): Promise<number> {
  const since = new Date(now().getTime() - 30 * 86_400_000);
  const rows = await prisma.directorySearchDaily.findMany({
    where: { categoryId, countyId, day: { gte: since } },
    select: { searches: true },
  });
  return rows.reduce((a, r) => a + r.searches, 0);
}
