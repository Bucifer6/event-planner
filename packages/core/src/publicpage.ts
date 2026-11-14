import {
  and,
  eq,
  occasions,
  publicPages,
  type PublicAnswer,
  type PublicQuestion,
  type PublicQuestionOption,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { zonedParts, zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { getOccasionBranding, type OccasionBranding } from "./bizoccasions";
import { readCapacity, type CapacityState } from "./capacity";
import { systemCtx, type Ctx } from "./context";
import { navigationHref, publicEventPath, readPublishedJourney, type PublishedJourney } from "./guestevent";
import { assertOccasionWritable } from "./lifecycle";
import { readPublicMenus, type MenuView } from "./menus";
import { onOccasionPurge } from "./occasions";
import { readPublicProgramme, type GuestProgrammeItem } from "./programme";
import { inTx } from "./tx";

// The public event page (C-06): what the planner configures and what anyone with the address
// /e/<slug> may read. Registrations live in @ed/core/registrations.
//
// - getPublicEvent() answers `null` for an unknown slug, an unpublished page and a closed
//   occasion alike — the web page shows one identical "not found" for all three.
// - The page shows only what the planner switched on (date, venue, programme, menu), and of
//   the programme only moments that are guest-visible AND concern everyone.
// - Questions carry ONE level of conditional logic: "show B only when A was answered X".
//   validateAnswers() decides visibility on the server: a hidden question is never required
//   and an answer sent for it is dropped.

export type PublicPage = typeof publicPages.$inferSelect;
export type { PublicAnswer, PublicQuestion, PublicQuestionOption };

const idSchema = z.string().min(1).max(64);
const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;
export const PUBLIC_MAX_QUESTIONS = 12;
export const PUBLIC_MAX_OPTIONS = 12;

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/;
const RESERVED_SLUGS = new Set(["admin", "api", "console", "new", "edit", "eventdesk", "login", "sign-in", "r", "www"]);

const optionalText = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const formBool = z.preprocess((v) => (v === "on" || v === "true" || v === "1" ? true : v === "" || v === "false" || v === "0" || v == null ? false : v), z.boolean()).default(false);
const optionalDay = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "common.validation.invalid").nullable()).default(null);

/** Suggests a slug from a title: "Nunta Ioanei & Andrei" → "nunta-ioanei-andrei". */
export function slugify(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : "eveniment";
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Absolute platform privacy notice (the default "privacy link" of a registration form). */
export function defaultPrivacyUrl(locale: "ro" | "en"): string {
  const base = (process.env.PUBLIC_URL || "https://eventdesk.ro").replace(/\/+$/, "");
  return `${base}/${locale}/confidentialitate`;
}

/* ── Planner: settings ───────────────────────────────────────────────────── */

export type PublicPageSettings = {
  page: PublicPage | null;
  occasion: { id: string; title: string; startsAt: Date | null; timezone: string; venueName: string | null; venueAddress: string | null; status: string };
  /** Slug proposed while there is no page yet. */
  suggestedSlug: string;
  /** Absolute URL of the page (even while unpublished, so it can be prepared). */
  url: string | null;
  capacity: CapacityState;
  canManage: boolean;
};

export async function getPublicPageSettings(ctx: Ctx, occasionId: string): Promise<PublicPageSettings> {
  const member = await requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [page] = await ctx.db.select().from(publicPages).where(eq(publicPages.occasionId, occasionId));
  return {
    page: page ?? null,
    occasion: { id: o.id, title: o.title, startsAt: o.startsAt, timezone: o.timezone, venueName: o.venueName, venueAddress: o.venueAddress, status: o.status },
    suggestedSlug: slugify(o.title),
    url: page ? `${appUrl()}${publicEventPath(page.slug)}` : null,
    capacity: await readCapacity(ctx, occasionId),
    canManage: member.role === "owner" || member.role === "pm",
  };
}

const pageInput = z.object({
  occasionId: idSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => SLUG_RE.test(v) && !RESERVED_SLUGS.has(v) && !v.includes("--"), "publicpage.errors.slug"),
  titleRo: z.string().trim().min(1, "common.validation.required").max(160, "common.validation.tooLong"),
  titleEn: optionalText(160),
  descriptionRo: optionalText(2000),
  descriptionEn: optionalText(2000),
  showDate: formBool,
  showVenue: formBool,
  showProgramme: formBool,
  showMenu: formBool,
  registrationEnabled: formBool,
  /** Days in the occasion's zone: opens at 00:00 of the first, closes at the END of the last. */
  opensOn: optionalDay,
  closesOn: optionalDay,
  sharesCapacity: formBool,
  privacyUrl: z
    .string()
    .max(500, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), "publicpage.errors.privacyUrl"),
  published: formBool,
});
export type PublicPageInput = z.input<typeof pageInput>;

