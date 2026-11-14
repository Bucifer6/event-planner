import {
  asc,
  contributionClaims,
  contributionNeeds,
  eq,
  guests,
  households,
  inArray,
  rsvpAnswers,
  rsvpQuestions,
  rsvpResponses,
  sql,
  type GuestLanguage,
  type RsvpAttending,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zEmail, zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember, type Member } from "./access";
import { audit } from "./audit";
import { getClaim, releasePlaces } from "./capacity";
import type { Ctx } from "./context";
import {
  createInvitationRow,
  guestLinkPath,
  listInvitationMeta,
  toGuestQuestion,
  type GuestQuestion,
  type InvitationMeta,
} from "./invitations";
import { inTx } from "./tx";
import { registerWhatIf } from "./whatif";

// Households and guests (A6, D2, invariant 9).
//
// - A household is the unit that is invited and answers. `guests` are its named ADULTS.
// - Children are never persons: nothing here stores a child. The only number about children
//   is `rsvp_responses.children_count`. Free text that looks like child details is caught by
//   detectChildDetails() and the writer is asked to remove it.
// - Reading the list: owner, PM, workstream lead, contributor. Contacts (lead email) and all
//   changes: owner / PM only (D2).

const idSchema = z.string().min(1).max(64);
const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;
export const HOUSEHOLD_RSVP_CLAIM = (householdId: string): string => `rsvp:${householdId}`;

/* ── Child-detail detector ───────────────────────────────────────────────── */

// \b is ASCII-only in JavaScript ("fetiță" would not end on a boundary), so words are
// delimited with Unicode look-arounds instead.
const word = (src: string, flags = "iu"): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, flags);
const UNITS = "ani[sș]ori|ani|an|luni|lun[aă]|years?(?:\\s+old)?|yrs?|y\\.?o\\.?|months?";
const CHILD_WORD = word(
  "copil(?:ul|ului|a[sș]ul)?|copii(?:i|lor)?|feti[tț][aăei]|fat[aă]|fiic[aăe]|fiul|fiu|b[aă]ie[tț]el(?:ul)?|b[aă]iatul|b[aă]iat|bebe(?:lu[sș](?:ul)?)?|nepo[tț]el(?:ul)?|nepo[tț]ic[aă]|gemenii|kids?|child(?:ren)?|son|daughter|baby|toddler|infant|boy|girl|twins",
);
const AGE = word(`\\d{1,2}\\s*(?:${UNITS})`);
const AGE_WORDS = word(
  `(?:un|o|doi|dou[aă]|trei|patru|cinci|[sș]ase|[sș]apte|opt|nou[aă]|zece|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:${UNITS})`,
);
// case-sensitive on purpose: a capitalised name followed by an age ("Matei, 7 ani")
const NAME_WITH_AGE = new RegExp(
  `\\p{Lu}\\p{Ll}{2,}\\s*(?:[,(–-]\\s*|\\s+(?:are|de|is|aged?)\\s+)(\\d{1,2})\\s*(?:${UNITS})(?![\\p{L}\\p{N}])`,
  "u",
);
const BIRTH = word(
  "n[aă]scut[aă]?|data\\s+na[sș]terii|zi(?:ua)?\\s+de\\s+na[sș]tere|born|birth\\s*date|date\\s+of\\s+birth|d\\.?o\\.?b\\.?",
);
const DATE = /(?<!\d)\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?!\d)|(?<!\d)(?:19|20)\d{2}(?!\d)/u;
const NAMED = word("se\\s+nume[sș]te|[iî]l\\s+cheam[aă]|o\\s+cheam[aă]|pe\\s+nume|named|called|name\\s+is");

/**
 * true when free text looks like details about a child: a child word with an age, a name or a
 * birth date ("fetița mea Ana are 5 ani", "Matei, 7 ani", "born 12.03.2019").
 * A bare count ("venim cu 2 copii") is fine — the count is exactly what we do keep.
 */
export function detectChildDetails(text: string | null | undefined): boolean {
  if (!text) return false;
  const s = text.normalize("NFC");
  const age = AGE.test(s) || AGE_WORDS.test(s);
  if (CHILD_WORD.test(s) && (age || NAMED.test(s) || (BIRTH.test(s) && DATE.test(s)))) return true;
  if (BIRTH.test(s) && DATE.test(s)) return true;
  const named = NAME_WITH_AGE.exec(s);
  if (named) {
    const n = Number(named[1]);
    const months = /luni|months?/iu.test(named[0]);
    if (months || n < 18) return true;
  }
  return false;
}

