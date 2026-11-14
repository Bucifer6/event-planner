import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { businesses } from "./business";
import { staffMembers } from "./staff";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";

// The monetization switch and the DORMANT billing tables (MON1–MON5, P24–P28, PAY1–PAY5).
// Written only through @ed/core/{monetization,billing,invoicing}.
//
// INVARIANT 7: nothing in this file is an input of the organic directory order.

export const MONETIZATION_STATES = ["off", "on"] as const;
export type MonetizationState = (typeof MONETIZATION_STATES)[number];
export const MONETIZATION_SWITCH_ID = "switch";

/** ONE row (id = "switch"). No row = OFF. `on` takes effect only from `effectiveAt` (P28). */
export const monetizationSwitch = pgTable(
  "monetization_switch",
  {
    id: text("id").primaryKey().default(MONETIZATION_SWITCH_ID),
    state: text("state").$type<MonetizationState>().notNull().default("off"),
    /** Start of the 60-day public notice. */
    noticeStartsAt: timestamptz("notice_starts_at"),
    /** When paid tiers begin. NULL while off. */
    effectiveAt: timestamptz("effective_at"),
    updatedAt: updatedAt(),
  },
  (t) => [check("monetization_switch_single_ck", sql`${t.id} = 'switch'`), check("monetization_switch_state_ck", sql`${t.state} in ('off', 'on')`)],
);

/** MON2: every change of the switch — who asked, who approved, the notice dates. Append-only by use. */
export const monetizationHistory = pgTable(
  "monetization_history",
  {
    id: id(),
    change: text("change").$type<"enable" | "disable">().notNull(),
    requestedByStaffId: ref("requested_by_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    approverStaffIds: jsonb("approver_staff_ids").$type<string[]>().notNull().default([]),
    approvalRequestId: text("approval_request_id"),
    acceptanceId: text("acceptance_id"),
    noticeStartsAt: timestamptz("notice_starts_at"),
    effectiveAt: timestamptz("effective_at"),
    at: timestamptz("at").notNull(),
  },
  (t) => [index("monetization_history_at_idx").on(t.at)],
);

/** One row per reminder actually sent, so a retried job never sends twice. */
export const monetizationReminders = pgTable(
  "monetization_reminders",
  {
    id: id(),
    effectiveAt: timestamptz("effective_at").notNull(),
    daysBefore: integer("days_before").notNull(),
    businesses: integer("businesses").notNull().default(0),
    sentAt: timestamptz("sent_at").notNull(),
  },
  (t) => [uniqueIndex("monetization_reminders_uq").on(t.effectiveAt, t.daysBefore)],
);

/** MON4: the recorded acceptance of the billing stack in TEST mode. */
export const billingAcceptances = pgTable("billing_acceptances", {
  id: id(),
  recordedByStaffId: ref("recorded_by_staff_id")
    .notNull()
    .references(() => staffMembers.id, { onDelete: "restrict" }),
  /** Where the evidence is (test-run report, ticket, document reference). */
  evidenceRef: text("evidence_ref").notNull(),
  notes: text("notes"),
  at: timestamptz("at").notNull(),
});

export const SUBSCRIPTION_PLANS = ["business_monthly", "business_yearly", "featured_monthly"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "grace", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** P24: written ONLY by the verified webhook handler and the nightly sweep. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    plan: text("plan").$type<SubscriptionPlan>().notNull(),
    status: text("status").$type<SubscriptionStatus>().notNull(),
    currentPeriodEnd: timestamptz("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** P25: 14 days after a failed renewal. */
    graceUntil: timestamptz("grace_until"),
    /** Featured only: what the placement is for. */
    listingId: text("listing_id"),
    categoryId: text("category_id"),
    countyCode: text("county_code"),
    /** True for processor test-mode objects: recorded, but never changes what a business can do. */
    sandbox: boolean("sandbox").notNull().default(false),
    processorCustomerId: text("processor_customer_id"),
    processorSubscriptionId: text("processor_subscription_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("subscriptions_business_idx").on(t.businessId, t.status),
    uniqueIndex("subscriptions_processor_uq").on(t.processorSubscriptionId),
    check("subscriptions_status_ck", sql`${t.status} in ('active', 'past_due', 'grace', 'canceled')`),
  ],
);

/** Processor events already handled (idempotency per event id, P24). */
export const processorEvents = pgTable("processor_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamptz("received_at").notNull(),
});

export const INVOICE_STATUSES = ["pending", "issued", "failed", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** PAY3: one fiscal invoice per charge, issued by the connected invoicing provider. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    subscriptionId: ref("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    businessId: ref("business_id").notNull(),
    /** The provider's invoice number; NULL until issued. */
    number: text("number"),
    /** Reference of the fiscal document (RO e-Factura id or the sandbox reference). */
    fiscalRef: text("fiscal_ref"),
    provider: text("provider"),
    netMinor: moneyMinor("net_minor").notNull(),
    tvaMinor: moneyMinor("tva_minor").notNull(),
    grossMinor: moneyMinor("gross_minor").notNull(),
    /** TVA rate in basis points (2100 = 21%). 0 = not TVA-registered (PAY4). */
    tvaRateBp: integer("tva_rate_bp").notNull(),
    currency: currency(),
    status: text("status").$type<InvoiceStatus>().notNull().default("pending"),
    pdfUrl: text("pdf_url"),
    pdfAssetId: text("pdf_asset_id"),
    processorInvoiceId: text("processor_invoice_id"),
    processorPaymentId: text("processor_payment_id"),
    issuedAt: timestamptz("issued_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_subscription_idx").on(t.subscriptionId),
    uniqueIndex("invoices_processor_uq").on(t.processorInvoiceId),
    check("invoices_sum_ck", sql`${t.netMinor} + ${t.tvaMinor} = ${t.grossMinor}`),
  ],
);

export const REFUND_STATES = ["requested", "approved", "rejected", "done"] as const;
export type RefundState = (typeof REFUND_STATES)[number];

/** P26: a refund or credit is a request; it has effect only when a second person approves. */
export const refundRequests = pgTable(
  "refund_requests",
  {
    id: id(),
    subscriptionId: ref("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id"),
    kind: text("kind").$type<"refund" | "credit">().notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    currency: currency(),
    reason: text("reason").notNull(),
    state: text("state").$type<RefundState>().notNull().default("requested"),
    approvalRequestId: text("approval_request_id"),
    requestedByStaffId: ref("requested_by_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    approvedByStaffId: text("approved_by_staff_id"),
    processorRef: text("processor_ref"),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
  },
  (t) => [index("refund_requests_state_idx").on(t.state, t.createdAt), check("refund_requests_amount_ck", sql`${t.amountMinor} > 0`)],
);
