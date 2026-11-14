import {
  and,
  bookings,
  desc,
  DIET_TAGS,
  eq,
  households,
  inArray,
  occasions,
  PRIVATE_REQUEST_KINDS,
  privateRequests,
  publicRegistrations,
  sql,
  suppliers,
  type BriefingContent,
  type DietTag,
  type PrivateRequestKind,
  type PrivateRequestStatus,
} from "@ed/db";
import { translate } from "@ed/i18n/load";
import { AppError, isAppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { listBriefingVersions, publishBriefing } from "./briefings";
import { getClosedOccasionsOlderThan } from "./closeout";
import { actorAccountId, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { assertNoChildDetails } from "./guests";
import { registerGuestSection, requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { checkPublicForm } from "./ratelimit";
import { resolveRegistration } from "./registrations";
import { registerRetentionRule } from "./retention";
import { inTx } from "./tx";

// Private dietary / access requests (C-07, D2, D5, INF6).
//
// - A guest (on their link) or a public registrant (on their manage link) sends a request:
//   dietary need, access need or something else — a tag from the fixed diet list and/or free
//   text. Typing a child's details triggers the same gentle warning as the RSVP (invariant 9).
// - READING is for members holding the `privateRequests` grant, and nobody else: every read
//   here goes through requireMember(…, { grant: "privateRequests" }). A manager without the
//   grant gets FORBIDDEN; the nav item is hidden for them (occasion layout); the CSV export is
//   registered with the same grant. There is no MCP tool and no supplier path to the rows.
// - Suppliers only ever receive ANONYMOUS COUNTS ("3 × fără gluten"), and only when a grant
//   holder explicitly shares them into a supplier briefing (shareRequestCounts).
// - The guest sees that a request was sent (kind + date), never its text again: a link
//   forwarded in a group chat must not expose what somebody wrote in confidence.
// - Retention: purged 30 days after the occasion's closeout (retention rule "private-requests").

export { PRIVATE_REQUEST_KINDS };
export type { PrivateRequestKind, PrivateRequestStatus };
export type PrivateRequest = typeof privateRequests.$inferSelect;

export const PRIVATE_REQUEST_RETENTION_DAYS = 30;
export const PRIVATE_REQUESTS_PER_SENDER = 10;
const GRANT = { grant: "privateRequests" } as const;

const idSchema = z.string().min(1).max(64);
const requestFields = {
  kind: z.enum(PRIVATE_REQUEST_KINDS, "requests.errors.kind"),
  dietTag: z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(DIET_TAGS).nullable()).default(null),
  body: z
    .string()
    .max(1000, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  /** Set once the writer saw the child-details warning and sends anyway. */
  childDetailsAcknowledged: z.preprocess((v) => v === true || v === "1" || v === "on" || v === "true", z.boolean()).default(false),
};
const guestInput = z.object(requestFields);
export type GuestRequestInput = z.input<typeof guestInput>;

function checkContent(data: { kind: PrivateRequestKind; dietTag: DietTag | null; body: string | null; childDetailsAcknowledged: boolean }): { dietTag: DietTag | null } {
  const dietTag = data.kind === "dietary" ? data.dietTag : null;
  if (!dietTag && !data.body) throw new AppError("VALIDATION", "requests.errors.empty", { fieldErrors: { body: ["requests.errors.empty"] } });
  assertNoChildDetails({ body: data.body }, data.childDetailsAcknowledged);
  return { dietTag };
}

async function insertRequest(
  ctx: Ctx,
  sender: { occasionId: string; householdId?: string; registrationId?: string },
  data: { kind: PrivateRequestKind; dietTag: DietTag | null; body: string | null },
): Promise<{ requestId: string }> {
  await assertOccasionWritable(ctx, sender.occasionId);
  return inTx(ctx, async (tx) => {
    const who = sender.householdId ? eq(privateRequests.householdId, sender.householdId) : eq(privateRequests.registrationId, sender.registrationId!);
    const [n] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(privateRequests).where(and(eq(privateRequests.occasionId, sender.occasionId), who));
    if ((n?.n ?? 0) >= PRIVATE_REQUESTS_PER_SENDER) throw new AppError("LIMIT", "requests.errors.tooMany");
    const [row] = await tx.db
      .insert(privateRequests)
      .values({ occasionId: sender.occasionId, householdId: sender.householdId ?? null, registrationId: sender.registrationId ?? null, kind: data.kind, dietTag: data.dietTag, body: data.body, createdAt: tx.now })
      .returning({ id: privateRequests.id });
    // the audit trail records THAT a request arrived — never what it says
    await audit(tx, { action: "private_request.created", objectType: "private_request", objectId: row!.id, after: { kind: data.kind }, meta: { occasionId: sender.occasionId } });
    return { requestId: row!.id };
  });
}

/** A household sends a private request from its guest link (bot guard: runGuestAction). */
export async function submitGuestRequest(ctx: Ctx, input: GuestRequestInput): Promise<{ requestId: string }> {
  const actor = requireGuest(ctx);
  const data = guestInput.parse(input);
  const { dietTag } = checkContent(data);
  return insertRequest(ctx, { occasionId: actor.occasionId, householdId: actor.householdId }, { kind: data.kind, dietTag, body: data.body });
}

const registrantInput = z.object({
  ...requestFields,
  slug: z.string().max(80),
  token: z.string().max(128),
  honeypot: z.string().max(500).nullish(),
  renderedAt: z.string().max(200).nullish(),
});

/** A public registrant sends a private request from their manage link (SEC11 guard inside). */
export async function submitRegistrantRequest(ctx: Ctx, input: z.input<typeof registrantInput>): Promise<{ requestId: string }> {
  const data = registrantInput.parse(input);
  const found = await resolveRegistration(ctx, { slug: data.slug, token: data.token });
  await checkPublicForm(ctx, { formKey: "public.request", linkKey: found?.reg.id ?? "unknown", honeypot: data.honeypot ?? "", renderedAt: data.renderedAt ?? null, perIpPerHour: 20, perLinkPerHour: 20 });
  if (!found || found.reg.status === "cancelled") throw new AppError("NOT_FOUND", "publicpage.errors.linkGone");
  const { dietTag } = checkContent(data);
  return insertRequest(ctx, { occasionId: found.reg.occasionId, registrationId: found.reg.id }, { kind: data.kind, dietTag, body: data.body });
}

export type SentRequests = {
  /** What this sender already sent: kind and time only — never the text. */
  sent: Array<{ kind: PrivateRequestKind; at: string }>;
  canSend: boolean;
};

async function sentBy(ctx: Pick<Ctx, "db">, occasionId: string, who: { householdId: string } | { registrationId: string }): Promise<SentRequests> {
  const [o] = await ctx.db.select({ status: occasions.status }).from(occasions).where(eq(occasions.id, occasionId));
  const rows = await ctx.db
    .select({ kind: privateRequests.kind, at: privateRequests.createdAt })
    .from(privateRequests)
    .where("householdId" in who ? eq(privateRequests.householdId, who.householdId) : eq(privateRequests.registrationId, who.registrationId))
    .orderBy(desc(privateRequests.createdAt));
  return {
    sent: rows.map((r) => ({ kind: r.kind, at: r.at.toISOString() })),
    canSend: !!o && o.status !== "closed" && o.status !== "cancelled" && rows.length < PRIVATE_REQUESTS_PER_SENDER,
  };
}

/** Guest link section "Cerere privată". */
export async function getGuestRequests(ctx: Ctx): Promise<SentRequests | null> {
  const actor = requireGuest(ctx);
  const res = await sentBy(ctx, actor.occasionId, { householdId: actor.householdId });
  return res.canSend || res.sent.length > 0 ? res : null;
}

/** Same for a public registrant (manage link). null for an unknown link. */
export async function getRegistrantRequests(ctx: Ctx, input: { slug: string; token: string }): Promise<SentRequests | null> {
  const found = await resolveRegistration(ctx, input);
  if (!found) return null;
  const res = await sentBy(ctx, found.reg.occasionId, { registrationId: found.reg.id });
  return found.reg.status === "cancelled" ? { ...res, canSend: false } : res;
}

/* ── Grant holders ───────────────────────────────────────────────────────── */

export type PrivateRequestView = {
  id: string;
  kind: PrivateRequestKind;
  dietTag: DietTag | null;
  body: string | null;
  status: PrivateRequestStatus;
  note: string | null;
  createdAt: Date;
  handledAt: Date | null;
  /** Who asked: the household's label or the registrant's name. */
  from: { type: "household" | "registration"; name: string };
};

/** Every private request of the occasion. `privateRequests` grant ONLY. */
export async function listPrivateRequests(ctx: Ctx, occasionId: string): Promise<{ requests: PrivateRequestView[]; canManageBriefings: boolean }> {
  const member = await requireMember(ctx, occasionId, GRANT);
  const rows = await ctx.db
    .select({ r: privateRequests, household: households.name, registrant: publicRegistrations.name })
    .from(privateRequests)
    .leftJoin(households, eq(households.id, privateRequests.householdId))
    .leftJoin(publicRegistrations, eq(publicRegistrations.id, privateRequests.registrationId))
    .where(eq(privateRequests.occasionId, occasionId))
    .orderBy(sql`${privateRequests.status} = 'handled'`, desc(privateRequests.createdAt));
  return {
    requests: rows.map(({ r, household, registrant }) => ({
      id: r.id,
      kind: r.kind,
      dietTag: r.dietTag,
      body: r.body,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
      handledAt: r.handledAt,
      from: r.householdId ? { type: "household", name: household ?? "" } : { type: "registration", name: registrant ?? "" },
    })),
    canManageBriefings: member.role === "owner" || member.role === "pm",
  };
}

const statusInput = z.object({
  requestId: idSchema,
  status: z.enum(["open", "handled"]),
  note: z
    .string()
    .max(1000, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

/** Marks a request handled / not handled and keeps the holder's note. Grant holders only. */
export async function setRequestStatus(ctx: Ctx, input: z.input<typeof statusInput>): Promise<void> {
  const data = statusInput.parse(input);
  const [row] = await ctx.db.select().from(privateRequests).where(eq(privateRequests.id, data.requestId));
  // unknown id and "not yours to see" answer the same way for a non-member; a member without
  // the grant gets FORBIDDEN from requireMember
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, row.occasionId, GRANT);
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, row.occasionId);
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(privateRequests)
      .set({ status: data.status, note: data.note, handledAt: data.status === "handled" ? (row.handledAt ?? tx.now) : null, handledByAccountId: data.status === "handled" ? actorAccountId(tx.actor) : null })
      .where(eq(privateRequests.id, row.id));
    await audit(tx, { action: "private_request.status_set", objectType: "private_request", objectId: row.id, before: { status: row.status }, after: { status: data.status }, meta: { occasionId: row.occasionId } });
  });
}

export type PrivateRequestCounts = {
  total: number;
  open: number;
  byKind: Record<PrivateRequestKind, number>;
  /** Only tags that occur. */
  byDietTag: Array<{ tag: DietTag; count: number }>;
};

/** Anonymous counts of the occasion's requests. `privateRequests` grant ONLY. */
export async function getPrivateRequestCounts(ctx: Ctx, occasionId: string): Promise<PrivateRequestCounts> {
  await requireMember(ctx, occasionId, GRANT);
  const rows = await ctx.db.select({ kind: privateRequests.kind, dietTag: privateRequests.dietTag, status: privateRequests.status }).from(privateRequests).where(eq(privateRequests.occasionId, occasionId));
  const byKind = { dietary: 0, access: 0, other: 0 } as Record<PrivateRequestKind, number>;
  const tags = new Map<DietTag, number>();
  for (const r of rows) {
    byKind[r.kind]++;
    if (r.dietTag) tags.set(r.dietTag, (tags.get(r.dietTag) ?? 0) + 1);
  }
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    byKind,
    byDietTag: DIET_TAGS.filter((t) => tags.has(t)).map((t) => ({ tag: t, count: tags.get(t)! })),
  };
}

const SHARE_START = { ro: "— Cerințe ale invitaților (doar numere) —", en: "— Guest requirements (counts only) —" } as const;
const SHARE_END = { ro: "— Sfârșitul cerințelor —", en: "— End of requirements —" } as const;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripShareBlock(text: string): string {
  let out = text;
  for (const l of ["ro", "en"] as const) out = out.replace(new RegExp(`\\n*${escapeRe(SHARE_START[l])}[\\s\\S]*?${escapeRe(SHARE_END[l])}\\n*`, "g"), "\n\n");
  return out.trim();
}

/** The anonymous lines a holder may share: "3 × fără gluten". Pure. */
export function composeShareLines(counts: PrivateRequestCounts, pick: { tags: DietTag[]; access: boolean }, locale: "ro" | "en"): string[] {
  const lines = counts.byDietTag.filter((t) => pick.tags.includes(t.tag)).map((t) => `${t.count} × ${translate(locale, `menus.diet.${t.tag}`)}`);
  if (pick.access && counts.byKind.access > 0) lines.push(`${counts.byKind.access} × ${translate(locale, "requests.share.accessLine")}`);
  return lines;
}

const shareInput = z.object({
  occasionId: idSchema,
  bookingId: idSchema,
  tags: z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(DIET_TAGS)).max(DIET_TAGS.length)).default([]),
  access: z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).default(false),
});

