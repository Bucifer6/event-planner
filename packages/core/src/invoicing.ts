import { businesses, eq, invoices, subscriptions } from "@ed/db";
import { defineJob } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { hashEquals, hashToken } from "@ed/shared/ids";
import { z } from "zod";
import { audit } from "./audit";
import { requireSystem, type Ctx } from "./context";

// Fiscal invoicing (PAY3, PAY4): one Romanian fiscal invoice per charge, issued by a
// connected provider (SmartBill, Oblio or an equivalent) and transmitted through RO
// e-Factura by that provider. The platform never relies on the processor's invoices.
//
//   registerInvoicingProvider(name, factory)      the connector seam
//   issueInvoice(systemCtx, invoiceId)            job "invoicing.issue" (queued by the webhook)
//   handleInvoicingWebhook(systemCtx, { secret, body })   the provider reports the fiscal state
//
// OPERATOR-OWNED: which provider (INVOICING_PROVIDER) and its credentials. Built in here is
// only `sandbox`, which issues a SANDBOX fiscal reference with its TVA line so the gate-M2
// end-to-end test runs without a contract. With no provider configured nothing is issued and
// the invoice stays "pending" — it never fails silently into "issued".

export type FiscalInvoiceRequest = {
  invoiceId: string;
  customer: { name: string; registration: string | null };
  description: string;
  currency: string;
  lines: Array<{ label: string; netMinor: number; tvaRateBp: number; tvaMinor: number; grossMinor: number }>;
  issuedOn: Date;
};
export type FiscalInvoiceResult = {
  number: string;
  /** e-Factura index / provider reference of the fiscal document. */
  fiscalRef: string;
  pdfUrl?: string | null;
  /** false = accepted by the provider, e-Factura confirmation follows by webhook. */
  final: boolean;
};
export type InvoicingProvider = { name: string; issue(request: FiscalInvoiceRequest): Promise<FiscalInvoiceResult> };
export type InvoicingProviderFactory = (env: Record<string, string | undefined>) => InvoicingProvider;

const g = globalThis as unknown as { __edInvoicingProviders?: Map<string, InvoicingProviderFactory> };
const providers: Map<string, InvoicingProviderFactory> = (g.__edInvoicingProviders ??= new Map());

/** Connects a provider under a name usable as INVOICING_PROVIDER. */
export function registerInvoicingProvider(name: string, factory: InvoicingProviderFactory): void {
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(name)) throw new Error(`Invalid invoicing provider name: ${name}`);
  providers.set(name, factory);
}

export const SANDBOX_PROVIDER = "sandbox";
registerInvoicingProvider(SANDBOX_PROVIDER, () => ({
  name: SANDBOX_PROVIDER,
  issue: async (r) => {
    const day = r.issuedOn.toISOString().slice(0, 10).replaceAll("-", "");
    const tail = r.invoiceId.slice(-8).toUpperCase();
    return { number: `SBX-${day}-${tail}`, fiscalRef: `SANDBOX-EFACTURA-${day}-${tail}`, pdfUrl: null, final: true };
  },
}));

/** The configured provider, or null when the operator has not chosen one. */
export function getInvoicingProvider(env: Record<string, string | undefined> = process.env): InvoicingProvider | null {
  const name = env.INVOICING_PROVIDER?.trim().toLowerCase();
  if (!name) return null;
  const factory = providers.get(name);
  if (!factory) throw new Error(`Unknown INVOICING_PROVIDER "${name}" (registered: ${[...providers.keys()].join(", ")})`);
  return factory(env);
}

export const INVOICING_ISSUE_JOB = "invoicing.issue";

/**
 * Issues the fiscal invoice of one charge. Idempotent: an invoice that already has a fiscal
 * reference is left alone. Returns the invoice status afterwards.
 */