/** Throws the gentle VALIDATION warning for `field` unless the writer already saw it. */
export function assertNoChildDetails(
  fields: Record<string, string | null | undefined>,
  acknowledged: boolean,
): void {
  if (acknowledged) return;
  const flagged = Object.entries(fields).filter(([, v]) => detectChildDetails(v));
  if (flagged.length === 0) return;
  throw new AppError("VALIDATION", "rsvp.errors.childDetails", {
    fieldErrors: Object.fromEntries(flagged.map(([k]) => [k, ["rsvp.errors.childDetails"]])),
    childDetails: true,
  });
}

/* ── Households ──────────────────────────────────────────────────────────── */

export type Household = typeof households.$inferSelect;
export type Guest = typeof guests.$inferSelect;

const zCount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
  z.number().int("common.validation.invalid").min(1, "common.validation.tooSmall").max(200, "common.validation.tooBig").optional(),
);
const zOptionalEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  zEmail.optional(),
);
const zNames = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/\r?\n|;/)
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(zText(120)).max(40).optional(),
);
const zAck = z.preprocess((v) => v === true || v === "1" || v === "true" || v === "on", z.boolean()).optional();

const householdFields = {
  name: zText(120),
  leadName: zOptionalText(120),
  leadEmail: zOptionalEmail,
  language: z.enum(["ro", "en"]).default("ro"),
  expectedPartySize: zCount,
  notes: zOptionalText(1000),
  /** set after the child-details warning was shown once */
  childDetailsAcknowledged: zAck,
};

const createInput = z.object({
  occasionId: idSchema,
  ...householdFields,
  /** Adult names: an array, or one name per line. */
  guestNames: zNames,
});
export type CreateHouseholdInput = z.input<typeof createInput>;

export type CreatedHousehold = {
  householdId: string;
  invitationId: string;
  /** The raw link token — returned ONLY here (and by regenerateInvitation). */
  token: string;
  path: string;
};

/** INTERNAL: insert without access check (createHousehold and the import use it in their tx). */
export async function insertHousehold(
  tx: Ctx,
  data: {
    occasionId: string;
    name: string;
    leadName?: string;
    leadEmail?: string;
    language: GuestLanguage;
    expectedPartySize?: number;
    notes?: string;
    guestNames?: string[];
  },
): Promise<CreatedHousehold> {
  const [h] = await tx.db
    .insert(households)
    .values({
      occasionId: data.occasionId,
      name: data.name,
      leadName: data.leadName ?? null,
      leadEmail: data.leadEmail ?? null,
      language: data.language,
      expectedPartySize: data.expectedPartySize ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  const names = data.guestNames ?? [];
  if (names.length > 0) {
    await tx.db
      .insert(guests)
      .values(names.map((fullName) => ({ occasionId: data.occasionId, householdId: h!.id, fullName })));
  }
  const inv = await createInvitationRow(tx, {
    occasionId: data.occasionId,
    householdId: h!.id,
    language: data.language,
  });
  await audit(tx, {
    action: "household.created",
    objectType: "household",
    objectId: h!.id,
    after: { name: data.name, adults: names.length },
  });
  return { householdId: h!.id, invitationId: inv.invitationId, token: inv.token, path: guestLinkPath(inv.token) };
}

/** Adds a household with its invitation link (owner / PM). */
export async function createHousehold(ctx: Ctx, input: CreateHouseholdInput): Promise<CreatedHousehold> {
  const data = createInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  assertNoChildDetails({ notes: data.notes, name: data.name }, data.childDetailsAcknowledged ?? false);
  return inTx(ctx, (tx) => insertHousehold(tx, data));
}

async function loadHousehold(ctx: Ctx, householdId: string): Promise<Household> {
  const [h] = await ctx.db.select().from(households).where(eq(households.id, idSchema.parse(householdId)));
  if (!h) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return h;
}

const updateInput = z.object({ householdId: idSchema, ...householdFields });

export async function updateHousehold(ctx: Ctx, input: z.input<typeof updateInput>): Promise<void> {
  const data = updateInput.parse(input);
  const h = await loadHousehold(ctx, data.householdId);
  await requireMember(ctx, h.occasionId, { manage: true });
  assertNoChildDetails({ notes: data.notes, name: data.name }, data.childDetailsAcknowledged ?? false);
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(households)
      .set({
        name: data.name,
        leadName: data.leadName ?? null,
        leadEmail: data.leadEmail ?? null,
        language: data.language,
        expectedPartySize: data.expectedPartySize ?? null,
        notes: data.notes ?? null,
      })
      .where(eq(households.id, h.id));
    // the link keeps opening in the household's language (L2)
    await tx.db.execute(
      sql`UPDATE invitations SET language = ${data.language}, updated_at = now() WHERE household_id = ${h.id}`,
    );
    await audit(tx, {
      action: "household.updated",
      objectType: "household",
      objectId: h.id,
      before: { name: h.name, language: h.language },
      after: { name: data.name, language: data.language },
    });
  });
}

