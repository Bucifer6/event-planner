import {
  and,
  asc,
  eq,
  guests,
  households,
  inArray,
  invitations,
  isNull,
  occasionGuestSettings,
  occasions,
  rsvpAnswers,
  rsvpQuestions,
  rsvpResponses,
  sql,
  type GuestLanguage,
  type InvitationExpiryMode,
  type OccasionDateMode,
  type OccasionKind,
  type OccasionStatus,
  type RsvpAttending,
  type RsvpQuestionKind,
  type RsvpQuestionOption,
} from "@ed/db";
import { AppError, isAppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx, GuestActor } from "./context";
import { enforceRateLimit } from "./ratelimit";
import { inTx } from "./tx";

// Invitation links (A6, S6, SEC2, SEC7, INF5, L2).
//
// - One link per household. The token is 32 random bytes (256 bits) and only its SHA-256 is
//   stored: the raw token leaves this module exactly twice — when the invitation is created and
//   when it is regenerated. Nobody (planner, staff, database reader) can read it back later.
// - resolveGuestLink() answers `null` for an unknown, revoked AND expired link alike, so the
//   page can show one identical "not found" answer (no enumeration).
// - A guest actor is scoped to ONE household: getGuestView() returns that household only.
// - Later releases add sections to the guest page with registerGuestSection().

/** 32 bytes = 256 bits (SEC2 asks for at least 128). */
export const INVITATION_TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,128}$/;

const idSchema = z.string().min(1).max(64);

export type Invitation = typeof invitations.$inferSelect;

export type InvitationMeta = {
  id: string;
  householdId: string;
  language: GuestLanguage;
  expiryMode: InvitationExpiryMode;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastViewedAt: Date | null;
  emailedAt: Date | null;
  /** "active" | "revoked" | "expired" at ctx.now */
  state: "active" | "revoked" | "expired";
};

export function guestLinkPath(token: string): string {
  return `/g/${token}`;
}

function newToken(): { token: string; tokenHash: string } {
  const token = randomToken(INVITATION_TOKEN_BYTES);
  return { token, tokenHash: hashToken(token) };
}

type ExpiryFacts = {
  rsvpDeadline: Date | null;
  occasionStatus: OccasionStatus;
  occasionClosedAt: Date | null;
};

function isExpired(inv: Pick<Invitation, "expiryMode" | "expiresAt">, facts: ExpiryFacts, now: Date): boolean {
  if (inv.expiresAt && inv.expiresAt.getTime() <= now.getTime()) return true;
  if (inv.expiryMode === "rsvp_deadline") {
    return !!facts.rsvpDeadline && facts.rsvpDeadline.getTime() <= now.getTime();
  }
  if (inv.expiryMode === "closeout") {
    return (
      facts.occasionStatus === "closed" ||
      (!!facts.occasionClosedAt && facts.occasionClosedAt.getTime() <= now.getTime())
    );
  }
  return false;
}

async function expiryFacts(ctx: Ctx, occasionId: string): Promise<ExpiryFacts> {
  const [row] = await ctx.db
    .select({
      status: occasions.status,
      closedAt: occasions.closedAt,
      rsvpDeadline: occasionGuestSettings.rsvpDeadline,
    })
    .from(occasions)
    .leftJoin(occasionGuestSettings, eq(occasionGuestSettings.occasionId, occasions.id))
    .where(eq(occasions.id, occasionId));
  return {
    rsvpDeadline: row?.rsvpDeadline ?? null,
    occasionStatus: row?.status ?? "planning",
    occasionClosedAt: row?.closedAt ?? null,
  };
}