function dayStart(day: string, tz: string, plusDays = 0): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + plusDays));
  return zonedToUtc({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }, tz);
}

/** "2027-05-30" for an instant in a zone (for the settings form). */
export function dayOf(d: Date | null, tz: string, minusMs = 0): string {
  if (!d) return "";
  const p = zonedParts(new Date(d.getTime() - minusMs), tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Creates or updates the occasion's public page (owner / PM). TAKEN when the slug is in use. */
export async function savePublicPage(ctx: Ctx, input: PublicPageInput): Promise<{ pageId: string; slug: string; published: boolean }> {
  const data = pageInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, data.occasionId);
  const [o] = await ctx.db.select({ timezone: occasions.timezone }).from(occasions).where(eq(occasions.id, data.occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const opensAt = data.opensOn ? dayStart(data.opensOn, o.timezone) : null;
  const closesAt = data.closesOn ? dayStart(data.closesOn, o.timezone, 1) : null;
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) {
    throw new AppError("VALIDATION", "publicpage.errors.closesBeforeOpens", { fieldErrors: { closesOn: ["publicpage.errors.closesBeforeOpens"] } });
  }
  const values = {
    slug: data.slug,
    published: data.published,
    titleRo: data.titleRo,
    titleEn: data.titleEn,
    descriptionRo: data.descriptionRo,
    descriptionEn: data.descriptionEn,
    showDate: data.showDate,
    showVenue: data.showVenue,
    showProgramme: data.showProgramme,
    showMenu: data.showMenu,
    registrationEnabled: data.registrationEnabled,
    registrationOpensAt: opensAt,
    registrationClosesAt: closesAt,
    sharesCapacity: data.sharesCapacity,
    privacyUrl: data.privacyUrl,
  };
  return inTx(ctx, async (tx) => {
    const [taken] = await tx.db.select({ occasionId: publicPages.occasionId }).from(publicPages).where(eq(publicPages.slug, data.slug));
    if (taken && taken.occasionId !== data.occasionId) {
      throw new AppError("TAKEN", "publicpage.errors.slugTaken", { fieldErrors: { slug: ["publicpage.errors.slugTaken"] } });
    }
    const [before] = await tx.db.select().from(publicPages).where(eq(publicPages.occasionId, data.occasionId));
    let row: PublicPage;
    try {
      // a savepoint, so a lost race on the unique slug becomes a TAKEN answer, not a dead transaction
      row = await inTx(tx, async (sp) => {
        const [saved] = await sp.db
          .insert(publicPages)
          .values({ occasionId: data.occasionId, ...values })
          .onConflictDoUpdate({ target: publicPages.occasionId, set: values })
          .returning();
        return saved!;
      });
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") {
        throw new AppError("TAKEN", "publicpage.errors.slugTaken", { fieldErrors: { slug: ["publicpage.errors.slugTaken"] } });
      }
      throw e;
    }
    await audit(tx, {
      action: before ? (before.published !== row.published ? (row.published ? "public_page.published" : "public_page.unpublished") : "public_page.updated") : "public_page.created",
      objectType: "public_page",
      objectId: row.id,
      before: before ? { slug: before.slug, published: before.published, registrationEnabled: before.registrationEnabled } : undefined,
      after: { slug: row.slug, published: row.published, registrationEnabled: row.registrationEnabled },
      meta: { occasionId: data.occasionId },
    });
    return { pageId: row.id, slug: row.slug, published: row.published };
  });
}

/* ── Planner: questions with one level of conditional logic ──────────────── */

const questionInput = z.object({
  occasionId: idSchema,
  questionId: z.preprocess((v) => (v === "" || v == null ? undefined : v), idSchema.optional()).optional(),
  kind: z.enum(["choice", "text"]),
  ro: z.string().trim().min(1, "common.validation.required").max(300, "common.validation.tooLong"),
  en: optionalText(300),
  /** One option per line; "Română | English" — the English part is optional. */
  options: z.string().max(4000, "common.validation.tooLong").nullish(),
  required: formBool,
  /** "<questionId>:<optionId>" or empty. */
  showIf: z.preprocess((v) => (v === "" || v == null ? null : v), z.string().max(140).nullable()).default(null),
});

function parseOptions(text: string | null | undefined, previous: PublicQuestionOption[]): PublicQuestionOption[] {
  const out: PublicQuestionOption[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const [roRaw, enRaw] = line.split("|");
    const ro = (roRaw ?? "").trim().slice(0, 120);
    if (!ro) continue;
    const en = (enRaw ?? "").trim().slice(0, 120) || ro;
    // an option keeps its id while its Romanian wording stays, so given answers stay readable
    const kept = previous.find((p) => p.ro === ro && !out.some((o) => o.id === p.id));
    out.push({ id: kept?.id ?? newId(), ro, en });
  }
  return out;
}

async function lockPage(tx: Ctx, occasionId: string): Promise<PublicPage> {
  const [page] = await tx.db.select().from(publicPages).where(eq(publicPages.occasionId, occasionId)).for("update");
  if (!page) throw new AppError("CONFLICT", "publicpage.errors.saveFirst");
  return page;
}

/** Adds or edits a registration question. A condition may only point at an EARLIER, unconditional choice question. */
export async function savePublicQuestion(ctx: Ctx, input: z.input<typeof questionInput>): Promise<{ questionId: string }> {
  const data = questionInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const page = await lockPage(tx, data.occasionId);
    const questions = [...page.questions];
    const at = data.questionId ? questions.findIndex((q) => q.id === data.questionId) : -1;
    if (data.questionId && at < 0) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (at < 0 && questions.length >= PUBLIC_MAX_QUESTIONS) throw new AppError("LIMIT", "publicpage.errors.tooManyQuestions");
    const previous = at >= 0 ? questions[at]! : null;
    const options = data.kind === "choice" ? parseOptions(data.options, previous?.options ?? []) : [];
    if (data.kind === "choice" && options.length < 2) {
      throw new AppError("VALIDATION", "publicpage.errors.twoOptions", { fieldErrors: { options: ["publicpage.errors.twoOptions"] } });
    }
    if (options.length > PUBLIC_MAX_OPTIONS) throw new AppError("VALIDATION", "publicpage.errors.tooManyOptions", { fieldErrors: { options: ["publicpage.errors.tooManyOptions"] } });

    let showIf: PublicQuestion["showIf"] = null;
    if (data.showIf) {
      const [questionId, optionId] = data.showIf.split(":");
      const earlier = questions.slice(0, at >= 0 ? at : questions.length);
      const parent = earlier.find((q) => q.id === questionId);
      // one level only: the parent must be an unconditional choice question placed before this one
      if (!parent || parent.kind !== "choice" || parent.showIf || !parent.options.some((o) => o.id === optionId)) {
        throw new AppError("VALIDATION", "publicpage.errors.condition", { fieldErrors: { showIf: ["publicpage.errors.condition"] } });
      }
      // a question others depend on cannot itself become conditional
      if (previous && questions.some((q) => q.showIf?.questionId === previous.id)) {
        throw new AppError("VALIDATION", "publicpage.errors.conditionChain", { fieldErrors: { showIf: ["publicpage.errors.conditionChain"] } });
      }
      showIf = { questionId: questionId!, optionId: optionId! };
    }
    const question: PublicQuestion = { id: previous?.id ?? newId(), kind: data.kind, ro: data.ro, en: data.en ?? data.ro, options, required: data.required, showIf };
    if (at >= 0) {
      questions[at] = question;
      // conditions pointing at an option that no longer exists are dropped (never a dangling rule)
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]!;
        if (q.showIf?.questionId === question.id && (question.kind !== "choice" || !question.options.some((o) => o.id === q.showIf!.optionId))) {
          questions[i] = { ...q, showIf: null };
        }
      }
    } else questions.push(question);
    await tx.db.update(publicPages).set({ questions }).where(eq(publicPages.id, page.id));
    await audit(tx, { action: "public_page.question_saved", objectType: "public_page", objectId: page.id, after: { questionId: question.id, kind: question.kind, conditional: !!showIf }, meta: { occasionId: data.occasionId } });
    return { questionId: question.id };
  });
}

