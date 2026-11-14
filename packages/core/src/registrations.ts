import {
  and,
  asc,
  desc,
  eq,
  lte,
  ne,
  occasions,
  publicPages,
  publicRegistrations,
  sql,
  type PublicAnswer,
  type RegistrationStatus,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, defineSchedule } from "@ed/jobs";
import { AppError, isAppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { claimPlaces, readCapacity, releasePlaces, type CapacityState } from "./capacity";
import { requireSystem, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { formatDay } from "./templates";
import { publicEventPath } from "./guestevent";
import { withIdempotency } from "./idempotency";
import { assertOccasionWritable, registerLifecycleImpact } from "./lifecycle";
import { findPublishedPage, registrationWindow, validateAnswers, type PublicPage } from "./publicpage";
import { checkPublicForm, enforceRateLimit } from "./ratelimit";
import { inTx } from "./tx";

// Public registrations and the waiting list (C-06, A8, SEC11, Q4).
//
// Who gets a place is decided by ONE statement — the conditional UPDATE of the occasion's
// shared capacity inside claimPlaces() (key "public:<registrationId>"): two people cannot take
// the last place, whether the other one is a public registrant or an invited household.
// Whoever does not fit is "waitlisted", in order of arrival.
//
// Everything that changes a page's registrations first locks the page row, so registrations,
// cancellations and promotions of ONE page run one after another:
//   - a registration first lets waiting people in (if places freed up meanwhile), then claims;
//   - a cancellation gives its places back and promotes in the same transaction;
//   - promotion walks the waiting list oldest first and admits every party that fits. The
//     status flips with a conditional UPDATE and the "you have a place" email is queued in
//     that same transaction under a unique key — promoted once, emailed once.
//
// MOUNT POINT for other domains: when places free up outside this file (an invited household
// answers "no", the planner raises the capacity) call
//     promoteWaitlist(ctx, occasionId)
// from already-checked code; the hourly "publicpage.promote-sweep" job does it as a net.
//
// The manage link (/e/<slug>/r/<token>) carries a 256-bit token stored only as SHA-256.
// The raw token leaves this module twice: in the registration result and in the confirmation
// email sent right after the transaction commits.

export type PublicRegistration = typeof publicRegistrations.$inferSelect;
export type { RegistrationStatus };

export const REGISTRATION_TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{22,128}$/;
export const REGISTRATION_MAX_ADULTS = 10;
export const REGISTRATION_MAX_CHILDREN = 10;
export const PROMOTED_EMAIL_JOB = "publicpage.promoted-email";
export const PROMOTE_SWEEP_JOB = "publicpage.promote-sweep";
export const LIFECYCLE_NOTIFY_JOB = "publicpage.lifecycle-notify";

const idSchema = z.string().min(1).max(64);
const claimKey = (registrationId: string) => `public:${registrationId}`;
const count = (min: number, max: number, key: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v === "" || v == null ? min : v), z.number(key).int(key).min(min, key).max(max, key));

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function registrationManagePath(slug: string, token: string): string {
  return `${publicEventPath(slug)}/r/${token}`;
}

/* ── Emails ──────────────────────────────────────────────────────────────── */

type RegisteredEmail = { eventTitle: string; name: string; status: "registered" | "waitlisted"; position: number | null; manageUrl: string; adults: number; children: number };
type PromotedEmail = { eventTitle: string; name: string };
type LifecycleEmail = { eventTitle: string; name: string; change: "cancelled" | "postponed"; date: string | null };

registerTemplate<RegisteredEmail>("publicpage.registered", (p, { t }) => ({
  subject: t(p.status === "registered" ? "publicpage.email.registered.subject" : "publicpage.email.waitlisted.subject", { event: p.eventTitle }),
  blocks: [
    { kind: "text", text: t("publicpage.email.greeting", { name: p.name }) },
    {
      kind: "text",
      text:
        p.status === "registered"
          ? t("publicpage.email.registered.body", { event: p.eventTitle, adults: p.adults, children: p.children })
          : t("publicpage.email.waitlisted.body", { event: p.eventTitle, position: p.position ?? 1 }),
    },
    { kind: "button", label: t("publicpage.email.manage"), url: p.manageUrl },
    { kind: "note", text: t("publicpage.email.manageNote") },
    { kind: "note", text: t("publicpage.email.why") },
  ],
}));

registerTemplate<PromotedEmail>("publicpage.promoted", (p, { t }) => ({
  subject: t("publicpage.email.promoted.subject", { event: p.eventTitle }),
  blocks: [
    { kind: "text", text: t("publicpage.email.greeting", { name: p.name }) },
    { kind: "text", text: t("publicpage.email.promoted.body", { event: p.eventTitle }) },
    { kind: "note", text: t("publicpage.email.promoted.link") },
    { kind: "note", text: t("publicpage.email.why") },
  ],
}));

registerTemplate<LifecycleEmail>("publicpage.lifecycle", (p, { t }) => ({
  subject: t(`publicpage.email.${p.change}.subject`, { event: p.eventTitle }),
  blocks: [
    { kind: "text", text: t("publicpage.email.greeting", { name: p.name }) },
    { kind: "text", text: p.change === "postponed" && p.date ? t("publicpage.email.postponed.body", { event: p.eventTitle, date: p.date }) : t(`publicpage.email.${p.change}.bodyNoDate`, { event: p.eventTitle }) },
    { kind: "note", text: t("publicpage.email.why") },
  ],
}));

/* ── Promotion (page row already locked) ─────────────────────────────────── */

async function lockPageById(tx: Ctx, pageId: string): Promise<PublicPage> {
  const [page] = await tx.db.select().from(publicPages).where(eq(publicPages.id, pageId)).for("update");
  if (!page) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return page;
}

/** Tries to take the party's places; false when they do not fit (nothing is held). */
async function tryClaim(tx: Ctx, page: PublicPage, reg: Pick<PublicRegistration, "id" | "adults" | "children">): Promise<boolean> {
  if (!page.sharesCapacity) return true;
  try {
    // a savepoint: a lost claim leaves the surrounding transaction usable
    await inTx(tx, (sp) => claimPlaces(sp, page.occasionId, { key: claimKey(reg.id), places: reg.adults + reg.children }));
    return true;
  } catch (e) {
    if (isAppError(e) && e.code === "TAKEN") return false;
    throw e;
  }
}

/** Marks a waitlisted registration as registered — once — and queues its one email. */
async function admit(tx: Ctx, reg: PublicRegistration): Promise<boolean> {
  const rows = await tx.db
    .update(publicRegistrations)
    .set({ status: "registered", promotedAt: tx.now })
    .where(and(eq(publicRegistrations.id, reg.id), eq(publicRegistrations.status, "waitlisted")))
    .returning({ id: publicRegistrations.id });
  if (!rows[0]) return false;
  await promotedEmailJob().enqueue(tx, { registrationId: reg.id }, { uniqueKey: `${PROMOTED_EMAIL_JOB}:${reg.id}` });
  await audit(tx, { action: "registration.promoted", objectType: "public_registration", objectId: reg.id, meta: { occasionId: reg.occasionId, places: reg.adults + reg.children } });
  return true;
}

async function promoteLocked(tx: Ctx, page: PublicPage): Promise<string[]> {
  const [o] = await tx.db.select({ status: occasions.status }).from(occasions).where(eq(occasions.id, page.occasionId));
  if (!o || (o.status !== "planning" && o.status !== "postponed")) return [];
  const waiting = await tx.db
    .select()
    .from(publicRegistrations)
    .where(and(eq(publicRegistrations.pageId, page.id), eq(publicRegistrations.status, "waitlisted")))
    .orderBy(asc(publicRegistrations.queueNo), asc(publicRegistrations.id));
  const promoted: string[] = [];
  for (const reg of waiting) {
    // oldest first; a party that does not fit is passed over so a smaller one behind it may enter
    if (!(await tryClaim(tx, page, reg))) continue;
    if (await admit(tx, reg)) promoted.push(reg.id);
  }
  return promoted;
}

/**
 * Lets waiting people in when places are free: the oldest waitlisted registration whose party
 * fits, then the next… — atomically, each emailed once. No access check (see the header).
 */
export async function promoteWaitlist(ctx: Ctx, occasionId: string): Promise<{ promoted: string[] }> {
  const id = idSchema.parse(occasionId);
  const [page] = await ctx.db.select({ id: publicPages.id }).from(publicPages).where(eq(publicPages.occasionId, id));
  if (!page) return { promoted: [] };
  return inTx(ctx, async (tx) => ({ promoted: await promoteLocked(tx, await lockPageById(tx, page.id)) }));
}

async function waitlistPosition(ctx: Pick<Ctx, "db">, reg: Pick<PublicRegistration, "pageId" | "queueNo">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(publicRegistrations)
    .where(and(eq(publicRegistrations.pageId, reg.pageId), eq(publicRegistrations.status, "waitlisted"), lte(publicRegistrations.queueNo, reg.queueNo)));
  return Math.max(1, row?.n ?? 1);
}

/* ── Registering (public, no account) ────────────────────────────────────── */

const registerInput = z.object({
  slug: z.string().max(80),
  name: z.string().trim().min(2, "publicpage.errors.name").max(120, "common.validation.tooLong"),
  email: z.string().trim().toLowerCase().max(254, "common.validation.tooLong").pipe(z.email("common.validation.invalidEmail")),
  adults: count(1, REGISTRATION_MAX_ADULTS, "publicpage.errors.adults"),
  children: count(0, REGISTRATION_MAX_CHILDREN, "publicpage.errors.children").default(0),
  /** q_<questionId> → posted value. */
  answers: z.record(z.string().max(80), z.unknown()).default({}),
  consent: z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).default(false),
  language: z.enum(["ro", "en"]).default("ro"),
  idempotencyKey: z.string().min(8).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
  honeypot: z.string().max(500).nullish(),
  renderedAt: z.string().max(200).nullish(),
});
export type RegisterInput = z.input<typeof registerInput>;

