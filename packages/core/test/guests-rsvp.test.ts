import {
  accounts,
  capacityClaims,
  eq,
  households,
  invitations,
  occasionCapacity,
  occasionMembers,
  occasions,
  rsvpAnswers,
  rsvpResponses,
  sql,
} from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";
import { zonedDateKey } from "@ed/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adjustPlaces, claimPlaces, readCapacity, releasePlaces, setCapacityTotal } from "../src/capacity";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { createHousehold, detectChildDetails, exportGuestsCsv, getHousehold, listHouseholds } from "../src/guests";
import {
  bumpGuestRevision,
  getGuestView,
  markGuestLinkViewed,
  regenerateInvitation,
  registerGuestSection,
  resolveGuestLink,
  revokeInvitation,
  setInvitationExpiry,
} from "../src/invitations";
import { addPollDates, castPollVotes, confirmPollDate, getPoll } from "../src/polls";
import { getRsvpSummary, questionField, saveRsvpQuestion, setRsvpDeadline, submitRsvp } from "../src/rsvp";
import { confirmPreview } from "../src/whatif";

let t: TestDb;
const OWNER = "acc_owner_a";
const HELPER = "acc_helper_a";
const OUTSIDER = "acc_outsider_a";
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner@example.test" },
    { id: HELPER, kind: "email", email: "helper@example.test" },
    { id: OUTSIDER, kind: "email", email: "outsider@example.test" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const owner = (now?: Date): Ctx => accountCtx(t.db, OWNER, { now });

async function newOccasion(opts: { startsAt?: Date | null; dateMode?: "date" | "poll" } = {}): Promise<string> {
  const id = `occ_a_${++seq}`;
  await t.db.insert(occasions).values({
    id,
    ownerAccountId: OWNER,
    title: "Nunta Ioanei și a lui Andrei",
    kind: "nunta",
    dateMode: opts.dateMode ?? "date",
    startsAt: opts.startsAt === undefined ? new Date("2027-06-12T14:00:00Z") : opts.startsAt,
    venueName: "Conacul Polizu",
  });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

async function guestCtx(token: string, now?: Date): Promise<Ctx> {
  const link = await resolveGuestLink(anonymousCtx(t.db, { now }), token);
  if (!link) throw new Error("link did not resolve");
  return makeCtx(t.db, link.actor, { now });
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e)}`;
  }
}

describe("schema — children are never persons (invariant 9)", () => {
  it("no table has a child-identifying column; the only child datum is the count", async () => {
    const cols = await t.db.execute<{ table_name: string; column_name: string; data_type: string }>(
      sql`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    // words that would identify or describe a child, matched on whole snake_case segments
    const suspicious = /(^|_)(child|children|childs|copil|copii|kid|kids|age|ages|varsta|birth|birthday|birthdate|nastere|nasterii|dob|born)(_|$)/i;
    const hits = cols.rows.filter((c) => suspicious.test(c.column_name)).map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`);
    // counts only: the RSVP count and the arrived count at check-in
    expect(hits.sort()).toEqual(["check_ins.children_arrived:integer", "rsvp_responses.children_count:integer"]);
    const guestCols = cols.rows.filter((c) => c.table_name === "guests").map((c) => c.column_name);
    expect(guestCols.sort()).toEqual(["created_at", "full_name", "household_id", "id", "occasion_id", "updated_at"]);
    // no table is about children at all
    const tables = [...new Set(cols.rows.map((c) => c.table_name))];
    expect(tables.filter((n) => /child|copil|copii|kid/i.test(n))).toEqual([]);
  });
});

describe("invitation links (SEC2, S6)", () => {
  it("token has at least 128 bits and only its SHA-256 is stored", async () => {
    const occ = await newOccasion();
    const a = await createHousehold(owner(), { occasionId: occ, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"] });
    const b = await createHousehold(owner(), { occasionId: occ, name: "Familia Ionescu" });
    expect(a.token).not.toBe(b.token);
    expect(Buffer.from(a.token, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(Buffer.from(a.token, "base64url").length).toBe(32);
    const [row] = await t.db.select().from(invitations).where(eq(invitations.id, a.invitationId));
    expect(row!.tokenHash).toBe(hashToken(a.token));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // the raw token is nowhere in the database
    const dump = await t.db.execute(sql`SELECT row_to_json(i)::text AS j FROM invitations i WHERE id = ${a.invitationId}`);
    expect(String(dump.rows[0]!.j)).not.toContain(a.token);
    const audit = await t.db.execute(sql`SELECT COALESCE(string_agg(row_to_json(a)::text, ''), '') AS j FROM audit_log a`);
    expect(String(audit.rows[0]!.j)).not.toContain(a.token);
  });

  it("unknown, malformed, revoked and deadline-expired links refuse identically", async () => {
    const occ = await newOccasion();
    const revoked = await createHousehold(owner(), { occasionId: occ, name: "Revocați" });
    const expiring = await createHousehold(owner(), { occasionId: occ, name: "Cu termen" });
    const open = await createHousehold(owner(), { occasionId: occ, name: "Fără termen" });
    const anon = anonymousCtx(t.db);
    expect(await resolveGuestLink(anon, revoked.token)).not.toBeNull();

    await revokeInvitation(owner(), { householdId: revoked.householdId });
    await setInvitationExpiry(owner(), { householdId: expiring.householdId, mode: "rsvp_deadline" });
    await setRsvpDeadline(owner(), { occasionId: occ, rsvpDeadline: new Date("2027-05-01T00:00:00Z") });

    const before = anonymousCtx(t.db, { now: new Date("2027-04-30T00:00:00Z") });
    const after = anonymousCtx(t.db, { now: new Date("2027-05-02T00:00:00Z") });
    expect(await resolveGuestLink(before, expiring.token)).not.toBeNull();

    const answers = [
      await resolveGuestLink(after, "x".repeat(43)), // unknown
      await resolveGuestLink(after, "short"), // malformed
      await resolveGuestLink(after, revoked.token), // revoked
      await resolveGuestLink(after, expiring.token), // expired at the RSVP deadline
    ];
    expect(answers).toEqual([null, null, null, null]);
    // a link without expiry still opens after the deadline (to read), but cannot answer
    const stillOpen = await resolveGuestLink(after, open.token);
    expect(stillOpen?.householdId).toBe(open.householdId);
    const late = makeCtx(t.db, stillOpen!.actor, { now: after.now });
    expect((await getGuestView(late)).rsvp.open).toBe(false);
    expect(await code(() => submitRsvp(late, { attending: "yes", adultsCount: 1, childrenCount: 0 }))).toBe(
      "CONFLICT:rsvp.errors.closed",
    );
  });

  it("regenerating replaces the token: the old link dies, the new one works", async () => {
    const occ = await newOccasion();
    const h = await createHousehold(owner(), { occasionId: occ, name: "Familia Stan" });
    const fresh = await regenerateInvitation(owner(), { householdId: h.householdId });
    expect(fresh.token).not.toBe(h.token);
    expect(await resolveGuestLink(anonymousCtx(t.db), h.token)).toBeNull();
    expect((await resolveGuestLink(anonymousCtx(t.db), fresh.token))?.householdId).toBe(h.householdId);
    // only managers may touch links; outsiders learn nothing
    expect(await code(() => regenerateInvitation(accountCtx(t.db, HELPER), { householdId: h.householdId }))).toMatch(/^FORBIDDEN/);
    expect(await code(() => regenerateInvitation(accountCtx(t.db, OUTSIDER), { householdId: h.householdId }))).toMatch(/^NOT_FOUND/);
  });

  it("guessing is rate limited per IP with a retry time", async () => {
    const ip = "203.0.113.77";
    let limited = "";
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await code(() => resolveGuestLink(anonymousCtx(t.db, { ip }), `guess-${i}-${"y".repeat(30)}`));
      if (r !== "OK") limited = r;
    }
    expect(limited).toBe("RATE_LIMITED:common.errors.RATE_LIMITED");
  });

  it("a link exposes only its own household (SEC2) and opens in the invitation language", async () => {
    const occ = await newOccasion();
    const a = await createHousehold(owner(), {
      occasionId: occ,
      name: "Familia Popescu",
      leadEmail: "ana@example.test",
      guestNames: ["Ana Popescu"],
    });
    const b = await createHousehold(owner(), {
      occasionId: occ,
      name: "The Smiths",
      language: "en",
      leadEmail: "secret-smith@example.test",
      guestNames: ["John Smith", "Jane Smith"],
      notes: "masa 4",
    });
    const linkB = await resolveGuestLink(anonymousCtx(t.db), b.token);
    expect(linkB?.language).toBe("en");
    expect((await resolveGuestLink(anonymousCtx(t.db), a.token))?.language).toBe("ro");

    const viewA = await getGuestView(await guestCtx(a.token));
    const json = JSON.stringify(viewA);
    expect(viewA.household.name).toBe("Familia Popescu");
    expect(viewA.household.adults).toEqual(["Ana Popescu"]);
    expect(json).not.toContain("Smith");
    expect(json).not.toContain("secret-smith");
    expect(json).not.toContain("masa 4");
    expect(json).not.toContain("ana@example.test"); // even the own address is not echoed
    expect(viewA.household.hasEmail).toBe(true);

    // a guest actor cannot read planner data, and nobody without a guest actor gets a view
    const gA = await guestCtx(a.token);
    expect(await code(() => listHouseholds(gA, { occasionId: occ }))).toMatch(/^NOT_FOUND/);
    expect(await code(() => getHousehold(gA, b.householdId))).toMatch(/^NOT_FOUND/);
    expect(await code(() => getRsvpSummary(gA, occ))).toMatch(/^NOT_FOUND/);
    expect(await code(() => getGuestView(anonymousCtx(t.db)))).toMatch(/^NOT_FOUND/);
    expect(await code(() => getGuestView(owner()))).toMatch(/^NOT_FOUND/);

    // contacts are for managers only (D2)
    const forHelper = await listHouseholds(accountCtx(t.db, HELPER), { occasionId: occ });
    expect(forHelper.items.every((h) => h.leadEmail === null && h.contactsHidden)).toBe(true);
    const forOwner = await listHouseholds(owner(), { occasionId: occ, q: "smith" });
    expect(forOwner.items.map((h) => h.leadEmail)).toEqual(["secret-smith@example.test"]);
    expect(await code(() => exportGuestsCsv(accountCtx(t.db, HELPER), { occasionId: occ, labels: {} as never, formatDate: String }))).toMatch(/^FORBIDDEN/);
  });

  it("marks 'changed since your last visit' after a planner-side change (INF5) and runs registered sections", async () => {
    const occ = await newOccasion();
    const h = await createHousehold(owner(), { occasionId: occ, name: "Familia Radu" });
    registerGuestSection({ key: "testSection", order: 5, load: async (_c, v) => ({ household: v.household.name }) });
    const g = await guestCtx(h.token);
    const first = await getGuestView(g);
    expect(first.changed).toBeNull(); // first visit: nothing to compare with
    expect(first.sections.find((s) => s.key === "testSection")?.data).toEqual({ household: "Familia Radu" });
    await markGuestLinkViewed(g);

    expect(await code(() => bumpGuestRevision(g, occ, "rsvp.changes.date"))).toMatch(/^FORBIDDEN/);
    await bumpGuestRevision(owner(), occ, "rsvp.changes.date");
    const second = await getGuestView(g);
    expect(second.changed?.reasonKey).toBe("rsvp.changes.date");
    await markGuestLinkViewed(g);
    expect((await getGuestView(g)).changed).toBeNull();
    registerGuestSection({ key: "testSection", order: 5, load: async () => null });
  });
});

describe("RSVP (A6)", () => {
  it("stores counts only, answers the custom questions and captures the lead email", async () => {
    const occ = await newOccasion();
    const menu = await saveRsvpQuestion(owner(), {
      occasionId: occ,
      kind: "menu_choice",
      textRo: "Ce meniu preferi?",
      textEn: "Which menu would you like?",
      optionsRo: "Clasic\nVegetarian",
      optionsEn: "Classic\nVegetarian",
      required: "on",
    });
    const allergies = await saveRsvpQuestion(owner(), { occasionId: occ, kind: "allergies", textRo: "Alergii?" });
    const transport = await saveRsvpQuestion(owner(), { occasionId: occ, kind: "transport", textRo: "Ai nevoie de transport?" });
    const h = await createHousehold(owner(), { occasionId: occ, name: "Familia Popescu" });
    const g = await guestCtx(h.token);
    const view = await getGuestView(g);
    expect(view.rsvp.questions.map((q) => [q.kind, q.answerType, q.options.length])).toEqual([
      ["menu_choice", "choice", 2],
      ["allergies", "text", 0],
      ["transport", "choice", 2],
    ]);
    const vegetarian = view.rsvp.questions[0]!.options[1]!.id;

    // required question missing → field error on that question, nothing saved
    expect(await code(() => submitRsvp(g, { attending: "yes", adultsCount: 2, childrenCount: 2 }))).toBe(
      "VALIDATION:common.errors.VALIDATION",
    );
    expect(await t.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.householdId))).toHaveLength(0);

    const res = await submitRsvp(g, {
      attending: "yes",
      adultsCount: 2,
      childrenCount: 2,
      answers: { [menu.questionId]: vegetarian, [allergies.questionId]: "fără gluten", [transport.questionId]: "yes" },
      email: "Ana@Example.test",
    });
    expect(res).toMatchObject({ attending: "yes", adultsCount: 2, childrenCount: 2, changed: true });

    const [row] = await t.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.householdId));
    expect(Object.keys(row!).sort()).toEqual(
      ["adultsCount", "answeredAt", "attending", "childrenCount", "householdId", "id", "occasionId", "updatedAt"].sort(),
    );
    expect(row!.childrenCount).toBe(2);
    const [hh] = await t.db.select().from(households).where(eq(households.id, h.householdId));
    expect(hh!.leadEmail).toBe("ana@example.test");
    expect(await t.db.select().from(rsvpAnswers).where(eq(rsvpAnswers.householdId, h.householdId))).toHaveLength(3);

    const summary = await getRsvpSummary(owner(), occ);
    expect(summary.households).toEqual({ total: 1, yes: 1, maybe: 0, no: 0, pending: 0 });
    expect(summary.attending).toEqual({ adults: 2, children: 2, total: 4 });

    // changing to "no" zeroes the counts and frees the places
    await submitRsvp(g, { attending: "no", adultsCount: 2, childrenCount: 2 });
    expect((await getRsvpSummary(owner(), occ)).attending.total).toBe(0);
    expect((await readCapacity(owner(), occ)).taken).toBe(0);
    const detail = await getHousehold(owner(), h.householdId);
    expect(detail.status).toBe("no");
    expect(detail.childrenCount).toBe(0);
  });

  it("warns before saving free text that looks like child details", async () => {
    expect(detectChildDetails("Fetița mea Ana are 5 ani și nu mănâncă pește")).toBe(true);
    expect(detectChildDetails("Matei, 7 ani")).toBe(true);
    expect(detectChildDetails("băiețelul nostru, născut pe 12.03.2021")).toBe(true);
    expect(detectChildDetails("our daughter Emma is 3 years old")).toBe(true);
    expect(detectChildDetails("copilul are 8 luni")).toBe(true);
    expect(detectChildDetails("bebe se numește Luca")).toBe(true);
    // counts and adult facts are fine
    expect(detectChildDetails("Venim cu 2 copii")).toBe(false);
    expect(detectChildDetails("Sunt alergic la arahide de 20 de ani")).toBe(false);
    expect(detectChildDetails("Fără gluten, vă rog")).toBe(false);
    expect(detectChildDetails("Ajungem la ora 17")).toBe(false);
    expect(detectChildDetails("")).toBe(false);

    const occ = await newOccasion();
    const q = await saveRsvpQuestion(owner(), { occasionId: occ, kind: "free_text", textRo: "Altceva de știut?" });
    const h = await createHousehold(owner(), { occasionId: occ, name: "Familia Dinu" });
    const g = await guestCtx(h.token);
    const input = {
      attending: "yes" as const,
      adultsCount: 2,
      childrenCount: 1,
      answers: { [q.questionId]: "Fetița mea Ana are 5 ani" },
    };
    let err: unknown;
    await submitRsvp(g, input).catch((e) => (err = e));
    expect(isAppError(err) && err.code).toBe("VALIDATION");
    expect(isAppError(err) && err.messageKey).toBe("rsvp.errors.childDetails");
    expect(isAppError(err) && err.details?.fieldErrors).toEqual({ [questionField(q.questionId)]: ["rsvp.errors.childDetails"] });
    // nothing was saved by the warned attempt
    expect(await t.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.householdId))).toHaveLength(0);
    expect((await readCapacity(owner(), occ)).taken).toBe(0);
    // the planner is warned the same way in household notes
    expect(await code(() => createHousehold(owner(), { occasionId: occ, name: "X", notes: "Matei, 7 ani" }))).toBe(
      "VALIDATION:rsvp.errors.childDetails",
    );
    // after removing the details it saves
    await submitRsvp(g, { ...input, answers: { [q.questionId]: "Venim cu un copil" } });
    const [a] = await t.db.select().from(rsvpAnswers).where(eq(rsvpAnswers.householdId, h.householdId));
    expect(a!.valueText).toBe("Venim cu un copil");
  });

  it("a double tap applies once (Q4)", async () => {
    const occ = await newOccasion();
    await setCapacityTotal(owner(), { occasionId: occ, total: 10 });
    const h = await createHousehold(owner(), { occasionId: occ, name: "Familia Marin" });
    const g = await guestCtx(h.token);
    const input = { attending: "yes" as const, adultsCount: 2, childrenCount: 1 };
    const results = await Promise.all([submitRsvp(g, input), submitRsvp(g, input), submitRsvp(g, input)]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await t.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.householdId))).toHaveLength(1);
    expect((await readCapacity(owner(), occ)).taken).toBe(3);
    expect(await t.db.select().from(capacityClaims).where(eq(capacityClaims.occasionId, occ))).toHaveLength(1);
    const again = await submitRsvp(g, input);
    expect(again.changed).toBe(false);
    expect((await readCapacity(owner(), occ)).taken).toBe(3);
    const answered = await t.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE object_id = ${h.householdId} AND action LIKE 'rsvp.%'`,
    );
    expect(answered.rows[0]!.n).toBe(1);
  });
});

