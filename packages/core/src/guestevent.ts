import { eq, guestJourneys, JOURNEY_FACT_STATES, JOURNEY_FACTS, occasions, publicPages, type JourneyFact, type JourneyFactKey, type JourneyFactState } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { bumpGuestRevision, registerGuestSection, requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { inTx } from "./tx";

// The guest event page (C-10) and the published accessible guest journey (C-07).
//
// "The guest event page" is two doors to the same content:
//   - invited guests:   their own link /g/<token> — the sections programme (32), menu (34),
//                       venue + accessible journey (58, this file), plan of the room (60) and
//                       the private request form (70);
//   - everyone else:    the public page /e/<slug> (@ed/core/publicpage), when published.
//
// Venue navigation (SEC7, D1): a plain https link to a maps search for the address — the
// guest's phone opens it in its maps app. No embedded map, no third-party script, and the
// link is rendered with <ExternalLink> (rel="noopener noreferrer") so the scoped guest URL
// never travels in a Referer header.
//
// Accessible journey: five facts (step-free access, accessible toilets, parking, quiet room,
// seating help) and a contact person. Each fact is yes / no / UNKNOWN — unknown is shown as
// unknown, never hidden and never guessed. Published in Romanian and English.

export { JOURNEY_FACT_STATES, JOURNEY_FACTS };
export type { JourneyFact, JourneyFactKey, JourneyFactState };

const idSchema = z.string().min(1).max(64);
const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;

/** The external navigation link for an address. */
export function navigationHref(address: string, venueName?: string | null): string {
  const query = [venueName, address].filter((s): s is string => !!s && s.trim() !== "").join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Path of the public event page (the print pack's QR for non-invited guests points here). */
export function publicEventPath(slug: string): string {
  return `/e/${slug}`;
}

/**
 * What a printed QR for "the event page" should encode, for members: the absolute URL of the
 * PUBLISHED public page, or null when there is none (invited guests use their own /g/ link).
 */
export async function getGuestEventPageUrl(ctx: Ctx, occasionId: string): Promise<string | null> {
  await requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
  const [page] = await ctx.db.select({ slug: publicPages.slug, published: publicPages.published }).from(publicPages).where(eq(publicPages.occasionId, occasionId));
  if (!page?.published) return null;
  return `${(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "")}${publicEventPath(page.slug)}`;
}

/* ── Accessible guest journey ────────────────────────────────────────────── */

export type JourneyFactView = { key: JourneyFactKey; state: JourneyFactState; note: { ro: string | null; en: string | null } };
export type JourneyView = {
  published: boolean;
  publishedAt: Date | null;
  facts: JourneyFactView[];
  contactName: string | null;
  contactRoute: string | null;
};
export type PublishedJourney = { facts: JourneyFactView[]; contact: { name: string | null; route: string | null } | null };

function factViews(facts: Partial<Record<JourneyFactKey, JourneyFact>>): JourneyFactView[] {
  return JOURNEY_FACTS.map((key) => {
    const f = facts[key];
    return { key, state: f?.state ?? "unknown", note: { ro: f?.noteRo ?? null, en: f?.noteEn ?? null } };
  });
}

/** The journey as the planning team edits it. Nothing saved yet = five unknown facts. */
export async function getJourney(ctx: Ctx, occasionId: string): Promise<JourneyView & { canManage: boolean }> {
  const member = await requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
  const [row] = await ctx.db.select().from(guestJourneys).where(eq(guestJourneys.occasionId, occasionId));
  return {
    published: !!row?.publishedAt,
    publishedAt: row?.publishedAt ?? null,
    facts: factViews(row?.facts ?? {}),
    contactName: row?.contactName ?? null,
    contactRoute: row?.contactRoute ?? null,
    canManage: member.role === "owner" || member.role === "pm",
  };
}

/** INTERNAL (no access check): the journey guests may read, or null while unpublished. */
export async function readPublishedJourney(ctx: Pick<Ctx, "db">, occasionId: string): Promise<PublishedJourney | null> {
  const [row] = await ctx.db.select().from(guestJourneys).where(eq(guestJourneys.occasionId, occasionId));
  if (!row?.publishedAt) return null;
  return { facts: factViews(row.facts), contact: row.contactName || row.contactRoute ? { name: row.contactName, route: row.contactRoute } : null };
}

const note = z
  .string()
  .max(300, "common.validation.tooLong")
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const factInput = z.object({ state: z.enum(JOURNEY_FACT_STATES).default("unknown"), noteRo: note, noteEn: note });
const journeyInput = z.object({
  occasionId: idSchema,
  facts: z.object(Object.fromEntries(JOURNEY_FACTS.map((k) => [k, factInput.optional()])) as Record<JourneyFactKey, z.ZodOptional<typeof factInput>>),
  contactName: note,
  contactRoute: z
    .string()
    .max(160, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  published: z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).default(false),
});
export type JourneyInput = z.input<typeof journeyInput>;

/** Saves (and publishes or withdraws) the journey. Owner / PM. Guests see "changed" once. */
export async function saveJourney(ctx: Ctx, input: JourneyInput): Promise<JourneyView> {
  const data = journeyInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, data.occasionId);
  const facts: Partial<Record<JourneyFactKey, JourneyFact>> = {};
  for (const key of JOURNEY_FACTS) {
    const f = data.facts[key];
    facts[key] = { state: f?.state ?? "unknown", noteRo: f?.noteRo ?? null, noteEn: f?.noteEn ?? null };
  }
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(guestJourneys).where(eq(guestJourneys.occasionId, data.occasionId)).for("update");
    const publishedAt = data.published ? (before?.publishedAt ?? tx.now) : null;
    const values = { facts, contactName: data.contactName, contactRoute: data.contactRoute, publishedAt };
    await tx.db
      .insert(guestJourneys)
      .values({ occasionId: data.occasionId, ...values })
      .onConflictDoUpdate({ target: guestJourneys.occasionId, set: values });
    const changedForGuests =
      data.published && (!before?.publishedAt || JSON.stringify(factViews(before.facts)) !== JSON.stringify(factViews(facts)) || before.contactName !== data.contactName || before.contactRoute !== data.contactRoute);
    if (changedForGuests) await bumpGuestRevision(tx, data.occasionId, "guestevent.journey.changedNotice");
    await audit(tx, {
      action: data.published ? "journey.published" : "journey.saved",
      objectType: "occasion",
      objectId: data.occasionId,
      after: { published: data.published, states: Object.fromEntries(JOURNEY_FACTS.map((k) => [k, facts[k]!.state])) },
    });
    return { published: !!publishedAt, publishedAt, facts: factViews(facts), contactName: data.contactName, contactRoute: data.contactRoute };
  });
}

/* ── Guest link section: how to get there ────────────────────────────────── */

export type GuestVenue = {
  venueName: string | null;
  venueAddress: string | null;
  /** External maps link, or null without an address. */
  navigationHref: string | null;
  journey: PublishedJourney | null;
};

/** "Cum ajungi": the address with its navigation link and the published accessible journey. */
export async function getGuestVenue(ctx: Ctx): Promise<GuestVenue | null> {
  const actor = requireGuest(ctx);
  const [o] = await ctx.db.select({ venueName: occasions.venueName, venueAddress: occasions.venueAddress }).from(occasions).where(eq(occasions.id, actor.occasionId));
  const journey = await readPublishedJourney(ctx, actor.occasionId);
  if (!o || (!o.venueAddress && !journey)) return null;
  return { venueName: o.venueName, venueAddress: o.venueAddress, navigationHref: o.venueAddress ? navigationHref(o.venueAddress, o.venueName) : null, journey };
}

function register(): void {
  registerGuestSection<GuestVenue>({ key: "venue", order: 58, load: (ctx) => getGuestVenue(ctx) });
  onOccasionPurge(async (tx, occasionId) => {
    await tx.db.delete(guestJourneys).where(eq(guestJourneys.occasionId, occasionId));
  });
}
register();