export async function removePublicQuestion(ctx: Ctx, input: { occasionId: string; questionId: string }): Promise<void> {
  const data = z.object({ occasionId: idSchema, questionId: idSchema }).parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  await assertOccasionWritable(ctx, data.occasionId);
  await inTx(ctx, async (tx) => {
    const page = await lockPage(tx, data.occasionId);
    const questions = page.questions.filter((q) => q.id !== data.questionId).map((q) => (q.showIf?.questionId === data.questionId ? { ...q, showIf: null } : q));
    await tx.db.update(publicPages).set({ questions }).where(eq(publicPages.id, page.id));
    await audit(tx, { action: "public_page.question_removed", objectType: "public_page", objectId: page.id, before: { questionId: data.questionId }, meta: { occasionId: data.occasionId } });
  });
}

/** Name of the form field that carries the answer to a question. */
export function publicQuestionField(questionId: string): string {
  return `q_${questionId}`;
}

/** Is the question shown, given the answers so far? (Shared by the form and the server.) */
export function isQuestionVisible(q: Pick<PublicQuestion, "showIf">, answers: Record<string, PublicAnswer | undefined>): boolean {
  return !q.showIf || answers[q.showIf.questionId]?.optionId === q.showIf.optionId;
}

/**
 * Server-side validation of a registration's answers. `raw` maps q_<id> → the posted value.
 * Hidden questions are skipped entirely: never required, and anything posted for them is
 * dropped. Throws VALIDATION with one field error per question that needs fixing.
 */