export type RegisterResult = {
  registrationId: string;
  status: "registered" | "waitlisted";
  /** Place in the waiting line (1 = next); null when registered. */
  position: number | null;
  /** The private manage link — returned ONCE, on the first submit. null on a replay. */
  managePath: string | null;
  replayed: boolean;
};

/**
 * Registers a party on a public page. Bot guard first (honeypot, time floor, per-IP and
 * per-page limits — SEC11), then one transaction decides "registered" or "waitlisted".
 * A second registration with the same email on the same page is refused kindly (CONFLICT
 * `publicpage.errors.alreadyRegistered`); the same idempotency key replays the first result.
 * An unpublished page, a closed window and an unknown slug are the same NOT_FOUND.
 */
export async function registerForEvent(ctx: Ctx, input: RegisterInput): Promise<RegisterResult> {
  const parsed = registerInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message.includes(".") ? issue.message : "common.validation.invalid");
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  }
  const data = parsed.data;
  const found = await findPublishedPage(ctx, data.slug);
  // the limits are counted BEFORE any transaction, so a rejected attempt still counts
  await checkPublicForm(ctx, { formKey: "public.register", linkKey: found?.page.id ?? `slug:${data.slug.slice(0, 60)}`, honeypot: data.honeypot ?? "", renderedAt: data.renderedAt ?? null, perIpPerHour: 20 });
  if (!found || registrationWindow(found.page, found.occasion.status, ctx.now) !== "open") {
    throw new AppError("NOT_FOUND", "publicpage.errors.closed");
  }
  if (!data.consent) throw new AppError("VALIDATION", "publicpage.errors.consent", { fieldErrors: { consent: ["publicpage.errors.consent"] } });
  const answers: Record<string, PublicAnswer> = validateAnswers(found.page.questions, data.answers);

  const token = randomToken(REGISTRATION_TOKEN_BYTES);
  const outcome = await inTx(ctx, async (tx) => {
    const page = await lockPageById(tx, found.page.id);
    if (!page.published || registrationWindow(page, found.occasion.status, tx.now) !== "open") throw new AppError("NOT_FOUND", "publicpage.errors.closed");

    const [replay] = await tx.db.select().from(publicRegistrations).where(and(eq(publicRegistrations.pageId, page.id), eq(publicRegistrations.idempotencyKey, data.idempotencyKey)));
    if (replay) {
      if (replay.email !== data.email) throw new AppError("CONFLICT", "common.errors.CONFLICT");
      return { reg: replay, replayed: true };
    }
    const [dup] = await tx.db
      .select({ id: publicRegistrations.id })
      .from(publicRegistrations)
      .where(and(eq(publicRegistrations.pageId, page.id), eq(publicRegistrations.email, data.email), ne(publicRegistrations.status, "cancelled")));
    if (dup) throw new AppError("CONFLICT", "publicpage.errors.alreadyRegistered", { fieldErrors: { email: ["publicpage.errors.alreadyRegistered"] } });

    // people already waiting come first when places freed up since the last change
    await promoteLocked(tx, page);

    const [counter] = await tx.db
      .update(publicPages)
      .set({ registrationCounter: sql`${publicPages.registrationCounter} + 1` })
      .where(eq(publicPages.id, page.id))
      .returning({ n: publicPages.registrationCounter });
    const [created] = await tx.db
      .insert(publicRegistrations)
      .values({
        pageId: page.id,
        queueNo: counter!.n,
        occasionId: page.occasionId,
        name: data.name,
        email: data.email,
        adults: data.adults,
        children: data.children,
        answers,
        language: data.language,
        status: "waitlisted",
        manageTokenHash: hashToken(token),
        idempotencyKey: data.idempotencyKey,
        consentAt: tx.now,
        createdAt: tx.now,
      })
      .returning();
    let reg = created!;
    if (await tryClaim(tx, page, reg)) {
      [reg] = (await tx.db.update(publicRegistrations).set({ status: "registered" }).where(eq(publicRegistrations.id, reg.id)).returning()) as [PublicRegistration];
    }
    await audit(tx, { action: "registration.created", objectType: "public_registration", objectId: reg.id, after: { status: reg.status, places: reg.adults + reg.children }, meta: { occasionId: page.occasionId } });
    return { reg, replayed: false };
  });

  const { reg, replayed } = outcome;
  const status = reg.status === "registered" ? "registered" : "waitlisted";
  const position = status === "waitlisted" ? await waitlistPosition(ctx, reg) : null;
  const managePath = replayed ? null : registrationManagePath(found.page.slug, token);
  if (!replayed) {
    try {
      await sendEmail(ctx, {
        to: reg.email,
        template: "publicpage.registered",
        params: {
          eventTitle: reg.language === "en" ? (found.page.titleEn ?? found.page.titleRo) : found.page.titleRo,
          name: reg.name,
          status,
          position,
          manageUrl: `${appUrl()}${managePath}?lang=${reg.language}`,
          adults: reg.adults,
          children: reg.children,
        } satisfies RegisteredEmail,
        locale: reg.language,
        occasionId: reg.occasionId,
      });
    } catch {
      // the registration stands; the page shows the manage link once in any case
    }
  }
  return { registrationId: reg.id, status, position, managePath, replayed };
}