export async function issueInvoice(ctx: Ctx, invoiceId: string, opts: { provider?: InvoicingProvider | null } = {}): Promise<"pending" | "issued" | "failed" | "cancelled"> {
  requireSystem(ctx);
  const [row] = await ctx.db
    .select({ invoice: invoices, plan: subscriptions.plan, name: businesses.name, registration: businesses.onrcRegistration })
    .from(invoices)
    .innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
    .innerJoin(businesses, eq(businesses.id, invoices.businessId))
    .where(eq(invoices.id, invoiceId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const inv = row.invoice;
  if (inv.fiscalRef || inv.status === "cancelled") return inv.status;
  const provider = opts.provider === undefined ? getInvoicingProvider() : opts.provider;
  if (!provider) return "pending";
  const label = row.plan === "featured_monthly" ? "EventDesk Promovat" : "EventDesk Business";
  const result = await provider.issue({
    invoiceId: inv.id,
    customer: { name: row.name, registration: row.registration },
    description: label,
    currency: inv.currency,
    // PAY4: the TVA is its own figure on the document, never folded into the price
    lines: [{ label, netMinor: inv.netMinor, tvaRateBp: inv.tvaRateBp, tvaMinor: inv.tvaMinor, grossMinor: inv.grossMinor }],
    issuedOn: ctx.now,
  });
  await ctx.db
    .update(invoices)
    .set({ number: result.number, fiscalRef: result.fiscalRef, pdfUrl: result.pdfUrl ?? null, provider: provider.name, status: result.final ? "issued" : "pending", issuedAt: result.final ? ctx.now : null })
    .where(eq(invoices.id, inv.id));
  await audit(ctx, { action: "invoice.issued", objectType: "invoice", objectId: inv.id, after: { number: result.number, fiscalRef: result.fiscalRef, provider: provider.name, tvaMinor: inv.tvaMinor } });
  return result.final ? "issued" : "pending";
}

const inboundSchema = z.object({
  /** Our invoice id, or the fiscal reference the provider returned at issue time. */
  invoiceId: z.string().min(1).max(64).optional(),
  fiscalRef: z.string().min(1).max(200).optional(),
  status: z.enum(["issued", "failed", "cancelled"]),
  number: z.string().max(100).optional(),
  pdfUrl: z.string().url().max(1000).startsWith("https://").optional(),
});

/**
 * Inbound provider webhook: the e-Factura outcome of an invoice. Authenticated by the shared
 * secret INVOICING_WEBHOOK_SECRET (constant-time compare). NOT_FOUND when none is configured.
 */
/**
 * True when `presented` is the configured webhook secret. Both sides are hashed first, so the
 * comparison takes the same time whatever was sent — including its length.
 */
export function verifyInvoicingWebhookSecret(presented: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const expected = env.INVOICING_WEBHOOK_SECRET?.trim();
  if (!expected || !presented) return false;
  return hashEquals(hashToken(presented), hashToken(expected));
}

export async function handleInvoicingWebhook(ctx: Ctx, input: { secret: string | null | undefined; body: unknown }, env: Record<string, string | undefined> = process.env): Promise<{ invoiceId: string; status: string }> {
  requireSystem(ctx);
  const expected = env.INVOICING_WEBHOOK_SECRET?.trim();
  if (!expected) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (!verifyInvoicingWebhookSecret(input.secret, env)) throw new AppError("UNAUTHENTICATED", "billing.errors.signature");
  const data = inboundSchema.parse(input.body);
  if (!data.invoiceId && !data.fiscalRef) throw new AppError("VALIDATION", "common.validation.required");
  const [inv] = await ctx.db
    .select()
    .from(invoices)
    .where(data.invoiceId ? eq(invoices.id, data.invoiceId) : eq(invoices.fiscalRef, data.fiscalRef!));
  if (!inv) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await ctx.db
    .update(invoices)
    .set({
      status: data.status,
      number: data.number ?? inv.number,
      fiscalRef: data.fiscalRef ?? inv.fiscalRef,
      pdfUrl: data.pdfUrl ?? inv.pdfUrl,
      issuedAt: data.status === "issued" ? (inv.issuedAt ?? ctx.now) : inv.issuedAt,
    })
    .where(eq(invoices.id, inv.id));
  await audit(ctx, { action: "invoice.provider_update", objectType: "invoice", objectId: inv.id, before: { status: inv.status }, after: { status: data.status } });
  return { invoiceId: inv.id, status: data.status };
}

export function registerJobs(): void {
  defineJob(INVOICING_ISSUE_JOB, z.object({ invoiceId: z.string() }), async (ctx, p) => {
    await issueInvoice(ctx, p.invoiceId);
  });
}