export function validateAnswers(questions: PublicQuestion[], raw: Record<string, unknown>): Record<string, PublicAnswer> {
  const answers: Record<string, PublicAnswer> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const q of questions) {
    if (!isQuestionVisible(q, answers)) continue;
    const field = publicQuestionField(q.id);
    const value = typeof raw[field] === "string" ? (raw[field] as string).trim() : "";
    if (q.kind === "choice") {
      if (value === "") {
        if (q.required) fieldErrors[field] = ["publicpage.errors.chooseOption"];
        continue;
      }
      if (!q.options.some((o) => o.id === value)) {
        fieldErrors[field] = ["publicpage.errors.chooseOption"];
        continue;
      }
      answers[q.id] = { optionId: value, text: null };
    } else {
      if (value === "") {
        if (q.required) fieldErrors[field] = ["publicpage.errors.answerRequired"];
        continue;
      }
      if (value.length > 1000) {
        fieldErrors[field] = ["common.validation.tooLong"];
        continue;
      }
      answers[q.id] = { optionId: null, text: value };
    }
  }
  if (Object.keys(fieldErrors).length > 0) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  return answers;
}

/* ── The public read ─────────────────────────────────────────────────────── */

export type RegistrationWindow = "open" | "notYet" | "closed" | "off";

export function registrationWindow(page: Pick<PublicPage, "registrationEnabled" | "registrationOpensAt" | "registrationClosesAt">, occasionStatus: string, now: Date): RegistrationWindow {
  if (!page.registrationEnabled) return "off";
  if (occasionStatus !== "planning" && occasionStatus !== "postponed") return "closed";
  if (page.registrationOpensAt && page.registrationOpensAt.getTime() > now.getTime()) return "notYet";
  if (page.registrationClosesAt && page.registrationClosesAt.getTime() <= now.getTime()) return "closed";
  return "open";
}