/* ── The registrant's own link ───────────────────────────────────────────── */

export type OwnRegistration = {
  id: string;
  occasionId: string;
  pageId: string;
  slug: string;
  name: string;
  adults: number;
  children: number;
  status: RegistrationStatus;
  position: number | null;
  language: "ro" | "en";
  createdAt: Date;
  eventTitle: { ro: string; en: string };
  /** Whether cancelling is still possible (the occasion is not closed). */
  canCancel: boolean;
};

/** INTERNAL: token → registration row, or null. Unknown and malformed tokens are the same null; misses are rate-limited per IP. */
export async function resolveRegistration(ctx: Ctx, input: { slug: string; token: string }, opts: { rateLimit?: boolean } = {}): Promise<{ reg: PublicRegistration; page: PublicPage } | null> {
  const ok = typeof input.token === "string" && TOKEN_RE.test(input.token);
  const [row] = ok
    ? await ctx.db
        .select({ reg: publicRegistrations, page: publicPages })
        .from(publicRegistrations)
        .innerJoin(publicPages, eq(publicPages.id, publicRegistrations.pageId))
        .where(and(eq(publicRegistrations.manageTokenHash, hashToken(input.token)), eq(publicPages.slug, input.slug)))
    : [];
  if (!row) {
    if (opts.rateLimit ?? true) await enforceRateLimit(ctx, { scope: "public.registration.miss", rules: [{ axis: "ip", key: ctx.ip, limit: 30, windowSeconds: 3600 }] });
    return null;
  }
  return row;
}

