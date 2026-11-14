import { and, count, discoveryDrafts, enquiryStatEvents, eq, gte, isNull, listingClaims, listings } from "@ed/db";
import { setPlatformEnquiryCounter } from "./billing";
import { setBusinessEnquiryProvider } from "./bizoccasions";
import "./claims";
import "./discovery";
import "./enquiries";
import { registerDashboardCounter } from "./staff";

// Integration wiring: providers and console counters that sit BETWEEN domains, so neither
// side has to import the other. Imported once by the web app (instrumentation-node.ts) and
// by the worker (jobs registry). Everything here returns COUNTS ONLY — never who sent an
// enquiry, to whom, or what it said (D3, W1).
//
// The numbers come from enquiry_stat_events, the identity-free record the enquiries domain
// keeps for response statistics (the same rows enquiryNumbers reads): one row per enquiry
// received, with the time of the first reply.

function registerWiring(): void {
  // P21: the business report — enquiries received in the period and how many are still unanswered.
  setBusinessEnquiryProvider(async (ctx, { businessId, since }) => {
    const [row] = await ctx.db
      .select({ received: count(), answered: count(enquiryStatEvents.answeredAt) })
      .from(enquiryStatEvents)
      .innerJoin(listings, eq(listings.id, enquiryStatEvents.listingId))
      .where(and(eq(listings.businessId, businessId), gte(enquiryStatEvents.receivedAt, since)));
    const received = Number(row?.received ?? 0);
    return { received, unanswered: Math.max(0, received - Number(row?.answered ?? 0)) };
  });

  // MON1 dashboard: enquiries sent on the whole platform since a day (a number only).
  setPlatformEnquiryCounter(async (ctx, { since }) => {
    const [row] = await ctx.db.select({ n: count() }).from(enquiryStatEvents).where(gte(enquiryStatEvents.receivedAt, since));
    return Number(row?.n ?? 0);
  });

  // W1 console dashboard (labels: console.dashboard.counters.<key>)
  registerDashboardCounter({
    key: "enquiries",
    count: async (ctx) => {
      const [all] = await ctx.db.select({ n: count() }).from(enquiryStatEvents);
      const [open] = await ctx.db.select({ n: count() }).from(enquiryStatEvents).where(isNull(enquiryStatEvents.answeredAt));
      const total = Number(all?.n ?? 0);
      const unanswered = Number(open?.n ?? 0);
      return { total, byStatus: { answered: total - unanswered, unanswered } };
    },
  });
  registerDashboardCounter({
    key: "discovery",
    count: async (ctx) => {
      const rows = await ctx.db.select({ state: discoveryDrafts.state, n: count() }).from(discoveryDrafts).groupBy(discoveryDrafts.state);
      return { total: rows.reduce((a, r) => a + Number(r.n), 0), byStatus: Object.fromEntries(rows.map((r) => [r.state, Number(r.n)])) };
    },
  });
  registerDashboardCounter({
    key: "claims",
    count: async (ctx) => {
      const rows = await ctx.db.select({ state: listingClaims.state, n: count() }).from(listingClaims).groupBy(listingClaims.state);
      return { total: rows.reduce((a, r) => a + Number(r.n), 0), byStatus: Object.fromEntries(rows.map((r) => [r.state, Number(r.n)])) };
    },
  });
}
registerWiring();

/** Called by @ed/jobs/registry in the worker (the worker computes business reports too). */
export function registerJobs(): void {
  registerWiring();
}
