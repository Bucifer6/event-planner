import {
  and,
  asc,
  eq,
  giftEstimates,
  giftGuideSettings,
  GIFT_DISTANCES,
  GIFT_RELATIONSHIPS,
  GIFT_VENUES,
  households,
  isNull,
  type GiftDistance,
  type GiftGuideTable,
  type GiftRelationship,
  type GiftVenue,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { onAccountPurge } from "./accounts";
import type { Ctx } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { PLANNING_ROLES } from "./suppliers";

// GIFT ESTIMATOR — "calculator dar" (C-11). A private planning aid, specific to Romania.
//
// From three questions about a guest household — how close they are, how far they travel,
// what kind of venue it is — it suggests the RANGE of money gift that is customary. It is a
// cultural guide, not a rule: the wording never says what anyone ought to give, and the
// table it computes from is shown in full and can be changed by the person using it.
//
// PRIVATE TO ONE ACCOUNT, by construction:
//   - every row carries `account_id`, and every query here filters on the caller's own account —
//     another member of the same occasion gets an empty list, not somebody else's notes;
//   - only a signed-in person may call these functions: a guest link, an MCP token, staff and
//     the system are refused;
//   - nothing in this module registers an export, a guest section, a digest/overview section
//     or an MCP tool, and no other module reads these tables.
// Free forever: there is no plan, tier or commercial input anywhere near it, and nothing is
// shared between planners (the default table is a constant in this file, not learned data).
//
// THE DEFAULT TABLE — placeholders, deliberately round, for the operator or the user to tune:
//   customary range per adult, by venue          restaurant 300–500 · ballroom 400–600 ·
//                                                 premium venue 500–800 · at home / outdoors 150–300 (RON)
//   closeness (percent of the range)              close family 150 · family 120 · close friend 120 ·
//                                                 friend 100 · colleague or acquaintance 80
//   distance travelled (percent of the range)     same town 100 · same county 100 ·
//                                                 elsewhere in the country 90 · from abroad 80
//   result = range × closeness × distance × adults, rounded to 50 RON.
// The table is neutral on purpose: it encodes no judgement about a guest, only the two things
// people commonly weigh (the cost of the meal at that kind of venue, and their own travel).

export { GIFT_DISTANCES, GIFT_RELATIONSHIPS, GIFT_VENUES };
export type { GiftDistance, GiftGuideTable, GiftRelationship, GiftVenue };

export const DEFAULT_GIFT_GUIDE: GiftGuideTable = {
  currency: "RON",
  base: {
    restaurant: { lowMinor: 30000, highMinor: 50000 },
    ballroom: { lowMinor: 40000, highMinor: 60000 },
    premium: { lowMinor: 50000, highMinor: 80000 },
    home: { lowMinor: 15000, highMinor: 30000 },
  },
  relationshipPct: { close_family: 150, family: 120, close_friend: 120, friend: 100, colleague: 80 },
  distancePct: { local: 100, county: 100, country: 90, abroad: 80 },
};

/** Results are rounded to this step (50 RON). */
export const GIFT_ROUND_MINOR = 5000;

const pct = z.number().int().min(10).max(400);
const range = z.object({ lowMinor: z.number().int().min(0).max(100_000_00), highMinor: z.number().int().min(0).max(100_000_00) }).refine((r) => r.highMinor >= r.lowMinor, { message: "gifts.errors.rangeOrder" });
const guideSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("RON"),
  base: z.object({ restaurant: range, ballroom: range, premium: range, home: range }),
  relationshipPct: z.object({ close_family: pct, family: pct, close_friend: pct, friend: pct, colleague: pct }),
  distancePct: z.object({ local: pct, county: pct, country: pct, abroad: pct }),
});

const answers = z.object({
  relationship: z.enum(GIFT_RELATIONSHIPS),
  distance: z.enum(GIFT_DISTANCES),
  venue: z.enum(GIFT_VENUES),
  adults: z.number().int().min(1).max(12).default(2),
});
export type GiftAnswers = z.input<typeof answers>;

export type GiftEstimate = {
  lowMinor: number;
  highMinor: number;
  currency: string;
  /** How the range came about, for the reasoning in words. */
  reasoning: { baseLowMinor: number; baseHighMinor: number; relationshipPct: number; distancePct: number; adults: number };
};

const roundTo = (minor: number) => Math.round(minor / GIFT_ROUND_MINOR) * GIFT_ROUND_MINOR;

/** Pure: the range the table gives for these answers. */
export function estimateGift(guide: GiftGuideTable, input: GiftAnswers): GiftEstimate {
  const a = answers.parse(input);
  const base = guide.base[a.venue];
  const k = (guide.relationshipPct[a.relationship] / 100) * (guide.distancePct[a.distance] / 100) * a.adults;
  const low = roundTo(base.lowMinor * k);
  return {
    lowMinor: low,
    highMinor: Math.max(low, roundTo(base.highMinor * k)),
    currency: guide.currency,
    reasoning: { baseLowMinor: base.lowMinor, baseHighMinor: base.highMinor, relationshipPct: guide.relationshipPct[a.relationship], distancePct: guide.distancePct[a.distance], adults: a.adults },
  };
}

/** Only a person signed in to the app — never a guest, an assistant token, staff or the system. */
function ownAccount(ctx: Ctx): string {
  if (ctx.actor.kind !== "account") throw new AppError(ctx.actor.kind === "anonymous" ? "UNAUTHENTICATED" : "FORBIDDEN", "common.errors.FORBIDDEN");
  return ctx.actor.accountId;
}

