import {
  and,
  asc,
  businessMembers,
  businessOccasionSeats,
  businessProfiles,
  businesses,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  occasionHandovers,
  occasionMembers,
  occasions,
  sql,
  tasks,
  type OccasionStatus,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { addDays, bucharestDateKey, startOfBucharestDay } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { getAsset, getAssetUrl, registerUploadPurpose } from "@ed/storage";
import { z } from "zod";
import { getMember } from "./access";
import { audit } from "./audit";
import { assertBusinessCanCreate, isBusinessLapsed, requireBusinessMember, type Business } from "./business";
import { requireAccount, requireWriteCapable, systemCtx, type Ctx } from "./context";
import { createOccasion, daysUntil, type createOccasionInput, type Occasion } from "./occasions";
import { readDailyStats, recordEvent } from "./stats";
import { inTx } from "./tx";

// Business occasions, team access settings, branding and reports (P17, P20, P21, P23).
//
//   createBusinessOccasion(ctx, { businessId, …occasion })   any live member (P17)
//   listBusinessOccasions(ctx, businessId)                   running + handed-over (history)
//   ensureBusinessSeat(ctx, occasionId)                      a real occasion_members row for a
//                                                            team member (tasks can be theirs)
//   getBusinessProfile / saveBranding / saveTeamGrants       P20 + the grants of the team path
//   getOccasionBranding(ctx, occasionId)                     what a GUEST page shows (P20)
//   getBusinessReport(ctx, businessId)                       P21 — counts and daily totals only
//   recordAssetUse(ctx, { businessId, kind, itemId? })       D4: one more use today, no visitor
//
// ACCESS: the team reaches a business occasion through @ed/core/access (second path of
// getMember). This module never grants access on its own.
//
// P23 / invariant 8 — what a LAPSED plan stops is exactly BUSINESS_PLAN_CAPABILITIES in
// @ed/core/monetization: new business occasions, branding CHANGES and library EDITS (plus new
// listings, guarded in @ed/core/listings). Everything that already exists keeps working:
// occasions, team access, the branding already chosen, library items already applied.

export const BUSINESS_LOGO_PURPOSE = "business.logo";
export const ASSET_USE_METRIC = "asset.use";

/** Ivoire paper and ink (tokens.css) — the two text colours a brand accent may carry. */
const ON_LIGHT = "#17161b";
const ON_DARK = "#fffdf8";

export type BusinessProfile = {
  businessId: string;
  displayName: string | null;
  logoAssetId: string | null;
  accentColor: string | null;
  teamGrantFinance: boolean;
  teamGrantPrivateRequests: boolean;
};

async function loadProfile(ctx: Pick<Ctx, "db">, businessId: string): Promise<BusinessProfile> {
  const [row] = await ctx.db.select().from(businessProfiles).where(eq(businessProfiles.businessId, businessId));
  return {
    businessId,
    displayName: row?.displayName ?? null,
    logoAssetId: row?.logoAssetId ?? null,
    accentColor: row?.accentColor ?? null,
    teamGrantFinance: row?.teamGrantFinance ?? true,
    teamGrantPrivateRequests: row?.teamGrantPrivateRequests ?? false,
  };
}

/* ── Colour (build rule, not a user-facing check) ──────────────────────── */

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink or ivory — whichever reads better on `accent`. We choose; the business is never asked. */
export function readableOn(accent: string): string {
  return contrastRatio(accent, ON_DARK) >= contrastRatio(accent, ON_LIGHT) ? ON_DARK : ON_LIGHT;
}

const zAccent = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "bizoccasions.errors.accentFormat")
  .transform((v) => v.toLowerCase());

/* ── Create and list (P17) ─────────────────────────────────────────────── */

/**
 * Any live member of an active, non-lapsed business creates an occasion the business runs for
 * a client. It has every planning feature of an ordinary occasion. The creator holds the
 * owner row until handover — as a team seat, so it ends if they leave the business.
 */