function toMeta(inv: Invitation, facts: ExpiryFacts, now: Date): InvitationMeta {
  return {
    id: inv.id,
    householdId: inv.householdId,
    language: inv.language,
    expiryMode: inv.expiryMode,
    expiresAt: inv.expiryMode === "rsvp_deadline" ? (facts.rsvpDeadline ?? inv.expiresAt) : inv.expiresAt,
    revokedAt: inv.revokedAt,
    lastViewedAt: inv.lastViewedAt,
    emailedAt: inv.emailedAt,
    state: inv.revokedAt ? "revoked" : isExpired(inv, facts, now) ? "expired" : "active",
  };
}

/** Invitation state for the planner (never the token: it is not stored). */
export async function listInvitationMeta(ctx: Ctx, occasionId: string): Promise<Map<string, InvitationMeta>> {
  await requireMember(ctx, occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  const facts = await expiryFacts(ctx, occasionId);
  const rows = await ctx.db.select().from(invitations).where(eq(invitations.occasionId, occasionId));
  return new Map(rows.map((r) => [r.householdId, toMeta(r, facts, ctx.now)]));
}

/**
 * INTERNAL (used by guests.createHousehold inside its transaction, after its access check):
 * creates the household's invitation and returns the raw token — the only time it exists.
 */
export async function createInvitationRow(
  ctx: Ctx,
  input: { occasionId: string; householdId: string; language: GuestLanguage },
): Promise<{ invitationId: string; token: string }> {
  const { token, tokenHash } = newToken();
  const [row] = await ctx.db
    .insert(invitations)
    .values({
      occasionId: input.occasionId,
      householdId: input.householdId,
      tokenHash,
      language: input.language,
    })
    .returning({ id: invitations.id });
  return { invitationId: row!.id, token };
}

async function loadForManage(ctx: Ctx, householdId: string): Promise<Invitation> {
  const id = idSchema.parse(householdId);
  const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.householdId, id));
  if (!inv) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, inv.occasionId, { manage: true });
  return inv;
}

/**
 * Replaces the household's link: the old one stops working at once, the new raw token is
 * returned ONCE. Also lifts a revocation (a regenerated link is a working link).
 */
export async function regenerateInvitation(
  ctx: Ctx,
  input: { householdId: string },
): Promise<{ invitationId: string; token: string; path: string }> {
  const inv = await loadForManage(ctx, input.householdId);
  const { token, tokenHash } = newToken();
  return inTx(ctx, async (tx) => {
    await tx.db
      .update(invitations)
      .set({ tokenHash, revokedAt: null, lastViewedAt: null, emailedAt: null })
      .where(eq(invitations.id, inv.id));
    await audit(tx, { action: "invitation.regenerated", objectType: "invitation", objectId: inv.id });
    return { invitationId: inv.id, token, path: guestLinkPath(token) };
  });
}

/** Revokes the link (it answers like an unknown link from now on). Idempotent. */
export async function revokeInvitation(ctx: Ctx, input: { householdId: string }): Promise<void> {
  const inv = await loadForManage(ctx, input.householdId);
  if (inv.revokedAt) return;
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(invitations)
      .set({ revokedAt: ctx.now })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.revokedAt)));
    await audit(tx, { action: "invitation.revoked", objectType: "invitation", objectId: inv.id });
  });
}

const expiryInput = z.object({
  householdId: idSchema,
  mode: z.enum(["never", "rsvp_deadline", "closeout"]),
});

/** never | rsvp_deadline (stops working when the RSVP deadline passes) | closeout. */
export async function setInvitationExpiry(ctx: Ctx, input: z.input<typeof expiryInput>): Promise<void> {
  const data = expiryInput.parse(input);
  const inv = await loadForManage(ctx, data.householdId);
  const facts = await expiryFacts(ctx, inv.occasionId);
  const expiresAt = data.mode === "rsvp_deadline" ? facts.rsvpDeadline : null;
  await inTx(ctx, async (tx) => {
    await tx.db.update(invitations).set({ expiryMode: data.mode, expiresAt }).where(eq(invitations.id, inv.id));
    await audit(tx, {
      action: "invitation.expiry_set",
      objectType: "invitation",
      objectId: inv.id,
      before: { mode: inv.expiryMode },
      after: { mode: data.mode },
    });
  });
}