/** The caller's own table (or the default placeholders when they never changed it). */
export async function getGiftGuide(ctx: Ctx): Promise<{ guide: GiftGuideTable; isDefault: boolean }> {
  const accountId = ownAccount(ctx);
  const [row] = await ctx.db.select().from(giftGuideSettings).where(eq(giftGuideSettings.accountId, accountId));
  return row ? { guide: row.guide, isDefault: false } : { guide: DEFAULT_GIFT_GUIDE, isDefault: true };
}

/** Stores the caller's own table. It affects nobody else. */
export async function saveGiftGuide(ctx: Ctx, input: GiftGuideTable): Promise<void> {
  const accountId = ownAccount(ctx);
  const guide = guideSchema.parse(input);
  await ctx.db.insert(giftGuideSettings).values({ accountId, guide }).onConflictDoUpdate({ target: giftGuideSettings.accountId, set: { guide, updatedAt: ctx.now } });
}

/** Back to the default placeholders. */
export async function resetGiftGuide(ctx: Ctx): Promise<void> {
  const accountId = ownAccount(ctx);
  await ctx.db.delete(giftGuideSettings).where(eq(giftGuideSettings.accountId, accountId));
}

export type SavedGiftEstimate = {
  id: string;
  householdId: string | null;
  label: string;
  relationship: GiftRelationship;
  distance: GiftDistance;
  venue: GiftVenue;
  adults: number;
  lowMinor: number;
  highMinor: number;
  currency: string;
};

export type GiftPage = {
  guide: GiftGuideTable;
  isDefault: boolean;
  /** The CALLER's notes for this occasion. Never anyone else's. */
  estimates: SavedGiftEstimate[];
  /** Households of the occasion the caller may pick from (name only). */
  households: Array<{ id: string; name: string }>;
};

/** Everything the gifts page shows — for the caller's own account only. */
export async function getGiftPage(ctx: Ctx, occasionId: string): Promise<GiftPage> {
  const accountId = ownAccount(ctx);
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const [{ guide, isDefault }, rows, hs] = await Promise.all([
    getGiftGuide(ctx),
    ctx.db
      .select()
      .from(giftEstimates)
      .where(and(eq(giftEstimates.accountId, accountId), eq(giftEstimates.occasionId, occasionId)))
      .orderBy(asc(giftEstimates.label), asc(giftEstimates.createdAt)),
    ctx.db.select({ id: households.id, name: households.name }).from(households).where(eq(households.occasionId, occasionId)).orderBy(asc(households.name)),
  ]);
  return {
    guide,
    isDefault,
    estimates: rows.map((r) => ({ id: r.id, householdId: r.householdId, label: r.label, relationship: r.relationship, distance: r.distance, venue: r.venue, adults: r.adults, lowMinor: r.lowMinor, highMinor: r.highMinor, currency: r.currency })),
    households: hs,
  };
}

const saveInput = answers.extend({
  occasionId: z.string().min(1).max(64),
  householdId: z.string().min(1).max(64).nullish(),
  /** Used when no household is picked. */
  label: z.string().trim().max(80).optional(),
});

/** Keeps the range for one household (or a free label) among the caller's own notes. One note per household. */
export async function saveGiftEstimate(ctx: Ctx, input: z.input<typeof saveInput>): Promise<SavedGiftEstimate> {
  const accountId = ownAccount(ctx);
  const data = saveInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: PLANNING_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  let label = data.label ?? "";
  if (data.householdId) {
    const [h] = await ctx.db
      .select({ name: households.name })
      .from(households)
      .where(and(eq(households.id, data.householdId), eq(households.occasionId, data.occasionId)));
    if (!h) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    label = h.name;
  }
  if (!label) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { label: ["gifts.errors.labelRequired"] } });
  const { guide } = await getGiftGuide(ctx);
  const est = estimateGift(guide, data);
  const values = { accountId, occasionId: data.occasionId, householdId: data.householdId ?? null, label, relationship: data.relationship, distance: data.distance, venue: data.venue, adults: data.adults, lowMinor: est.lowMinor, highMinor: est.highMinor, currency: est.currency };
  const mine = and(eq(giftEstimates.accountId, accountId), eq(giftEstimates.occasionId, data.occasionId));
  const [existing] = await ctx.db
    .select({ id: giftEstimates.id })
    .from(giftEstimates)
    .where(and(mine, data.householdId ? eq(giftEstimates.householdId, data.householdId) : and(isNull(giftEstimates.householdId), eq(giftEstimates.label, label))));
  let id: string;
  if (existing) {
    await ctx.db.update(giftEstimates).set(values).where(and(eq(giftEstimates.id, existing.id), eq(giftEstimates.accountId, accountId)));
    id = existing.id;
  } else {
    const [row] = await ctx.db.insert(giftEstimates).values(values).returning({ id: giftEstimates.id });
    id = row!.id;
  }
  // deliberately no audit row: the audit trail is readable by others; this note is not
  return { id, householdId: values.householdId, label, relationship: data.relationship, distance: data.distance, venue: data.venue, adults: data.adults, lowMinor: est.lowMinor, highMinor: est.highMinor, currency: est.currency };
}

/** Removes one of the caller's own notes (someone else's id simply matches nothing). */
export async function deleteGiftEstimate(ctx: Ctx, input: { id: string }): Promise<void> {
  const accountId = ownAccount(ctx);
  await ctx.db.delete(giftEstimates).where(and(eq(giftEstimates.id, String(input.id).slice(0, 64)), eq(giftEstimates.accountId, accountId)));
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(giftEstimates).where(eq(giftEstimates.occasionId, occasionId));
});
onAccountPurge(async (tx, accountId) => {
  await tx.db.delete(giftEstimates).where(eq(giftEstimates.accountId, accountId));
  await tx.db.delete(giftGuideSettings).where(eq(giftGuideSettings.accountId, accountId));
});
