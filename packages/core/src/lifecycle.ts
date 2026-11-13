import { eq, occasions, type WhatIfDeltaRow, type WhatIfText } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import type { Ctx } from "./context";

// Occasion lifecycle registries (B-09 cancel/postpone, B-10 closeout).
//
// Every domain that holds occasion data tells the lifecycle what a cancel / postpone / close
// touches, so the preview lists EVERYTHING before anyone confirms (principle 3):
//
//   registerLifecycleImpact({
//     key: "suppliers.bookings",
//     collect: async (ctx, occasionId, change) => [{ key: "booking:…", what: "Formația X", … }],
//     apply: async (txCtx, occasionId, change) => { …runs inside the confirming transaction… },
//   });
//
// and what is still open at the end of the occasion:
//
//   registerCloseoutSection({
//     key: "suppliers.deposits", titleKey: "suppliers.closeout.deposits",
//     collect: async (ctx, occasionId) => [{ key, label, amountMinor, currency }],
//   });
//
// MONEY GATING: collect() runs with the ctx of the person looking at the preview / closeout.
// A provider that shows money must do its own grant check (requireMember(…, { grant: "finance" }))
// and return [] (or count-only rows) when the member lacks it. A provider that THROWS
// AppError FORBIDDEN is skipped. apply() is only reached by a manager who confirmed.
//
// This file holds only the registries, types and the closed-occasion guard (no domain
// imports), so any domain can import it without cycles. The what-if kinds themselves
// ("occasion.cancel", "occasion.postpone", "occasion.close") live in @ed/core/closeout.

/** One before → after row of a what-if preview (same shape the What-if engine stores). */
export type DeltaRow = WhatIfDeltaRow;
export type { WhatIfText };

export type LifecycleChange =
  | { kind: "cancel" }
  | { kind: "postpone"; startsOn: string /* yyyy-mm-dd */ }
  | { kind: "close" };

export type LifecycleImpactProvider = {
  key: string;
  /** Rows for the preview. Must not change anything. */
  collect(ctx: Ctx, occasionId: string, change: LifecycleChange): Promise<DeltaRow[]>;
  /** Optional knock-on change, run inside the confirming transaction. */
  apply?(txCtx: Ctx, occasionId: string, change: LifecycleChange): Promise<void>;
};

export type CloseoutItem = {
  key: string;
  label: string | { key: string; params?: Record<string, string | number> };
  /** NULL/undefined = no amount or unknown (never shown as 0). */
  amountMinor?: number | null;
  currency?: string;
  noteKey?: string;
};

export type CloseoutSectionProvider = {
  key: string;
  titleKey: string;
  collect(ctx: Ctx, occasionId: string): Promise<CloseoutItem[]>;
};

const g = globalThis as unknown as {
  __edLifecycleImpacts?: Map<string, LifecycleImpactProvider>;
  __edCloseoutSections?: Map<string, CloseoutSectionProvider>;
};
const impacts: Map<string, LifecycleImpactProvider> = (g.__edLifecycleImpacts ??= new Map());
const sections: Map<string, CloseoutSectionProvider> = (g.__edCloseoutSections ??= new Map());

/** Registers (or replaces, by key) what a cancel / postpone / close touches in one domain. */
export function registerLifecycleImpact(provider: LifecycleImpactProvider): void {
  impacts.set(provider.key, provider);
}

/** Registers (or replaces, by key) one section of the closeout list. */
export function registerCloseoutSection(provider: CloseoutSectionProvider): void {
  sections.set(provider.key, provider);
}

/** Registered providers in registration order. */
export function lifecycleImpactProviders(): LifecycleImpactProvider[] {
  return [...impacts.values()];
}

export function closeoutSectionProviders(): CloseoutSectionProvider[] {
  return [...sections.values()];
}

/**
 * Closed occasions are read-only (B10): call this at the top of every WRITE in a domain that
 * holds occasion data, inside or outside a transaction. Throws CONFLICT
 * `lifecycle.errors.closed` when the occasion is closed (NOT_FOUND when it does not exist).
 * Cancelled and postponed occasions stay writable — refunds and new dates still get recorded.
 * NO access check: call requireMember first.
 */
export async function assertOccasionWritable(ctx: Ctx, occasionId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ status: occasions.status })
    .from(occasions)
    .where(eq(occasions.id, occasionId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (row.status === "closed") throw new AppError("CONFLICT", "lifecycle.errors.closed");
}