/** What the manage link shows: this one registration, nothing of anyone else. */
export async function getOwnRegistration(ctx: Ctx, input: { slug: string; token: string }): Promise<OwnRegistration | null> {
  const found = await resolveRegistration(ctx, input);
  if (!found) return null;
  const { reg, page } = found;
  const [o] = await ctx.db.select({ status: occasions.status }).from(occasions).where(eq(occasions.id, reg.occasionId));
  return {
    id: reg.id,
    occasionId: reg.occasionId,
    pageId: page.id,
    slug: page.slug,
    name: reg.name,
    adults: reg.adults,
    children: reg.children,
    status: reg.status,
    position: reg.status === "waitlisted" ? await waitlistPosition(ctx, reg) : null,
    language: reg.language,
    createdAt: reg.createdAt,
    eventTitle: { ro: page.titleRo, en: page.titleEn ?? page.titleRo },
    canCancel: reg.status !== "cancelled" && o?.status !== "closed",
  };
}

async function cancelLocked(tx: Ctx, page: PublicPage, registrationId: string, by: "registrant" | "planner"): Promise<{ cancelled: boolean; promoted: string[] }> {
  const rows = await tx.db
    .update(publicRegistrations)
    .set({ status: "cancelled", cancelledAt: tx.now })
    .where(and(eq(publicRegistrations.id, registrationId), eq(publicRegistrations.pageId, page.id), ne(publicRegistrations.status, "cancelled")))
    .returning();
  const reg = rows[0];
  if (!reg) return { cancelled: false, promoted: [] };
  await releasePlaces(tx, page.occasionId, { key: claimKey(reg.id) });
  await audit(tx, { action: "registration.cancelled", objectType: "public_registration", objectId: reg.id, meta: { occasionId: page.occasionId, by } });
  // the freed places go to the waiting list in the same transaction
  return { cancelled: true, promoted: await promoteLocked(tx, page) };
}