/** INTERNAL: keeps `expires_at` of deadline-bound links in step with the RSVP deadline. */
export async function syncDeadlineExpiry(ctx: Ctx, occasionId: string, rsvpDeadline: Date | null): Promise<void> {
  await ctx.db
    .update(invitations)
    .set({ expiresAt: rsvpDeadline })
    .where(and(eq(invitations.occasionId, occasionId), eq(invitations.expiryMode, "rsvp_deadline")));
}

/* ── Guest side ──────────────────────────────────────────────────────────── */

export type GuestLink = {
  actor: GuestActor;
  invitationId: string;
  householdId: string;
  occasionId: string;
  /** The language the invitation was sent in (L2): the page opens in it. */
  language: GuestLanguage;
  /** Stable, non-secret key of this link for rate limits (the token hash). */
  linkKey: string;
};

/** Lookups per IP per hour; a guest stepping through the page stays far below. */
export const GUEST_LINK_LIMITS = { perIpPerHour: 600, missesPerIpPerHour: 30, perLinkPerHour: 1200 } as const;

/**
 * Token from the URL -> the guest actor of ONE household, or `null`.
 * Unknown, malformed, revoked and expired tokens all return null (same answer, SEC2).
 * Throws RATE_LIMITED when an IP keeps guessing or a link is hammered.
 */
export async function resolveGuestLink(
  ctx: Ctx,
  token: string,
  opts: { rateLimit?: boolean } = {},
): Promise<GuestLink | null> {
  const limit = opts.rateLimit ?? true;
  const wellFormed = typeof token === "string" && TOKEN_RE.test(token);
  const tokenHash = wellFormed ? hashToken(token) : null;

  let inv: Invitation | undefined;
  if (tokenHash) {
    [inv] = await ctx.db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
  }
  let ok = !!inv && !inv.revokedAt;
  if (ok && inv) {
    const facts = await expiryFacts(ctx, inv.occasionId);
    if (isExpired(inv, facts, ctx.now)) ok = false;
  }

  if (limit) {
    if (!ok) {
      await enforceRateLimit(ctx, {
        scope: "guest.link.miss",
        rules: [{ axis: "ip", key: ctx.ip, limit: GUEST_LINK_LIMITS.missesPerIpPerHour, windowSeconds: 3600 }],
      });
    } else {
      await enforceRateLimit(ctx, {
        scope: "guest.link",
        rules: [
          { axis: "ip", key: ctx.ip, limit: GUEST_LINK_LIMITS.perIpPerHour, windowSeconds: 3600 },
          { axis: "key", key: tokenHash, limit: GUEST_LINK_LIMITS.perLinkPerHour, windowSeconds: 3600 },
        ],
      });
    }
  }
  if (!ok || !inv || !tokenHash) return null;
  return {
    actor: {
      kind: "guest",
      invitationId: inv.id,
      householdId: inv.householdId,
      occasionId: inv.occasionId,
    },
    invitationId: inv.id,
    householdId: inv.householdId,
    occasionId: inv.occasionId,
    language: inv.language,
    linkKey: tokenHash,
  };
}

/** The guest actor of this request, or UNAUTHENTICATED-as-NOT_FOUND for anyone else. */
export function requireGuest(ctx: Ctx): GuestActor {
  if (ctx.actor.kind !== "guest") throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return ctx.actor;
}

export type GuestQuestion = {
  id: string;
  kind: RsvpQuestionKind;
  text: { ro: string; en: string };
  /** Empty for typed answers. accommodation / transport without options are yes–no. */
  options: RsvpQuestionOption[];
  required: boolean;
  /** "choice" = pick one option, "text" = type an answer */
  answerType: "choice" | "text";
};