export async function createBusinessOccasion(ctx: Ctx, input: { businessId: string; occasion: z.input<typeof createOccasionInput> }): Promise<Occasion> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const businessId = zId.parse(input.businessId);
  const { member } = await requireBusinessMember(ctx, businessId);
  await assertBusinessCanCreate(ctx, businessId); // P23 + W3: NEW things only
  return inTx(ctx, async (tx) => {
    const occasion = await createOccasion(tx, input.occasion);
    await tx.db.update(occasions).set({ businessId }).where(eq(occasions.id, occasion.id));
    const [ownerRow] = await tx.db
      .select({ id: occasionMembers.id })
      .from(occasionMembers)
      .where(and(eq(occasionMembers.occasionId, occasion.id), eq(occasionMembers.accountId, accountId)));
    await tx.db.insert(businessOccasionSeats).values({ occasionId: occasion.id, businessId, businessMemberId: member.id, occasionMemberId: ownerRow!.id, createdAt: tx.now });
    await audit(tx, { action: "business_occasion.created", objectType: "occasion", objectId: occasion.id, after: { businessId, title: occasion.title } });
    return { ...occasion, businessId };
  });
}

export type BusinessOccasionRow = {
  id: string;
  title: string;
  kind: Occasion["kind"];
  status: OccasionStatus;
  startsAt: Date | null;
  timezone: string;
  daysLeft: number | null;
  openTasks: number;
};
export type HandedOverRow = { occasionId: string; title: string; startsAt: Date | null; at: Date };

async function businessOccasionRows(ctx: Ctx, businessId: string): Promise<Occasion[]> {
  return ctx.db.select().from(occasions).where(eq(occasions.businessId, businessId)).orderBy(desc(occasions.createdAt)).limit(1000);
}