/** The registrant cancels through the manage link. Cancelling twice changes nothing. */
export async function cancelOwnRegistration(ctx: Ctx, input: { slug: string; token: string }): Promise<{ cancelled: boolean }> {
  const found = await resolveRegistration(ctx, input);
  if (!found) throw new AppError("NOT_FOUND", "publicpage.errors.linkGone");
  await assertOccasionWritable(ctx, found.reg.occasionId);
  const res = await inTx(ctx, async (tx) => cancelLocked(tx, await lockPageById(tx, found.page.id), found.reg.id, "registrant"));
  return { cancelled: res.cancelled };
}

/* ── Planner side ────────────────────────────────────────────────────────── */

export type RegistrationRow = {
  id: string;
  name: string;
  email: string;
  adults: number;
  children: number;
  status: RegistrationStatus;
  position: number | null;
  createdAt: Date;
  promotedAt: Date | null;
  answers: Array<{ question: string; answer: string }>;
};
export type RegistrationsView = {
  hasPage: boolean;
  registered: RegistrationRow[];
  waitlisted: RegistrationRow[];
  cancelledCount: number;
  /** People holding a place through the public page. */
  places: { adults: number; children: number };
  capacity: CapacityState;
  sharesCapacity: boolean;
};

function describeAnswers(page: PublicPage, reg: PublicRegistration, locale: "ro" | "en"): RegistrationRow["answers"] {
  const out: RegistrationRow["answers"] = [];
  for (const q of page.questions) {
    const a = reg.answers[q.id];
    if (!a) continue;
    out.push({ question: q[locale], answer: a.optionId ? (q.options.find((o) => o.id === a.optionId)?.[locale] ?? "") : (a.text ?? "") });
  }
  return out;
}