export type GuestResponse = {
  attending: RsvpAttending;
  adultsCount: number;
  childrenCount: number;
  answeredAt: Date;
  answers: Record<string, { optionId: string | null; valueText: string | null }>;
};

export type GuestView = {
  occasion: {
    id: string;
    title: string;
    kind: OccasionKind;
    status: OccasionStatus;
    dateMode: OccasionDateMode;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string;
    venueName: string | null;
    venueAddress: string | null;
  };
  household: {
    id: string;
    name: string;
    leadName: string | null;
    /** Whether an address for change notices is on file. The address itself is never echoed. */
    hasEmail: boolean;
    /** Named adults of THIS household. */
    adults: string[];
    expectedPartySize: number | null;
  };
  invitation: { id: string; language: GuestLanguage };
  rsvp: {
    deadline: Date | null;
    /** false once the deadline has passed or the occasion is cancelled/closed */
    open: boolean;
    questions: GuestQuestion[];
    response: GuestResponse | null;
  };
  /** INF5: set when the planner changed something since this household last opened its link. */
  changed: { at: Date | null; reasonKey: string | null } | null;
  sections: Array<{ key: string; order: number; data: unknown }>;
};

/** Yes–no options used by accommodation / transport questions that define none. */
export const YES_NO_OPTIONS: RsvpQuestionOption[] = [
  { id: "yes", ro: "Da", en: "Yes" },
  { id: "no", ro: "Nu", en: "No" },
];

export function toGuestQuestion(q: typeof rsvpQuestions.$inferSelect): GuestQuestion {
  const text = q.kind === "allergies" || q.kind === "free_text";
  const options = text
    ? []
    : q.options.length > 0
      ? q.options
      : q.kind === "accommodation" || q.kind === "transport"
        ? YES_NO_OPTIONS
        : [];
  return {
    id: q.id,
    kind: q.kind,
    text: { ro: q.textRo, en: q.textEn },
    options,
    required: q.required,
    answerType: text || options.length === 0 ? "text" : "choice",
  };
}

/* Guest page extension registry — seating, programme, menu… add their own sections. */

export type GuestSectionBase = Omit<GuestView, "sections">;
export type GuestSection<T = unknown> = {
  /** Unique key; the web page maps it to a renderer (apps/web/app/g/[token]/sections.tsx). */
  key: string;
  /** Lower first. Built-ins: polls 20, contributions 40. */
  order: number;
  /** Return JSON-safe data for THIS household only, or null to show nothing. */
  load: (ctx: Ctx, view: GuestSectionBase) => Promise<T | null>;
};

const g = globalThis as unknown as { __edGuestSections?: Map<string, GuestSection> };
const sections: Map<string, GuestSection> = (g.__edGuestSections ??= new Map());

/** Registers (or replaces) a section shown under the invitation on the guest link. */
export function registerGuestSection<T>(section: GuestSection<T>): void {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(section.key)) throw new Error(`Invalid guest section key "${section.key}"`);
  sections.set(section.key, section as GuestSection);
}

/**
 * Everything the guest link shows — for the household of the guest actor and nothing else
 * (SEC2): no other household, no guest list, no planner data.
 */