describe("shared capacity (A8)", () => {
  it("parallel RSVPs for the last place: exactly one succeeds, the loser hears 'taken'", async () => {
    const occ = await newOccasion();
    await setCapacityTotal(owner(), { occasionId: occ, total: 5 });
    const first = await createHousehold(owner(), { occasionId: occ, name: "Primii" });
    await submitRsvp(await guestCtx(first.token), { attending: "yes", adultsCount: 2, childrenCount: 2 });
    expect((await readCapacity(owner(), occ)).left).toBe(1);

    const rivals = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createHousehold(owner(), { occasionId: occ, name: `Rival ${i}` })),
    );
    const ctxs = await Promise.all(rivals.map((r) => guestCtx(r.token)));
    const outcomes = await Promise.all(
      ctxs.map((g) => code(() => submitRsvp(g, { attending: "yes", adultsCount: 1, childrenCount: 0 }))),
    );
    expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "TAKEN:rsvp.errors.lastPlaceTaken")).toHaveLength(5);
    const cap = await readCapacity(owner(), occ);
    expect(cap).toMatchObject({ total: 5, taken: 5, left: 0 });
    // losers left no trace: one response per winner only
    const responses = await t.db.select().from(rsvpResponses).where(eq(rsvpResponses.occasionId, occ));
    expect(responses).toHaveLength(2);

    // the loser is told how many places are left
    const loser = ctxs[outcomes.findIndex((o) => o !== "OK")]!;
    let err: unknown;
    await submitRsvp(loser, { attending: "yes", adultsCount: 2, childrenCount: 0 }).catch((e) => (err = e));
    expect(isAppError(err) && err.details?.params).toEqual({ left: 0 });
    // "maybe" never needs a place
    expect((await submitRsvp(loser, { attending: "maybe", adultsCount: 2, childrenCount: 0 })).attending).toBe("maybe");
    expect((await readCapacity(owner(), occ)).taken).toBe(5);

    // withdrawing frees places for the next household
    await submitRsvp(await guestCtx(first.token), { attending: "yes", adultsCount: 1, childrenCount: 0 });
    expect((await readCapacity(owner(), occ)).left).toBe(3);
    await submitRsvp(loser, { attending: "yes", adultsCount: 2, childrenCount: 1 });
    expect((await readCapacity(owner(), occ)).left).toBe(0);
    // growing beyond what is free keeps the old claim
    expect(await code(() => submitRsvp(loser, { attending: "yes", adultsCount: 3, childrenCount: 1 }))).toBe(
      "TAKEN:rsvp.errors.lastPlaceTaken",
    );
    expect((await readCapacity(owner(), occ)).taken).toBe(5);
    // the total cannot be set below what is taken
    expect(await code(() => setCapacityTotal(owner(), { occasionId: occ, total: 4 }))).toBe(
      "VALIDATION:guests.errors.capacityBelowTaken",
    );
  });

  it("claim / adjust / release are idempotent per key and share one count (public registrations)", async () => {
    const occ = await newOccasion();
    await setCapacityTotal(owner(), { occasionId: occ, total: 3 });
    const sys = owner();
    const [a, b] = await Promise.all([
      claimPlaces(sys, occ, { key: "public:reg1", places: 2 }),
      claimPlaces(sys, occ, { key: "public:reg1", places: 2 }),
    ]);
    expect([a.changed, b.changed].filter(Boolean)).toHaveLength(1);
    expect((await readCapacity(sys, occ)).taken).toBe(2);
    const race = await Promise.all([
      code(() => claimPlaces(sys, occ, { key: "public:reg2", places: 1 })),
      code(() => claimPlaces(sys, occ, { key: "rsvp:someone", places: 1 })),
      code(() => claimPlaces(sys, occ, { key: "public:reg3", places: 1 })),
    ]);
    expect(race.filter((r) => r === "OK")).toHaveLength(1);
    expect((await readCapacity(sys, occ)).taken).toBe(3);
    await adjustPlaces(sys, occ, { key: "public:reg1", places: 1 });
    expect((await readCapacity(sys, occ)).taken).toBe(2);
    await releasePlaces(sys, occ, { key: "public:reg1" });
    await releasePlaces(sys, occ, { key: "public:reg1" });
    expect((await readCapacity(sys, occ)).taken).toBe(1);
    // unlimited when no total is set
    const free = await newOccasion();
    await claimPlaces(sys, free, { key: "k", places: 500 });
    expect(await readCapacity(sys, free)).toMatchObject({ total: null, taken: 500, left: null });
  });
});