const guestInput = z.object({ householdId: idSchema, fullName: zText(120) });

/** Adds a named ADULT to a household. */
export async function addGuest(ctx: Ctx, input: z.input<typeof guestInput>): Promise<{ guestId: string }> {
  const data = guestInput.parse(input);
  const h = await loadHousehold(ctx, data.householdId);
  await requireMember(ctx, h.occasionId, { manage: true });
  assertNoChildDetails({ fullName: data.fullName }, false);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(guests)
      .values({ occasionId: h.occasionId, householdId: h.id, fullName: data.fullName })
      .returning({ id: guests.id });
    await audit(tx, { action: "guest.added", objectType: "guest", objectId: row!.id });
    return { guestId: row!.id };
  });
}

export async function removeGuest(ctx: Ctx, input: { guestId: string }): Promise<void> {
  const id = idSchema.parse(input.guestId);
  const [row] = await ctx.db.select().from(guests).where(eq(guests.id, id));
  if (!row) return;
  await requireMember(ctx, row.occasionId, { manage: true });
  await inTx(ctx, async (tx) => {
    await tx.db.delete(guests).where(eq(guests.id, id));
    await audit(tx, { action: "guest.removed", objectType: "guest", objectId: id });
  });
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export type HouseholdStatus = RsvpAttending | "pending";

export type HouseholdListItem = {
  id: string;
  name: string;
  leadName: string | null;
  /** null for members who are not managers (D2) */
  leadEmail: string | null;
  /** whether contacts were withheld from this viewer */
  contactsHidden: boolean;
  language: GuestLanguage;
  expectedPartySize: number | null;
  adults: string[];
  status: HouseholdStatus;
  adultsCount: number | null;
  childrenCount: number | null;
  answeredAt: Date | null;
  invitation: InvitationMeta | null;
};

const listInput = z.object({
  occasionId: idSchema,
  q: z.string().trim().max(120).optional(),
  status: z.enum(["all", "yes", "maybe", "no", "pending"]).default("all"),
});

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
/** Case-, diacritic- and space-insensitive key used for search and duplicate detection. */
export const nameKey = fold;

/** The household list with each household's answer. Search matches household and adult names. */
export async function listHouseholds(
  ctx: Ctx,
  input: z.input<typeof listInput>,
): Promise<{ items: HouseholdListItem[]; total: number; canManage: boolean }> {
  const data = listInput.parse(input);
  const member = await requireMember(ctx, data.occasionId, { roles: [...READ_ROLES] });
  const manager = isManager(member);
  const [rows, guestRows, responses, invMeta] = await Promise.all([
    ctx.db.select().from(households).where(eq(households.occasionId, data.occasionId)).orderBy(asc(households.name)),
    ctx.db.select().from(guests).where(eq(guests.occasionId, data.occasionId)).orderBy(asc(guests.createdAt)),
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.occasionId, data.occasionId)),
    listInvitationMeta(ctx, data.occasionId),
  ]);
  const byHousehold = new Map<string, string[]>();
  for (const g of guestRows) (byHousehold.get(g.householdId) ?? byHousehold.set(g.householdId, []).get(g.householdId)!).push(g.fullName);
  const responseBy = new Map(responses.map((r) => [r.householdId, r]));
  const q = data.q ? fold(data.q) : "";

  const all: HouseholdListItem[] = rows.map((h) => {
    const r = responseBy.get(h.id);
    return {
      id: h.id,
      name: h.name,
      leadName: h.leadName,
      leadEmail: manager ? h.leadEmail : null,
      contactsHidden: !manager,
      language: h.language,
      expectedPartySize: h.expectedPartySize,
      adults: byHousehold.get(h.id) ?? [],
      status: r ? r.attending : "pending",
      adultsCount: r ? r.adultsCount : null,
      childrenCount: r ? r.childrenCount : null,
      answeredAt: r?.answeredAt ?? null,
      invitation: invMeta.get(h.id) ?? null,
    };
  });
  const items = all.filter(
    (h) =>
      (data.status === "all" || h.status === data.status) &&
      (!q || fold([h.name, h.leadName ?? "", ...h.adults].join(" ")).includes(q)),
  );
  return { items, total: all.length, canManage: manager };
}