/**
 * The ONLY way anything about private requests reaches a supplier: a grant holder who also
 * manages the occasion picks which counts to share, and they are published as the next
 * version of that supplier's briefing (special notes) — numbers and tag names, no person,
 * no household, no free text.
 */
export async function shareRequestCounts(ctx: Ctx, input: z.input<typeof shareInput>): Promise<{ version: number; lines: string[] }> {
  const data = shareInput.parse(input);
  await requireMember(ctx, data.occasionId, { ...GRANT, manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, data.occasionId);
  const [booking] = await ctx.db
    .select({ id: bookings.id, locale: occasions.locale })
    .from(bookings)
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .innerJoin(occasions, eq(occasions.id, bookings.occasionId))
    .where(and(eq(bookings.id, data.bookingId), eq(bookings.occasionId, data.occasionId)));
  if (!booking) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const lines = composeShareLines(await getPrivateRequestCounts(ctx, data.occasionId), { tags: data.tags, access: data.access }, booking.locale);
  if (lines.length === 0) throw new AppError("VALIDATION", "requests.errors.nothingToShare", { fieldErrors: { tags: ["requests.errors.nothingToShare"] } });
  const latest = (await listBriefingVersions(ctx, booking.id))[0]?.content ?? null;
  const base: BriefingContent = latest ?? { what: "", when: "", where: "", contacts: "", specialNotes: "", freeText: "" };
  const block = [SHARE_START[booking.locale], ...lines, SHARE_END[booking.locale]].join("\n");
  const specialNotes = [stripShareBlock(base.specialNotes), block].filter((s) => s !== "").join("\n\n");
  try {
    const res = await publishBriefing(ctx, { bookingId: booking.id, ...base, specialNotes });
    await audit(ctx, { action: "private_request.counts_shared", objectType: "booking", objectId: booking.id, after: { lines: lines.length, version: res.version }, meta: { occasionId: data.occasionId } });
    return { version: res.version, lines };
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT" && e.messageKey === "briefing.errors.unchanged") throw new AppError("CONFLICT", "requests.errors.alreadyShared");
    throw e;
  }
}

/* ── Retention (INF6 / D5) ───────────────────────────────────────────────── */

/** Deletes the private requests of occasions closed at least 30 days ago. System only. */
export async function purgeExpiredPrivateRequests(ctx: Ctx): Promise<number> {
  const ids = await getClosedOccasionsOlderThan(ctx, PRIVATE_REQUEST_RETENTION_DAYS);
  if (ids.length === 0) return 0;
  const gone = await ctx.db.delete(privateRequests).where(inArray(privateRequests.occasionId, ids)).returning({ id: privateRequests.id });
  return gone.length;
}

const CSV_HEAD = {
  ro: ["De la", "Fel", "Etichetă", "Cerere", "Stare", "Notă", "Primită la"],
  en: ["From", "Kind", "Tag", "Request", "Status", "Note", "Received at"],
} as const;

function register(): void {
  registerGuestSection<SentRequests>({ key: "privateRequest", order: 70, load: (ctx) => getGuestRequests(ctx) });

  registerRetentionRule({ name: "private-requests", run: (ctx) => purgeExpiredPrivateRequests(ctx) });

  // members without the grant neither see nor can run this export (D2)
  registerExport({
    key: "private-requests-csv",
    titleKey: "requests.export.title",
    descriptionKey: "requests.export.description",
    grant: "privateRequests",
    run: async (ctx, occasionId) => {
      const { requests } = await listPrivateRequests(ctx, occasionId);
      const l = ctx.locale === "en" ? "en" : "ro";
      const rows = requests.map((r) => [
        r.from.name,
        translate(l, `requests.kinds.${r.kind}`),
        r.dietTag ? translate(l, `menus.diet.${r.dietTag}`) : "",
        r.body,
        translate(l, `requests.status.${r.status}`),
        r.note,
        r.createdAt.toISOString(),
      ]);
      return { filename: `cereri-private-${occasionId}.csv`, mime: "text/csv; charset=utf-8", content: toCsv([...CSV_HEAD[l]], rows) };
    },
  });

  onOccasionPurge(async (tx, occasionId) => {
    await tx.db.delete(privateRequests).where(eq(privateRequests.occasionId, occasionId));
  });
}
register();

export function registerJobs(): void {
  register();
}