export type PublicEvent = {
  pageId: string;
  occasionId: string;
  slug: string;
  title: { ro: string; en: string };
  description: { ro: string | null; en: string | null };
  status: "planning" | "cancelled" | "postponed";
  timezone: string;
  /** null = not shown or not decided. */
  startsAt: Date | null;
  endsAt: Date | null;
  dateShown: boolean;
  venue: { name: string | null; address: string | null; navigationHref: string | null } | null;
  /** null = not shown. */
  programme: GuestProgrammeItem[] | null;
  menus: MenuView[] | null;
  journey: PublishedJourney | null;
  branding: OccasionBranding | null;
  registration: {
    window: RegistrationWindow;
    opensAt: Date | null;
    closesAt: Date | null;
    /** true = no place left right now: a new registration joins the waiting list. */
    full: boolean;
    questions: PublicQuestion[];
    privacyUrl: { ro: string; en: string };
  };
};

/**
 * INTERNAL: the published page row for a slug, or null. Unknown, unpublished and
 * closed-occasion pages are the same null.
 */
export async function findPublishedPage(ctx: Pick<Ctx, "db">, slug: string): Promise<{ page: PublicPage; occasion: typeof occasions.$inferSelect } | null> {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return null;
  const [row] = await ctx.db
    .select({ page: publicPages, occasion: occasions })
    .from(publicPages)
    .innerJoin(occasions, eq(occasions.id, publicPages.occasionId))
    .where(and(eq(publicPages.slug, slug), eq(publicPages.published, true)));
  if (!row || row.occasion.status === "closed") return null;
  return row;
}

/**
 * Everything /e/<slug> shows, for anyone (no account, no cookie) — or null ("not found").
 * Contains no guest, no household, no count of who registered: only what the planner chose
 * to publish.
 */
export async function getPublicEvent(ctx: Ctx, slug: string): Promise<PublicEvent | null> {
  const found = await findPublishedPage(ctx, slug);
  if (!found) return null;
  const { page, occasion } = found;
  const window = registrationWindow(page, occasion.status, ctx.now);
  const [programme, menuList, journey, branding, capacity] = await Promise.all([
    page.showProgramme ? readPublicProgramme(ctx, occasion.id) : null,
    page.showMenu ? readPublicMenus(ctx, occasion.id) : null,
    readPublishedJourney(ctx, occasion.id),
    // branding is public on a published page; the reader has no membership, so read it as the system
    getOccasionBranding(systemCtx(ctx.db, { now: ctx.now }), occasion.id),
    page.sharesCapacity ? readCapacity(ctx, occasion.id) : null,
  ]);
  const hasVenue = page.showVenue && (occasion.venueName || occasion.venueAddress);
  return {
    pageId: page.id,
    occasionId: occasion.id,
    slug: page.slug,
    title: { ro: page.titleRo, en: page.titleEn ?? page.titleRo },
    description: { ro: page.descriptionRo, en: page.descriptionEn ?? page.descriptionRo },
    status: occasion.status as PublicEvent["status"],
    timezone: occasion.timezone,
    startsAt: page.showDate ? occasion.startsAt : null,
    endsAt: page.showDate ? occasion.endsAt : null,
    dateShown: page.showDate,
    venue: hasVenue
      ? { name: occasion.venueName, address: occasion.venueAddress, navigationHref: occasion.venueAddress ? navigationHref(occasion.venueAddress, occasion.venueName) : null }
      : null,
    programme: programme && programme.length > 0 ? programme : null,
    menus: menuList && menuList.length > 0 ? menuList : null,
    journey,
    branding,
    registration: {
      window,
      opensAt: page.registrationOpensAt,
      closesAt: page.registrationClosesAt,
      full: capacity !== null && capacity.left !== null && capacity.left === 0,
      questions: window === "open" ? page.questions : [],
      privacyUrl: { ro: page.privacyUrl ?? defaultPrivacyUrl("ro"), en: page.privacyUrl ?? defaultPrivacyUrl("en") },
    },
  };
}

function register(): void {
  onOccasionPurge(async (tx, occasionId) => {
    // registrations cascade from the page
    await tx.db.delete(publicPages).where(eq(publicPages.occasionId, occasionId));
  });
}
register();