export type HouseholdDetail = HouseholdListItem & {
  occasionId: string;
  notes: string | null;
  guests: Array<{ id: string; fullName: string }>;
  answers: Array<{ question: GuestQuestion; optionId: string | null; valueText: string | null }>;
  /** places this household holds in the shared capacity */
  placesHeld: number;
  canManage: boolean;
};

export async function getHousehold(ctx: Ctx, householdId: string): Promise<HouseholdDetail> {
  const h = await loadHousehold(ctx, householdId).catch(() => null);
  if (!h) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, h.occasionId, { roles: [...READ_ROLES] });
  const manager = isManager(member);
  const [guestRows, responseRows, answerRows, questionRows, invMeta, placesHeld] = await Promise.all([
    ctx.db.select().from(guests).where(eq(guests.householdId, h.id)).orderBy(asc(guests.createdAt)),
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.id)),
    ctx.db.select().from(rsvpAnswers).where(eq(rsvpAnswers.householdId, h.id)),
    ctx.db
      .select()
      .from(rsvpQuestions)
      .where(eq(rsvpQuestions.occasionId, h.occasionId))
      .orderBy(asc(rsvpQuestions.position), asc(rsvpQuestions.createdAt)),
    listInvitationMeta(ctx, h.occasionId),
    getClaim(ctx, h.occasionId, HOUSEHOLD_RSVP_CLAIM(h.id)),
  ]);
  const r = responseRows[0];
  const answerBy = new Map(answerRows.map((a) => [a.questionId, a]));
  return {
    id: h.id,
    occasionId: h.occasionId,
    name: h.name,
    leadName: h.leadName,
    leadEmail: manager ? h.leadEmail : null,
    contactsHidden: !manager,
    language: h.language,
    expectedPartySize: h.expectedPartySize,
    notes: manager ? h.notes : null,
    adults: guestRows.map((g) => g.fullName),
    guests: guestRows.map((g) => ({ id: g.id, fullName: g.fullName })),
    status: r ? r.attending : "pending",
    adultsCount: r ? r.adultsCount : null,
    childrenCount: r ? r.childrenCount : null,
    answeredAt: r?.answeredAt ?? null,
    invitation: invMeta.get(h.id) ?? null,
    answers: questionRows
      .filter((q) => answerBy.has(q.id))
      .map((q) => ({
        question: toGuestQuestion(q),
        optionId: answerBy.get(q.id)!.optionId,
        valueText: answerBy.get(q.id)!.valueText,
      })),
    placesHeld,
    canManage: manager,
  };
}

/* ── Removing a household: a What-if preview (principle 3) ───────────────── */

type RemoveInput = { householdId: string };