describe("date polls (A7)", () => {
  it("households vote, the tally shows a leader, votes never touch capacity, the host confirms via What-if", async () => {
    const occ = await newOccasion({ startsAt: null, dateMode: "poll" });
    await setCapacityTotal(owner(), { occasionId: occ, total: 4 });
    const { pollId } = await addPollDates(owner(), { occasionId: occ, dates: "2027-06-12, 2027-06-19\n2027-06-26" });
    await addPollDates(owner(), { occasionId: occ, dates: ["2027-06-12"] }); // same day again: no duplicate
    const hs = await Promise.all(
      ["A", "B", "C"].map((n) => createHousehold(owner(), { occasionId: occ, name: `Familia ${n}` })),
    );
    const gs = await Promise.all(hs.map((h) => guestCtx(h.token)));
    const section = (await getGuestView(gs[0]!)).sections.find((s) => s.key === "polls")!.data as {
      pollId: string;
      options: Array<{ id: string; day: string; vote: string | null }>;
    };
    expect(section.options.map((o) => o.day)).toEqual(["2027-06-12", "2027-06-19", "2027-06-26"]);
    const [d1, d2, d3] = section.options.map((o) => o.id) as [string, string, string];

    const before = await t.db.select().from(occasionCapacity).where(eq(occasionCapacity.occasionId, occ));
    await castPollVotes(gs[0]!, { pollId, votes: { [d1]: "yes", [d2]: "yes", [d3]: "no" } });
    await castPollVotes(gs[1]!, { pollId, votes: { [d1]: "maybe", [d2]: "yes", [d3]: "no" } });
    await castPollVotes(gs[2]!, { pollId, votes: { [d1]: "no", [d2]: "yes" } });
    await castPollVotes(gs[2]!, { pollId, votes: { [d1]: "yes" } }); // re-vote replaces

    // capacity is exactly as before: no claim rows, nothing taken
    expect(await t.db.select().from(occasionCapacity).where(eq(occasionCapacity.occasionId, occ))).toEqual(before);
    expect(await t.db.select().from(capacityClaims).where(eq(capacityClaims.occasionId, occ))).toHaveLength(0);
    expect((await readCapacity(owner(), occ)).taken).toBe(0);

    const poll = (await getPoll(owner(), occ))!;
    expect(poll.options.map((o) => [o.yes, o.maybe, o.no])).toEqual([
      [2, 1, 0],
      [3, 0, 0],
      [0, 0, 2],
    ]);
    expect(poll.leaderOptionId).toBe(d2);
    expect(poll.householdsVoted).toBe(3);
    // a household sees only its own votes
    const own = (await getGuestView(gs[1]!)).sections.find((s) => s.key === "polls")!.data as typeof section;
    expect(own.options.map((o) => o.vote)).toEqual(["maybe", "yes", "no"]);
    expect(JSON.stringify(own)).not.toContain('"yes":');

    // guests cannot confirm; the host gets a preview and the date is set only on apply
    expect(await code(() => confirmPollDate(gs[0]!, { pollId, optionId: d2 }))).toMatch(/^NOT_FOUND/);
    const preview = await confirmPollDate(owner(), { pollId, optionId: d2 });
    expect(preview.kind).toBe("occasion.moveDate");
    let [o] = await t.db.select().from(occasions).where(eq(occasions.id, occ));
    expect(o!.startsAt).toBeNull();
    expect((await getPoll(owner(), occ))!.status).toBe("open");
    await confirmPreview(owner(), preview.id);
    [o] = await t.db.select().from(occasions).where(eq(occasions.id, occ));
    expect(zonedDateKey(o!.startsAt!, "Europe/Bucharest")).toBe("2027-06-19");
    expect((await getPoll(owner(), occ))!.status).toBe("confirmed");
    expect((await readCapacity(owner(), occ)).taken).toBe(0);
    // voting is over, and the poll leaves the guest page
    expect(await code(() => castPollVotes(gs[0]!, { pollId, votes: { [d1]: "yes" } }))).toBe("CONFLICT:polls.errors.closed");
    expect((await getGuestView(gs[0]!)).sections.find((s) => s.key === "polls")).toBeUndefined();
  });
});
