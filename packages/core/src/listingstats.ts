import { and, businesses, desc, eq, isNotNull, listingStats, listings, lte } from "@ed/db";
import { bucharestDateKey } from "@ed/shared/time";
import { requireSystem, type Ctx } from "./context";
import { registerStatCollector } from "./stats";

// P31 — listing response statistics: the share of enquiries a listing answered and its median
// reply time, as facts verified every night. No score, nothing a visitor can submit, and
// nothing a business can buy: the numbers come from application events only (INF11).
//
// The enquiries domain (P-05) does not exist yet. It plugs in with ONE call:
//
//   setEnquiryStatsProvider(async (ctx, { listingIds, until }) => new Map([
//     [listingId, { received: 14, answered: 12, medianReplyMinutes: 190 }], …
//   ]));
//
// `received`/`answered` are cumulative counts of enquiries that reached the listing up to
// `until`; `medianReplyMinutes` is the median time from an enquiry's arrival to the first
// reply (null when none was answered). The nightly collector stores one row per claimed
// live listing per day in `listing_stats`.
//
// PUBLICATION RULE (getPublishedListingStats) — reviewed invariant: the inputs are the
// listing's claimed flag, the answered count and the two hide switches. No billing, plan or
// payment field is read here, so none can influence what is shown.

export const MIN_ANSWERED_FOR_STATS = 10;

export type EnquiryNumbers = { received: number; answered: number; medianReplyMinutes: number | null };
export type EnquiryStatsProvider = (ctx: Ctx, input: { listingIds: string[]; until: Date }) => Promise<Map<string, EnquiryNumbers>>;

const g = globalThis as unknown as { __edEnquiryStatsProvider?: EnquiryStatsProvider | null };

/** Called once by the enquiries domain. Pass null to remove (tests). */
export function setEnquiryStatsProvider(fn: EnquiryStatsProvider | null): void {
  g.__edEnquiryStatsProvider = fn;
}

/**
 * Computes and stores the day's row for every claimed live listing. Idempotent (upsert).
 * Without a provider (enquiries not built yet) nothing is written. Worker only.
 */
export async function computeListingStats(ctx: Ctx, day: string, until: Date): Promise<number> {
  requireSystem(ctx);
  const provider = g.__edEnquiryStatsProvider;
  if (!provider) return 0;
  const rows = await ctx.db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.claimed, true), eq(listings.status, "live"), isNotNull(listings.businessId)));
  if (rows.length === 0) return 0;
  const numbers = await provider(ctx, { listingIds: rows.map((r) => r.id), until });
  let written = 0;
  for (const { id } of rows) {
    const n = numbers.get(id);
    if (!n) continue;
    const received = Math.max(0, Math.trunc(n.received));
    const answered = Math.min(received, Math.max(0, Math.trunc(n.answered)));
    const median = answered > 0 && n.medianReplyMinutes !== null && Number.isFinite(n.medianReplyMinutes) ? Math.max(0, Math.round(n.medianReplyMinutes)) : null;
    await ctx.db
      .insert(listingStats)
      .values({ listingId: id, day, enquiriesReceived: received, enquiriesAnswered: answered, medianReplyMinutes: median, updatedAt: ctx.now })
      .onConflictDoUpdate({
        target: [listingStats.listingId, listingStats.day],
        set: { enquiriesReceived: received, enquiriesAnswered: answered, medianReplyMinutes: median, updatedAt: ctx.now },
      });
    written++;
  }
  return written;
}

export type PublishedListingStats = {
  /** The day the numbers were verified ("YYYY-MM-DD"). */
  day: string;
  received: number;
  answered: number;
  /** "Răspunde la {answeredOfTen} din 10 cereri". */
  answeredOfTen: number;
  /** null = unknown. */
  medianReplyMinutes: number | null;
};

/** Pure publication rule (P31). Exported for tests and for the business's own preview. */
export function publishableStats(input: {
  claimed: boolean;
  listingHidden: boolean;
  businessHidden: boolean;
  row: { day: string; enquiriesReceived: number; enquiriesAnswered: number; medianReplyMinutes: number | null } | null;
}): PublishedListingStats | null {
  const { row } = input;
  if (!input.claimed || input.listingHidden || input.businessHidden || !row) return null;
  if (row.enquiriesAnswered < MIN_ANSWERED_FOR_STATS || row.enquiriesReceived <= 0) return null;
  return {
    day: row.day,
    received: row.enquiriesReceived,
    answered: row.enquiriesAnswered,
    answeredOfTen: Math.min(10, Math.floor((row.enquiriesAnswered * 10) / row.enquiriesReceived)),
    medianReplyMinutes: row.medianReplyMinutes,
  };
}

/**
 * What may be shown publicly for a listing: null unless it is claimed, has answered at least
 * ten enquiries, and neither the listing nor its business hides the statistics.
 */
export async function getPublishedListingStats(ctx: Pick<Ctx, "db" | "now">, listingId: string): Promise<PublishedListingStats | null> {
  const [l] = await ctx.db
    .select({ claimed: listings.claimed, hideStats: listings.hideStats, businessHide: businesses.hideStats })
    .from(listings)
    .leftJoin(businesses, eq(businesses.id, listings.businessId))
    .where(eq(listings.id, listingId));
  if (!l) return null;
  const [row] = await ctx.db
    .select()
    .from(listingStats)
    .where(and(eq(listingStats.listingId, listingId), lte(listingStats.day, bucharestDateKey(ctx.now))))
    .orderBy(desc(listingStats.day))
    .limit(1);
  return publishableStats({ claimed: l.claimed, listingHidden: l.hideStats, businessHidden: l.businessHide ?? false, row: row ?? null });
}

function registerRules(): void {
  // Runs with the nightly statistics job (R0-12): no extra schedule needed.
  registerStatCollector({
    name: "listing-response",
    collect: async (ctx, day, range) => {
      const written = await computeListingStats(ctx, day, range.to);
      return [{ metric: "listings.responseStats", value: written }];
    },
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
}