registerWhatIf<RemoveInput>("guests.removeHousehold", {
  input: z.object({ householdId: idSchema }),
  authorize: async (ctx, subject) => {
    if (!subject.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    await requireMember(ctx, subject.occasionId, { manage: true });
  },
  compute: async (ctx, input, subject) => {
    const h = await loadHousehold(ctx, input.householdId);
    if (h.occasionId !== subject.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [adults, held, claims] = await Promise.all([
      ctx.db.select({ id: guests.id }).from(guests).where(eq(guests.householdId, h.id)),
      getClaim(ctx, h.occasionId, HOUSEHOLD_RSVP_CLAIM(h.id)),
      ctx.db
        .select({ title: contributionNeeds.title, units: contributionClaims.units })
        .from(contributionClaims)
        .innerJoin(contributionNeeds, eq(contributionNeeds.id, contributionClaims.needId))
        .where(eq(contributionClaims.householdId, h.id)),
    ]);
    return {
      title: { key: "guests.whatif.removeTitle", params: { name: h.name } },
      delta: [
        {
          key: "household",
          what: h.name,
          kindLabelKey: "guests.whatif.kindRemoved",
          before: { key: "guests.whatif.adults", params: { count: adults.length } },
          after: { key: "guests.whatif.removed" },
        },
        { key: "link", what: { key: "guests.whatif.link" }, after: { key: "guests.whatif.linkStops" } },
        ...(held > 0
          ? [
              {
                key: "places",
                what: { key: "guests.whatif.places" },
                before: { key: "guests.whatif.placesHeld", params: { count: held } },
                after: { key: "guests.whatif.placesFreed" },
              },
            ]
          : []),
        ...claims.map((c, i) => ({
          key: `claim-${i}`,
          what: c.title,
          before: { key: "guests.whatif.unitsClaimed", params: { count: c.units } },
          after: { key: "guests.whatif.unitsFreed" },
        })),
      ],
    };
  },
  apply: async (tx, preview) => {
    const [h] = await tx.db.select().from(households).where(eq(households.id, preview.input.householdId));
    if (!h) return; // already gone: nothing left to apply
    await releasePlaces(tx, h.occasionId, { key: HOUSEHOLD_RSVP_CLAIM(h.id) });
    // give claimed contribution units back before the cascade removes the claim rows
    const claims = await tx.db.select().from(contributionClaims).where(eq(contributionClaims.householdId, h.id));
    for (const c of claims) {
      await tx.db
        .update(contributionNeeds)
        .set({ unitsClaimed: sql`GREATEST(0, ${contributionNeeds.unitsClaimed} - ${c.units})` })
        .where(eq(contributionNeeds.id, c.needId));
    }
    await tx.db.delete(households).where(eq(households.id, h.id));
    await audit(tx, {
      action: "household.removed",
      objectType: "household",
      objectId: h.id,
      before: { name: h.name },
    });
  },
});

/* ── CSV export (managers only: it contains contacts, D2) ────────────────── */

function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  // spreadsheet formula injection: a cell must not start with = + - @ (or tab/CR)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type GuestCsvLabels = {
  household: string;
  lead: string;
  email: string;
  language: string;
  adults: string;
  status: string;
  adultsCount: string;
  childrenCount: string;
  answeredAt: string;
  statuses: Record<HouseholdStatus, string>;
};

/**
 * The guest list as CSV (UTF-8 with BOM, `;` separated — opens correctly in Excel in ro).
 * Own occasion only; children appear only as a count. Headings come from the caller (i18n).
 */
export async function exportGuestsCsv(
  ctx: Ctx,
  input: { occasionId: string; labels: GuestCsvLabels; formatDate: (d: Date) => string },
): Promise<string> {
  const member: Member = await requireMember(ctx, input.occasionId, { manage: true });
  void member;
  const { items } = await listHouseholds(ctx, { occasionId: input.occasionId });
  const questions = (
    await ctx.db
      .select()
      .from(rsvpQuestions)
      .where(eq(rsvpQuestions.occasionId, input.occasionId))
      .orderBy(asc(rsvpQuestions.position), asc(rsvpQuestions.createdAt))
  ).map(toGuestQuestion);
  const answers = items.length
    ? await ctx.db
        .select()
        .from(rsvpAnswers)
        .where(
          inArray(
            rsvpAnswers.householdId,
            items.map((i) => i.id),
          ),
        )
    : [];
  const answerBy = new Map(answers.map((a) => [`${a.householdId}:${a.questionId}`, a]));
  const L = input.labels;
  const lang = ctx.locale;
  const head = [
    L.household,
    L.lead,
    L.email,
    L.language,
    L.adults,
    L.status,
    L.adultsCount,
    L.childrenCount,
    L.answeredAt,
    ...questions.map((q) => q.text[lang]),
  ];
  const lines = [head.map(csvCell).join(";")];
  for (const h of items) {
    lines.push(
      [
        h.name,
        h.leadName,
        h.leadEmail,
        h.language,
        h.adults.join(", "),
        L.statuses[h.status],
        h.adultsCount,
        h.childrenCount,
        h.answeredAt ? input.formatDate(h.answeredAt) : "",
        ...questions.map((q) => {
          const a = answerBy.get(`${h.id}:${q.id}`);
          if (!a) return "";
          if (a.optionId) return q.options.find((o) => o.id === a.optionId)?.[lang] ?? "";
          return a.valueText ?? "";
        }),
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  await audit(ctx, { action: "guests.exported", objectType: "occasion", objectId: input.occasionId });
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