export async function getGuestView(ctx: Ctx): Promise<GuestView> {
  const actor = requireGuest(ctx);
  const [row] = await ctx.db
    .select({ inv: invitations, household: households, occasion: occasions, settings: occasionGuestSettings })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .innerJoin(occasions, eq(occasions.id, invitations.occasionId))
    .leftJoin(occasionGuestSettings, eq(occasionGuestSettings.occasionId, invitations.occasionId))
    .where(
      and(
        eq(invitations.id, actor.invitationId),
        eq(invitations.householdId, actor.householdId),
        eq(invitations.occasionId, actor.occasionId),
        isNull(invitations.revokedAt),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const { inv, household, occasion, settings } = row;

  const [adultRows, questionRows, responseRows, answerRows] = await Promise.all([
    ctx.db
      .select({ fullName: guests.fullName })
      .from(guests)
      .where(eq(guests.householdId, household.id))
      .orderBy(asc(guests.createdAt)),
    ctx.db
      .select()
      .from(rsvpQuestions)
      .where(and(eq(rsvpQuestions.occasionId, occasion.id), isNull(rsvpQuestions.archivedAt)))
      .orderBy(asc(rsvpQuestions.position), asc(rsvpQuestions.createdAt)),
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, household.id)),
    ctx.db.select().from(rsvpAnswers).where(eq(rsvpAnswers.householdId, household.id)),
  ]);
  const response = responseRows[0] ?? null;
  const deadline = settings?.rsvpDeadline ?? null;
  const open =
    occasion.status !== "cancelled" &&
    occasion.status !== "closed" &&
    (!deadline || deadline.getTime() > ctx.now.getTime());
  const revision = settings?.guestRevision ?? 0;
  const changed =
    inv.lastViewedAt && revision > inv.seenRevision
      ? { at: settings?.guestRevisionAt ?? null, reasonKey: settings?.guestRevisionReasonKey ?? null }
      : null;

  const base: GuestSectionBase = {
    occasion: {
      id: occasion.id,
      title: occasion.title,
      kind: occasion.kind,
      status: occasion.status,
      dateMode: occasion.dateMode,
      startsAt: occasion.startsAt,
      endsAt: occasion.endsAt,
      timezone: occasion.timezone,
      venueName: occasion.venueName,
      venueAddress: occasion.venueAddress,
    },
    household: {
      id: household.id,
      name: household.name,
      leadName: household.leadName,
      hasEmail: !!household.leadEmail,
      adults: adultRows.map((a) => a.fullName),
      expectedPartySize: household.expectedPartySize,
    },
    invitation: { id: inv.id, language: inv.language },
    rsvp: {
      deadline,
      open,
      questions: questionRows.map(toGuestQuestion),
      response: response
        ? {
            attending: response.attending,
            adultsCount: response.adultsCount,
            childrenCount: response.childrenCount,
            answeredAt: response.answeredAt,
            answers: Object.fromEntries(
              answerRows.map((a) => [a.questionId, { optionId: a.optionId, valueText: a.valueText }]),
            ),
          }
        : null,
    },
    changed,
  };

  const loaded: GuestView["sections"] = [];
  for (const s of [...sections.values()].sort((a, b) => a.order - b.order)) {
    const data = await s.load(ctx, base);
    if (data !== null && data !== undefined) loaded.push({ key: s.key, order: s.order, data });
  }
  return { ...base, sections: loaded };
}

/** Records that the household opened its link and has now seen the current revision (INF5). */
export async function markGuestLinkViewed(ctx: Ctx): Promise<void> {
  const actor = requireGuest(ctx);
  await ctx.db
    .update(invitations)
    .set({
      lastViewedAt: ctx.now,
      seenRevision: sql`COALESCE((SELECT ${occasionGuestSettings.guestRevision} FROM ${occasionGuestSettings} WHERE ${occasionGuestSettings.occasionId} = ${invitations.occasionId}), 0)`,
    })
    .where(eq(invitations.id, actor.invitationId));
}

/**
 * Planner-side changes guests should notice (date, venue, programme, seating…) call this:
 * households see "changed since your last visit" on their link (INF5).
 * `reasonKey` is a full i18n key shown on the guest page, e.g. "rsvp.changes.date".
 * No access check — call it from core code that already checked the actor (never a guest).
 */