/** Registrations and the waiting list. Managers only: it holds names and emails (D2). */
export async function listRegistrations(ctx: Ctx, occasionId: string): Promise<RegistrationsView> {
  await requireMember(ctx, occasionId, { manage: true });
  const [page] = await ctx.db.select().from(publicPages).where(eq(publicPages.occasionId, occasionId));
  const capacity = await readCapacity(ctx, occasionId);
  if (!page) return { hasPage: false, registered: [], waitlisted: [], cancelledCount: 0, places: { adults: 0, children: 0 }, capacity, sharesCapacity: true };
  const rows = await ctx.db.select().from(publicRegistrations).where(eq(publicRegistrations.pageId, page.id)).orderBy(asc(publicRegistrations.queueNo), asc(publicRegistrations.id));
  const locale = ctx.locale === "en" ? "en" : "ro";
  let line = 0;
  const view = (r: PublicRegistration): RegistrationRow => ({
    id: r.id,
    name: r.name,
    email: r.email,
    adults: r.adults,
    children: r.children,
    status: r.status,
    position: r.status === "waitlisted" ? ++line : null,
    createdAt: r.createdAt,
    promotedAt: r.promotedAt,
    answers: describeAnswers(page, r, locale),
  });
  const registered = rows.filter((r) => r.status === "registered").map(view);
  const waitlisted = rows.filter((r) => r.status === "waitlisted").map(view);
  return {
    hasPage: true,
    registered,
    waitlisted,
    cancelledCount: rows.filter((r) => r.status === "cancelled").length,
    places: { adults: registered.reduce((s, r) => s + r.adults, 0), children: registered.reduce((s, r) => s + r.children, 0) },
    capacity,
    sharesCapacity: page.sharesCapacity,
  };
}

async function loadForManage(ctx: Ctx, registrationId: string): Promise<PublicRegistration> {
  const id = idSchema.safeParse(registrationId);
  const [reg] = id.success ? await ctx.db.select().from(publicRegistrations).where(eq(publicRegistrations.id, id.data)) : [];
  if (!reg) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, reg.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, reg.occasionId);
  return reg;
}

/** A manager cancels a registration; its places go to the waiting list at once. */
export async function cancelRegistration(ctx: Ctx, input: { registrationId: string }): Promise<{ cancelled: boolean; promoted: number }> {
  const reg = await loadForManage(ctx, input.registrationId);
  const res = await inTx(ctx, async (tx) => cancelLocked(tx, await lockPageById(tx, reg.pageId), reg.id, "planner"));
  return { cancelled: res.cancelled, promoted: res.promoted.length };
}

/**
 * A manager lets one waiting party in by hand. It still needs the places: TAKEN
 * `publicpage.errors.noPlaces` (with how many are left) when they are not there.
 */
export async function promoteRegistration(ctx: Ctx, input: { registrationId: string }): Promise<{ promoted: boolean }> {
  const reg = await loadForManage(ctx, input.registrationId);
  return inTx(ctx, async (tx) => {
    const page = await lockPageById(tx, reg.pageId);
    const [current] = await tx.db.select().from(publicRegistrations).where(eq(publicRegistrations.id, reg.id));
    if (!current || current.status !== "waitlisted") return { promoted: false };
    if (!(await tryClaim(tx, page, current))) {
      const capacity = await readCapacity(tx, page.occasionId);
      throw new AppError("TAKEN", "publicpage.errors.noPlaces", { params: { left: capacity.left ?? 0, needed: current.adults + current.children } });
    }
    return { promoted: await admit(tx, current) };
  });
}