/** The occasions the business runs now, soonest first, and the ones it handed over (title + date only). */
export async function listBusinessOccasions(ctx: Ctx, businessId: string): Promise<{ running: BusinessOccasionRow[]; handedOver: HandedOverRow[] }> {
  await requireBusinessMember(ctx, businessId);
  const rows = await businessOccasionRows(ctx, businessId);
  const ids = rows.map((r) => r.id);
  const open = ids.length
    ? await ctx.db
        .select({ occasionId: tasks.occasionId, n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(inArray(tasks.occasionId, ids), ne(tasks.status, "done")))
        .groupBy(tasks.occasionId)
    : [];
  const openMap = new Map(open.map((o) => [o.occasionId, Number(o.n)]));
  const running = rows.map((o) => ({
    id: o.id,
    title: o.title,
    kind: o.kind,
    status: o.status,
    startsAt: o.startsAt,
    timezone: o.timezone,
    daysLeft: daysUntil(o, ctx.now),
    openTasks: openMap.get(o.id) ?? 0,
  }));
  const rank = (d: number | null) => (d === null ? 1 : d >= 0 ? 0 : 2);
  running.sort((a, b) => rank(a.daysLeft) - rank(b.daysLeft) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const handed = await ctx.db.select().from(occasionHandovers).where(eq(occasionHandovers.businessId, businessId)).orderBy(desc(occasionHandovers.at)).limit(200);
  return { running, handedOver: handed.map((h) => ({ occasionId: h.occasionId, title: h.occasionTitle, startsAt: h.occasionStartsAt, at: h.at })) };
}

/** A business occasion as its business sees it (for the handover and library screens). NOT_FOUND otherwise. */
export async function getBusinessOccasion(ctx: Ctx, input: { businessId: string; occasionId: string }): Promise<{ business: Business; occasion: Occasion; role: "owner" | "admin" | "staff" }> {
  const access = await requireBusinessMember(ctx, input.businessId);
  const [occasion] = await ctx.db
    .select()
    .from(occasions)
    .where(and(eq(occasions.id, zId.parse(input.occasionId)), eq(occasions.businessId, access.business.id)));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return { business: access.business, occasion, role: access.role };
}

/**
 * Gives a team member a real row in a business occasion (role pm, the team grants), so tasks
 * can be assigned to them. Idempotent. The row is a SEAT: it stops working when they leave
 * the business and is removed at handover.
 */
export async function ensureBusinessSeat(ctx: Ctx, occasionId: string): Promise<{ occasionMemberId: string }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const member = await getMember(ctx, occasionId);
  if (!member) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (!member.viaBusiness) return { occasionMemberId: member.id };
  const via = member.viaBusiness;
  return inTx(ctx, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`biz.seat:${occasionId}:${accountId}`}))`);
    const [old] = await tx.db
      .select({ id: occasionMembers.id })
      .from(occasionMembers)
      .where(and(eq(occasionMembers.occasionId, occasionId), eq(occasionMembers.accountId, accountId)));
    const values = { role: "pm" as const, grantFinance: member.grants.finance, grantPrivateRequests: member.grants.privateRequests, removedAt: null };
    const rowId = old
      ? (await tx.db.update(occasionMembers).set(values).where(eq(occasionMembers.id, old.id)).returning({ id: occasionMembers.id }))[0]!.id
      : (await tx.db.insert(occasionMembers).values({ occasionId, accountId, ...values, createdAt: tx.now }).returning({ id: occasionMembers.id }))[0]!.id;
    await tx.db
      .insert(businessOccasionSeats)
      .values({ occasionId, businessId: via.businessId, businessMemberId: via.businessMemberId, occasionMemberId: rowId, createdAt: tx.now })
      .onConflictDoNothing();
    await audit(tx, { action: "business_occasion.seat_taken", objectType: "occasion", objectId: occasionId, meta: { businessId: via.businessId } });
    return { occasionMemberId: rowId };
  });
}

/** For the occasion frame: is this a business occasion, and how does the actor reach it? */
export async function getBusinessOccasionContext(
  ctx: Ctx,
  occasionId: string,
): Promise<{ businessId: string; businessName: string; viaTeam: boolean; hasSeat: boolean; canHandOver: boolean } | null> {
  const member = await getMember(ctx, occasionId);
  if (!member) return null;
  const [row] = await ctx.db
    .select({ businessId: occasions.businessId, name: businesses.name })
    .from(occasions)
    .innerJoin(businesses, eq(businesses.id, occasions.businessId))
    .where(eq(occasions.id, occasionId));
  if (!row?.businessId) return null;
  const [team] = await ctx.db
    .select({ role: businessMembers.role })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, row.businessId), eq(businessMembers.accountId, member.accountId), isNull(businessMembers.removedAt)));
  return {
    businessId: row.businessId,
    businessName: row.name,
    viaTeam: !!team,
    hasSeat: !!team && !member.viaBusiness,
    canHandOver: team?.role === "owner" || team?.role === "admin",
  };
}

/* ── Profile: team grants and branding (P17, P20) ──────────────────────── */

export async function getBusinessProfile(ctx: Ctx, businessId: string): Promise<BusinessProfile & { logoUrl: string | null; onAccent: string | null; lapsed: boolean; canEdit: boolean }> {
  const { business, role } = await requireBusinessMember(ctx, businessId);
  const profile = await loadProfile(ctx, businessId);
  return {
    ...profile,
    logoUrl: await signedLogo(ctx, profile.logoAssetId),
    onAccent: profile.accentColor ? readableOn(profile.accentColor) : null,
    lapsed: isBusinessLapsed(business),
    canEdit: role !== "staff" && business.status === "active" && !isBusinessLapsed(business),
  };
}

async function signedLogo(ctx: Ctx, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  try {
    // the caller's right to see the logo was decided by the function calling this
    return await getAssetUrl(systemCtx(ctx.db, { now: ctx.now }), assetId, { ttlSeconds: 3600 });
  } catch (e) {
    if (e instanceof AppError) return null; // a removed logo simply does not show
    throw e;
  }
}

const brandingInput = z.object({
  businessId: zId,
  displayName: z.string().trim().max(120, "common.validation.tooLong").nullable().optional(),
  /** undefined = keep, null = remove. */
  logoAssetId: zId.nullable().optional(),
  accentColor: zAccent.nullable().optional(),
});

/** P20. Owner or admin. A lapsed plan keeps the branding it has and stops CHANGES (P23). */
export async function saveBranding(ctx: Ctx, input: z.input<typeof brandingInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = brandingInput.parse(input);
  await requireBusinessMember(ctx, data.businessId, { roles: ["owner", "admin"] });
  await assertBusinessCanCreate(ctx, data.businessId);
  const before = await loadProfile(ctx, data.businessId);
  const next = {
    displayName: data.displayName === undefined ? before.displayName : data.displayName || null,
    logoAssetId: data.logoAssetId === undefined ? before.logoAssetId : data.logoAssetId,
    accentColor: data.accentColor === undefined ? before.accentColor : data.accentColor,
  };
  if (next.logoAssetId && next.logoAssetId !== before.logoAssetId) {
    const asset = await getAsset(ctx, next.logoAssetId);
    if (asset.ownerType !== "business" || asset.ownerId !== data.businessId || asset.kind !== "image") {
      throw new AppError("VALIDATION", "bizoccasions.errors.logoInvalid", { fieldErrors: { logoAssetId: ["bizoccasions.errors.logoInvalid"] } });
    }
  }
  await inTx(ctx, async (tx) => {
    await tx.db
      .insert(businessProfiles)
      .values({ businessId: data.businessId, ...next })
      .onConflictDoUpdate({ target: businessProfiles.businessId, set: { ...next, updatedAt: tx.now } });
    await audit(tx, {
      action: "business.branding_saved",
      objectType: "business",
      objectId: data.businessId,
      before: { displayName: before.displayName, logoAssetId: before.logoAssetId, accentColor: before.accentColor },
      after: next,
    });
  });
}

const teamGrantsInput = z.object({ businessId: zId, finance: z.boolean(), privateRequests: z.boolean() });

/** What the team path carries into the business's occasions (D2). Owner only. */
export async function saveTeamGrants(ctx: Ctx, input: z.input<typeof teamGrantsInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = teamGrantsInput.parse(input);
  await requireBusinessMember(ctx, data.businessId, { roles: ["owner"] });
  const before = await loadProfile(ctx, data.businessId);
  await inTx(ctx, async (tx) => {
    const set = { teamGrantFinance: data.finance, teamGrantPrivateRequests: data.privateRequests };
    await tx.db
      .insert(businessProfiles)
      .values({ businessId: data.businessId, ...set })
      .onConflictDoUpdate({ target: businessProfiles.businessId, set: { ...set, updatedAt: tx.now } });
    // seats follow the setting (the owner row of an occasion keeps its implicit grants)
    await tx.db.execute(sql`
      update occasion_members om set grant_finance = ${data.finance}, grant_private_requests = ${data.privateRequests}
      from business_occasion_seats s
      where s.occasion_member_id = om.id and s.business_id = ${data.businessId} and om.role <> 'owner'`);
    await audit(tx, {
      action: "business.team_grants_saved",
      objectType: "business",
      objectId: data.businessId,
      before: { finance: before.teamGrantFinance, privateRequests: before.teamGrantPrivateRequests },
      after: { finance: data.finance, privateRequests: data.privateRequests },
    });
  });
}

export type OccasionBranding = {
  businessId: string;
  name: string;
  logoUrl: string | null;
  /** "#rrggbb" or null (EventDesk accent). */
  accent: string | null;
  /** Text colour that reads on `accent` (chosen by us from its luminance). */
  onAccent: string | null;
};

/**
 * P20: the branding a GUEST-facing page of this occasion shows — the business's name, logo
 * and one accent — or null: not a business occasion, handed over (P22), or the business is
 * suspended. Readable by the occasion's guests (guest actor of this occasion), its members
 * and the system; anyone else gets null. A lapse does not remove it (P23).
 */
export async function getOccasionBranding(ctx: Ctx, occasionId: string): Promise<OccasionBranding | null> {
  if (!zId.safeParse(occasionId).success) return null;
  const allowed =
    ctx.actor.kind === "system" || (ctx.actor.kind === "guest" && ctx.actor.occasionId === occasionId) || (await getMember(ctx, occasionId)) !== null;
  if (!allowed) return null;
  const [row] = await ctx.db
    .select({ businessId: occasions.businessId, name: businesses.name, status: businesses.status })
    .from(occasions)
    .innerJoin(businesses, eq(businesses.id, occasions.businessId))
    .where(eq(occasions.id, occasionId));
  if (!row?.businessId || row.status === "suspended") return null;
  const profile = await loadProfile(ctx, row.businessId);
  return {
    businessId: row.businessId,
    name: profile.displayName ?? row.name,
    logoUrl: await signedLogo(ctx, profile.logoAssetId),
    accent: profile.accentColor,
    onAccent: profile.accentColor ? readableOn(profile.accentColor) : null,
  };
}

/* ── Asset use (P21, D4) ───────────────────────────────────────────────── */

const assetUseInput = z.object({ businessId: zId, kind: z.string().regex(/^[a-z][a-z_]{1,30}$/), itemId: zId.optional() });

/**
 * One more use of a business asset today (a library item applied, a drawing placed, a
 * catalogue item chosen). A daily total per business × kind × item — nothing about who.
 * Call from checked WRITE code only (never inside a read-only MCP transaction).
 */
export async function recordAssetUse(ctx: Ctx, input: z.input<typeof assetUseInput>): Promise<void> {
  const d = assetUseInput.parse(input);
  await recordEvent(ctx, ASSET_USE_METRIC, { business: d.businessId, kind: d.kind, ...(d.itemId ? { item: d.itemId } : {}) });
}

/* ── Reports (P21) ─────────────────────────────────────────────────────── */

export type BusinessEnquiryCounts = { received: number; unanswered: number };
type EnquiryProvider = (ctx: Ctx, input: { businessId: string; since: Date }) => Promise<BusinessEnquiryCounts>;
const g = globalThis as unknown as { __edBizEnquiryProvider?: EnquiryProvider };

/** The enquiries domain plugs its counts in here; without it the report says "unknown". */
export function setBusinessEnquiryProvider(fn: EnquiryProvider): void {
  g.__edBizEnquiryProvider = fn;
}

export const REPORT_DAYS = 30;

export type BusinessReport = {
  days: number;
  occasions: { total: number; byStatus: Record<OccasionStatus, number>; handedOver: number };
  upcoming: Array<{ id: string; title: string; startsAt: Date; timezone: string; daysLeft: number }>;
  tasks: { open: number; overdue: number };
  /** null = unknown (the enquiries domain is not connected). */
  enquiries: BusinessEnquiryCounts | null;
  assetUse: { total: number; byKind: Array<{ kind: string; value: number }>; byDay: Array<{ day: string; value: number }> };
};

export async function getBusinessReport(ctx: Ctx, businessId: string): Promise<BusinessReport> {
  await requireBusinessMember(ctx, businessId);
  const rows = await businessOccasionRows(ctx, businessId);
  const byStatus: Record<OccasionStatus, number> = { planning: 0, cancelled: 0, postponed: 0, closed: 0 };
  for (const r of rows) byStatus[r.status] += 1;
  const [handed] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(occasionHandovers).where(eq(occasionHandovers.businessId, businessId));
  const today = startOfBucharestDay(ctx.now);
  const live = rows.filter((r) => r.status === "planning" || r.status === "postponed").map((r) => r.id);
  const [open, overdue] = live.length
    ? await Promise.all([
        ctx.db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(inArray(tasks.occasionId, live), ne(tasks.status, "done"))),
        ctx.db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(inArray(tasks.occasionId, live), ne(tasks.status, "done"), lt(tasks.dueAt, today))),
      ])
    : [[{ n: 0 }], [{ n: 0 }]];
  const upcoming = rows
    .filter((r) => r.startsAt && r.status === "planning")
    .map((r) => ({ id: r.id, title: r.title, startsAt: r.startsAt!, timezone: r.timezone, daysLeft: daysUntil(r, ctx.now) ?? -1 }))
    .filter((r) => r.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8);
  const since = addDays(ctx.now, -REPORT_DAYS);
  const stats = await readDailyStats(ctx, { metric: ASSET_USE_METRIC, from: bucharestDateKey(since), to: bucharestDateKey(ctx.now), dims: { business: businessId } });
  const kindMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  for (const s of stats) {
    kindMap.set(s.dimensions.kind ?? "other", (kindMap.get(s.dimensions.kind ?? "other") ?? 0) + s.value);
    dayMap.set(s.day, (dayMap.get(s.day) ?? 0) + s.value);
  }
  return {
    days: REPORT_DAYS,
    occasions: { total: rows.length, byStatus, handedOver: Number(handed?.n ?? 0) },
    upcoming,
    tasks: { open: Number(open[0]?.n ?? 0), overdue: Number(overdue[0]?.n ?? 0) },
    enquiries: g.__edBizEnquiryProvider ? await g.__edBizEnquiryProvider(ctx, { businessId, since }) : null,
    assetUse: {
      total: stats.reduce((a, s) => a + s.value, 0),
      byKind: [...kindMap].map(([kind, value]) => ({ kind, value })).sort((a, b) => b.value - a.value),
      byDay: [...dayMap].map(([day, value]) => ({ day, value })).sort((a, b) => (a.day < b.day ? -1 : 1)),
    },
  };
}

/** Team members of a business (ids only) — used by handover to tell the team from the client. */
export async function businessAccountIds(ctx: Pick<Ctx, "db">, businessId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ accountId: businessMembers.accountId })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), isNull(businessMembers.removedAt)))
    .orderBy(asc(businessMembers.createdAt));
  return new Set(rows.map((r) => r.accountId).filter((x): x is string => !!x));
}

registerUploadPurpose(BUSINESS_LOGO_PURPOSE, { ownerType: "business", allowPdf: false });