export async function bumpGuestRevision(ctx: Ctx, occasionId: string, reasonKey: string): Promise<number> {
  if (ctx.actor.kind === "guest" || ctx.actor.kind === "anonymous") {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  const id = idSchema.parse(occasionId);
  const key = z.string().min(1).max(200).parse(reasonKey);
  const [row] = await ctx.db
    .insert(occasionGuestSettings)
    .values({ occasionId: id, guestRevision: 1, guestRevisionAt: ctx.now, guestRevisionReasonKey: key })
    .onConflictDoUpdate({
      target: occasionGuestSettings.occasionId,
      set: {
        guestRevision: sql`${occasionGuestSettings.guestRevision} + 1`,
        guestRevisionAt: ctx.now,
        guestRevisionReasonKey: key,
      },
    })
    .returning({ revision: occasionGuestSettings.guestRevision });
  return row!.revision;
}

/* ── Sending the invitations by email ────────────────────────────────────── */

export type InvitationEmail = {
  to: string;
  locale: GuestLanguage;
  occasionId: string;
  householdName: string;
  occasionTitle: string;
  startsAt: Date | null;
  timezone: string;
  venueName: string | null;
  /** Path of the fresh link ("/g/<token>"); the caller prefixes the app URL. */
  path: string;
};

/** Delivers one message — the web layer passes a wrapper around @ed/email sendEmail. */
export type DeliverInvitation = (ctx: Ctx, email: InvitationEmail) => Promise<void>;

const sendInput = z.object({
  occasionId: idSchema,
  /** Omit = every household with an email that was not emailed and has not answered yet. */
  householdIds: z.array(idSchema).max(1000).optional(),
});

export type SendInvitationsResult = { sent: number; skipped: number; stoppedByLimit: boolean };

/**
 * Emails the invitation to households that have an address (managers only).
 * Because tokens are stored hashed, each emailed household gets a FRESH link (its previous
 * link stops working); with no explicit list only households that were never emailed and have
 * not answered are picked, so links already shared by hand stay valid.
 * The per-occasion daily email cap (Q6) is enforced by the deliverer; when it trips the rest
 * are left untouched and `stoppedByLimit` is true.
 */
export async function sendInvitationEmails(
  ctx: Ctx,
  input: z.input<typeof sendInput>,
  deliver: DeliverInvitation,
): Promise<SendInvitationsResult> {
  const data = sendInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, data.occasionId));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");

  const rows = await ctx.db
    .select({ household: households, inv: invitations, responseId: rsvpResponses.id })
    .from(households)
    .innerJoin(invitations, eq(invitations.householdId, households.id))
    .leftJoin(rsvpResponses, eq(rsvpResponses.householdId, households.id))
    .where(
      and(
        eq(households.occasionId, data.occasionId),
        data.householdIds ? inArray(households.id, data.householdIds.length ? data.householdIds : [""]) : sql`true`,
      ),
    )
    .orderBy(asc(households.createdAt));

  let sent = 0;
  let skipped = 0;
  let stoppedByLimit = false;
  for (const r of rows) {
    const explicit = !!data.householdIds;
    const eligible =
      !!r.household.leadEmail && !r.inv.revokedAt && (explicit || (!r.inv.emailedAt && !r.responseId));
    if (!eligible || stoppedByLimit) {
      skipped++;
      continue;
    }
    try {
      await inTx(ctx, async (tx) => {
        const { token, tokenHash } = newToken();
        await tx.db
          .update(invitations)
          .set({ tokenHash, emailedAt: ctx.now, lastViewedAt: null })
          .where(eq(invitations.id, r.inv.id));
        await deliver(tx, {
          to: r.household.leadEmail!,
          locale: r.inv.language,
          occasionId: occasion.id,
          householdName: r.household.name,
          occasionTitle: occasion.title,
          startsAt: occasion.startsAt,
          timezone: occasion.timezone,
          venueName: occasion.venueName,
          path: guestLinkPath(token),
        });
        await audit(tx, { action: "invitation.emailed", objectType: "invitation", objectId: r.inv.id });
      });
      sent++;
    } catch (e) {
      if (isAppError(e) && e.code === "LIMIT") {
        stoppedByLimit = true;
        skipped++;
        continue;
      }
      throw e;
    }
  }
  return { sent, skipped, stoppedByLimit };
}