/* ── Jobs ────────────────────────────────────────────────────────────────── */

const promotedPayload = z.object({ registrationId: idSchema });

/** Sends the "you have a place" email — once per registration, whatever the retries. */
export async function sendPromotedEmail(ctx: Ctx, input: z.input<typeof promotedPayload>): Promise<"sent" | "skipped"> {
  requireSystem(ctx);
  const data = promotedPayload.parse(input);
  const [row] = await ctx.db
    .select({ reg: publicRegistrations, page: publicPages })
    .from(publicRegistrations)
    .innerJoin(publicPages, eq(publicPages.id, publicRegistrations.pageId))
    .where(eq(publicRegistrations.id, data.registrationId));
  if (!row || row.reg.status !== "registered") return "skipped";
  try {
    let ran = false;
    const status = await withIdempotency(ctx, PROMOTED_EMAIL_JOB, row.reg.id, async (tx) => {
      ran = true;
      const res = await sendEmail(tx, {
        to: row.reg.email,
        template: "publicpage.promoted",
        params: { eventTitle: row.reg.language === "en" ? (row.page.titleEn ?? row.page.titleRo) : row.page.titleRo, name: row.reg.name } satisfies PromotedEmail,
        locale: row.reg.language,
        occasionId: row.reg.occasionId,
      });
      return res.status;
    });
    return ran && status === "sent" ? "sent" : "skipped";
  } catch (e) {
    if (isAppError(e) && e.code === "LIMIT") return "skipped";
    throw e;
  }
}

function promotedEmailJob() {
  return defineJob(PROMOTED_EMAIL_JOB, promotedPayload, async (ctx, payload) => {
    await sendPromotedEmail(ctx, payload);
  });
}

/** The safety net: every occasion with people waiting gets a promotion pass. */
export async function sweepWaitlists(ctx: Ctx): Promise<{ occasions: number; promoted: number }> {
  requireSystem(ctx);
  const rows = await ctx.db
    .selectDistinct({ occasionId: publicRegistrations.occasionId })
    .from(publicRegistrations)
    .where(eq(publicRegistrations.status, "waitlisted"))
    .limit(2000);
  let promoted = 0;
  for (const r of rows) promoted += (await promoteWaitlist(ctx, r.occasionId)).promoted.length;
  return { occasions: rows.length, promoted };
}

const lifecyclePayload = z.object({ occasionId: idSchema, change: z.enum(["cancelled", "postponed"]), stamp: z.string().min(1).max(40) });

/** Tells every live registration that the event was cancelled or postponed — once each. */
export async function notifyRegistrantsOfChange(ctx: Ctx, input: z.input<typeof lifecyclePayload>): Promise<{ sent: number; skipped: number }> {
  requireSystem(ctx);
  const data = lifecyclePayload.parse(input);
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, data.occasionId));
  if (!o) return { sent: 0, skipped: 0 };
  const rows = await ctx.db
    .select({ reg: publicRegistrations, page: publicPages })
    .from(publicRegistrations)
    .innerJoin(publicPages, eq(publicPages.id, publicRegistrations.pageId))
    .where(and(eq(publicRegistrations.occasionId, o.id), ne(publicRegistrations.status, "cancelled")))
    .orderBy(desc(publicRegistrations.createdAt))
    .limit(5000);
  let sent = 0;
  let skipped = 0;
  for (const { reg, page } of rows) {
    try {
      let ran = false;
      const status = await withIdempotency(ctx, LIFECYCLE_NOTIFY_JOB, `${data.stamp}:${reg.id}`, async (tx) => {
        ran = true;
        const res = await sendEmail(tx, {
          to: reg.email,
          template: "publicpage.lifecycle",
          params: {
            eventTitle: reg.language === "en" ? (page.titleEn ?? page.titleRo) : page.titleRo,
            name: reg.name,
            change: data.change,
            date: o.startsAt ? formatDay(o.startsAt, o.timezone) : null,
          } satisfies LifecycleEmail,
          locale: reg.language,
          occasionId: o.id,
        });
        return res.status;
      });
      if (ran && status === "sent") sent++;
      else skipped++;
    } catch (e) {
      if (isAppError(e) && e.code === "LIMIT") {
        skipped++;
        break;
      }
      throw e;
    }
  }
  return { sent, skipped };
}

function lifecycleJob() {
  return defineJob(LIFECYCLE_NOTIFY_JOB, lifecyclePayload, async (ctx, payload) => {
    await notifyRegistrantsOfChange(ctx, payload);
  });
}

/* ── Registrations at import time (idempotent) ───────────────────────────── */

const CSV_HEAD = {
  ro: ["Nume", "Email", "Adulți", "Copii (număr)", "Stare", "Poziție pe lista de așteptare", "Înregistrat la", "Răspunsuri"],
  en: ["Name", "Email", "Adults", "Children (count)", "Status", "Waiting-list position", "Registered at", "Answers"],
} as const;
const STATUS_LABEL = {
  ro: { registered: "înregistrat", waitlisted: "pe lista de așteptare", cancelled: "anulat" },
  en: { registered: "registered", waitlisted: "waiting list", cancelled: "cancelled" },
} as const;

function register(): void {
  promotedEmailJob();
  lifecycleJob();
  defineJob(PROMOTE_SWEEP_JOB, z.object({}).passthrough(), async (ctx) => {
    await sweepWaitlists(ctx);
  });

  registerExport({
    key: "registrations-csv",
    titleKey: "publicpage.export.title",
    descriptionKey: "publicpage.export.description",
    manageOnly: true,
    run: async (ctx, occasionId) => {
      const view = await listRegistrations(ctx, occasionId);
      const l = ctx.locale === "en" ? "en" : "ro";
      const rows = [...view.registered, ...view.waitlisted].map((r) => [
        r.name,
        r.email,
        r.adults,
        r.children,
        STATUS_LABEL[l][r.status],
        r.position,
        r.createdAt.toISOString(),
        r.answers.map((a) => `${a.question}: ${a.answer}`).join(" | "),
      ]);
      return { filename: `inregistrari-${occasionId}.csv`, mime: "text/csv; charset=utf-8", content: toCsv([...CSV_HEAD[l]], rows) };
    },
  });

  registerLifecycleImpact({
    key: "publicpage.registrations",
    collect: async (ctx, occasionId, change) => {
      if (change.kind === "close") return [];
      // counts only — never names (D2)
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(publicRegistrations)
        .where(and(eq(publicRegistrations.occasionId, occasionId), ne(publicRegistrations.status, "cancelled")));
      const n = row?.n ?? 0;
      if (n === 0) return [];
      return [
        {
          key: "registrations",
          what: { key: "publicpage.lifecycle.registrations", params: { count: n } },
          kindLabelKey: "publicpage.lifecycle.label",
          noteKey: change.kind === "cancel" ? "publicpage.lifecycle.cancelNote" : "publicpage.lifecycle.postponeNote",
        },
      ];
    },
    apply: async (tx, occasionId, change) => {
      if (change.kind === "close") return;
      const stamp = tx.now.toISOString();
      await lifecycleJob().enqueue(tx, { occasionId, change: change.kind === "cancel" ? "cancelled" : "postponed", stamp }, { uniqueKey: `${LIFECYCLE_NOTIFY_JOB}:${occasionId}:${stamp}` });
    },
  });
}
register();

export function registerJobs(): void {
  register();
  defineSchedule({ name: "publicpage.promote-sweep.hourly", job: PROMOTE_SWEEP_JOB, every: { kind: "hourly", minute: 20 } });
}
