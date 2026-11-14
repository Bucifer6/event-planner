import { and, capacityClaims, emailOutbox, eq, publicRegistrations, sql } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { runOnce } from "@ed/jobs";
import { hashToken } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimPlaces, readCapacity, releasePlaces, setCapacityTotal } from "../src/capacity";
import { anonymousCtx, systemCtx, type Ctx } from "../src/context";
import { runExport } from "../src/exports";
import { getGuestEventPageUrl, navigationHref } from "../src/guestevent";
import { lifecycleImpactProviders } from "../src/lifecycle";
import { saveMenu, saveMenuItem } from "../src/menus";
import { saveProgrammeItem } from "../src/programme";
import { getPublicEvent, getPublicPageSettings, publicQuestionField, removePublicQuestion, savePublicPage, savePublicQuestion, slugify, validateAnswers, type PublicQuestion } from "../src/publicpage";
import { issueFormStamp } from "../src/ratelimit";
import {
  cancelOwnRegistration,
  cancelRegistration,
  getOwnRegistration,
  listRegistrations,
  notifyRegistrantsOfChange,
  PROMOTED_EMAIL_JOB,
  promoteRegistration,
  promoteWaitlist,
  registerForEvent,
  sweepWaitlists,
  type RegisterInput,
} from "../src/registrations";
import { as, code, HELPER, newOccasion, NOW, OUTSIDER, OWNER, PM, seedAccounts } from "./_releasec";

let t: TestDb;
let n = 0;
beforeAll(async () => {
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  await t.close();
});

const sys = (now: Date = NOW) => systemCtx(t.db, { now });
/** A fresh visitor: own IP, so per-IP limits of one test never touch another. */
const visitor = (now: Date = NOW): Ctx => anonymousCtx(t.db, { now, ip: `198.51.100.${(++n % 250) + 1}` });
const stamp = (now: Date = NOW) => issueFormStamp(new Date(now.getTime() - 20_000));

async function page(occ: string, over: Partial<Parameters<typeof savePublicPage>[1]> = {}) {
  const slug = `nunta-${occ.replace(/_/g, "-")}`;
  await savePublicPage(as(t, OWNER), {
    occasionId: occ,
    slug,
    titleRo: "Nunta Ioanei și a lui Andrei",
    titleEn: "Ioana & Andrei's wedding",
    descriptionRo: "Vă așteptăm cu drag.",
    showDate: true,
    showVenue: true,
    showProgramme: true,
    showMenu: true,
    registrationEnabled: true,
    sharesCapacity: true,
    published: true,
    ...over,
  });
  return slug;
}

function reg(slug: string, who: string, over: Partial<RegisterInput> = {}): RegisterInput {
  return { slug, name: who, email: `${who.toLowerCase().replace(/\s+/g, ".")}@example.test`, adults: 1, children: 0, consent: true, language: "ro", idempotencyKey: `key-${who.replace(/\W+/g, "")}-${++n}`, honeypot: "", renderedAt: stamp(), answers: {}, ...over };
}

const mails = (occ: string, template: string) => t.db.select().from(emailOutbox).where(and(eq(emailOutbox.occasionId, occ), eq(emailOutbox.template, template)));

describe("public page settings (C-06)", () => {
  it("validates and reserves the slug; managers write; unpublished and closed pages are the same not-found", async () => {
    expect(slugify("Nunta Ioanei & a lui Andrei — 2027")).toBe("nunta-ioanei-a-lui-andrei-2027");
    const occ = await newOccasion(t);
    expect(await code(() => savePublicPage(as(t, HELPER), { occasionId: occ, slug: "abc-def", titleRo: "X" } as never))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => savePublicPage(as(t, OWNER), { occasionId: occ, slug: "Are Spații", titleRo: "X" } as never))).toMatch(/^THROWN/);
    const slug = await page(occ, { published: false });
    expect(await getPublicEvent(visitor(), slug)).toBeNull(); // unpublished
    expect(await getPublicEvent(visitor(), "nu-exista-deloc")).toBeNull(); // unknown
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Ana")))).toBe("NOT_FOUND:publicpage.errors.closed");
    // another occasion cannot take the same address
    const other = await newOccasion(t);
    expect(await code(() => savePublicPage(as(t, OWNER), { occasionId: other, slug, titleRo: "Alt eveniment" } as never))).toBe("TAKEN:publicpage.errors.slugTaken");
    await page(occ);
    const ev = await getPublicEvent(visitor(), slug);
    expect(ev!.title).toEqual({ ro: "Nunta Ioanei și a lui Andrei", en: "Ioana & Andrei's wedding" });
    expect(ev!.venue!.navigationHref).toBe(navigationHref("Str. Polizu 4, Iași", "Conacul Polizu"));
    expect(ev!.venue!.navigationHref).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(await getGuestEventPageUrl(as(t, HELPER), occ)).toMatch(new RegExp(`/e/${slug}$`));
    expect((await getPublicPageSettings(as(t, HELPER), occ)).canManage).toBe(false);
    expect(await code(() => getPublicPageSettings(as(t, OUTSIDER), occ))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    // a closed occasion's page disappears exactly like an unpublished one
    const closed = await newOccasion(t);
    const closedSlug = await page(closed);
    await t.db.execute(sql`update occasions set status = 'closed', closed_at = now() where id = ${closed}`);
    expect(await getPublicEvent(visitor(), closedSlug)).toBeNull();
  });

  it("shows only what was switched on — and of the programme only moments for everyone", async () => {
    const occ = await newOccasion(t);
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia", time: "16:00", visibleToGuests: true });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Probă de sunet", time: "14:00" });
    const { menuId } = await saveMenu(as(t, OWNER), { occasionId: occ, name: "Cina" });
    await saveMenuItem(as(t, OWNER), { menuId, course: "main", name: "Sarmale" });
    const slug = await page(occ);
    const full = (await getPublicEvent(visitor(), slug))!;
    expect(full.programme!.map((i) => i.title)).toEqual(["Cununia"]);
    expect(full.menus![0]!.items[0]!.name).toBe("Sarmale");
    await page(occ, { showProgramme: false, showMenu: false, showVenue: false, showDate: false });
    const bare = (await getPublicEvent(visitor(), slug))!;
    expect([bare.programme, bare.menus, bare.venue, bare.startsAt]).toEqual([null, null, null, null]);
    // nothing about who registered is ever in the public view
    expect(JSON.stringify(bare)).not.toMatch(/email|@example/);
  });
});

describe("conditional questions", () => {
  it("one level only, validated on the server: hidden questions are never required and their answers are dropped", async () => {
    const occ = await newOccasion(t);
    const slug = await page(occ);
    const a = await savePublicQuestion(as(t, OWNER), { occasionId: occ, kind: "choice", ro: "Vii cu mașina?", en: "Coming by car?", options: "Da | Yes\nNu | No", required: true });
    const settings = await getPublicPageSettings(as(t, OWNER), occ);
    const qa = settings.page!.questions.find((q) => q.id === a.questionId)!;
    const yes = qa.options[0]!.id;
    const no = qa.options[1]!.id;
    const b = await savePublicQuestion(as(t, OWNER), { occasionId: occ, kind: "text", ro: "Numărul mașinii", required: true, showIf: `${a.questionId}:${yes}` });
    // a condition cannot chain, and cannot point at a missing option
    expect(await code(() => savePublicQuestion(as(t, OWNER), { occasionId: occ, kind: "text", ro: "A treia", showIf: `${b.questionId}:${yes}` }))).toBe("VALIDATION:publicpage.errors.condition");
    expect(await code(() => savePublicQuestion(as(t, OWNER), { occasionId: occ, kind: "text", ro: "A treia", showIf: `${a.questionId}:nope` }))).toBe("VALIDATION:publicpage.errors.condition");
    expect(await code(() => savePublicQuestion(as(t, OWNER), { occasionId: occ, questionId: a.questionId, kind: "choice", ro: "Vii cu mașina?", options: "Da\nNu", showIf: `${a.questionId}:${yes}` }))).toBe("VALIDATION:publicpage.errors.condition");
    expect(await code(() => savePublicQuestion(as(t, OWNER), { occasionId: occ, kind: "choice", ro: "O singură variantă", options: "Da" }))).toBe("VALIDATION:publicpage.errors.twoOptions");

    const questions: PublicQuestion[] = (await getPublicPageSettings(as(t, OWNER), occ)).page!.questions;
    const fa = publicQuestionField(a.questionId);
    const fb = publicQuestionField(b.questionId);
    // A = no → B is hidden: not required, and a posted value is dropped
    expect(validateAnswers(questions, { [fa]: no, [fb]: "IS 01 ABC" })).toEqual({ [a.questionId]: { optionId: no, text: null } });
    // A = yes → B is shown and required
    expect(() => validateAnswers(questions, { [fa]: yes })).toThrowError();
    expect(validateAnswers(questions, { [fa]: yes, [fb]: "IS 01 ABC" })[b.questionId]).toEqual({ optionId: null, text: "IS 01 ABC" });
    expect(() => validateAnswers(questions, {})).toThrowError(); // A itself is required
    expect(() => validateAnswers(questions, { [fa]: "not-an-option" })).toThrowError();

    // end to end through the registration
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Fara Raspuns")))).toBe("VALIDATION:common.errors.VALIDATION");
    const ok = await registerForEvent(visitor(), reg(slug, "Cu Masina", { answers: { [fa]: no, [fb]: "ar trebui ignorat" } }));
    const [row] = await t.db.select().from(publicRegistrations).where(eq(publicRegistrations.id, ok.registrationId));
    expect(Object.keys(row!.answers)).toEqual([a.questionId]);
    // removing the parent frees the child from its condition (never a dangling rule)
    await removePublicQuestion(as(t, OWNER), { occasionId: occ, questionId: a.questionId });
    expect((await getPublicPageSettings(as(t, OWNER), occ)).page!.questions).toEqual([expect.objectContaining({ id: b.questionId, showIf: null })]);
  });
});

describe("registration, shared capacity and the waiting list (A8, Q4)", () => {
  it("two parallel registrations for the last place: exactly one registered, the other waitlisted", async () => {
    const occ = await newOccasion(t);
    await setCapacityTotal(as(t, OWNER), { occasionId: occ, total: 10 });
    await claimPlaces(sys(), occ, { key: "rsvp:household-x", places: 9 }); // invited guests hold nine — ONE shared count
    const slug = await page(occ);
    const results = await Promise.all([registerForEvent(visitor(), reg(slug, "Ana Unu")), registerForEvent(visitor(), reg(slug, "Dan Doi"))]);
    expect(results.map((r) => r.status).sort()).toEqual(["registered", "waitlisted"]);
    expect(results.find((r) => r.status === "waitlisted")!.position).toBe(1);
    expect(results.find((r) => r.status === "registered")!.position).toBeNull();
    const cap = await readCapacity(sys(), occ);
    expect([cap.taken, cap.left]).toEqual([10, 0]);
    const claims = await t.db.select().from(capacityClaims).where(eq(capacityClaims.occasionId, occ));
    expect(claims.filter((c) => c.claimKey.startsWith("public:"))).toHaveLength(1);
    expect((await getPublicEvent(visitor(), slug))!.registration.full).toBe(true);
    // a third joins the line behind
    const third = await registerForEvent(visitor(), reg(slug, "Ema Trei"));
    expect([third.status, third.position]).toEqual(["waitlisted", 2]);
  });

  it("rejects a duplicate email kindly, replays the same submit, and never stores the manage token", async () => {
    const occ = await newOccasion(t);
    const slug = await page(occ);
    const input = reg(slug, "Ana Popescu", { adults: 2, children: 1, email: "  Ana.Popescu@Example.test " });
    const first = await registerForEvent(visitor(), input);
    expect(first).toMatchObject({ status: "registered", replayed: false });
    expect(first.managePath).toMatch(new RegExp(`^/e/${slug}/r/[A-Za-z0-9_-]{40,}$`));
    const token = first.managePath!.split("/").pop()!;
    // double submit of the same form: same registration, no second place, no token again
    const replay = await registerForEvent(visitor(), { ...input, renderedAt: stamp() });
    expect(replay).toMatchObject({ registrationId: first.registrationId, replayed: true, managePath: null });
    // a new form with the same email
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Ana Popescu", { email: "ana.popescu@example.test" })))).toBe("CONFLICT:publicpage.errors.alreadyRegistered");
    expect((await readCapacity(sys(), occ)).taken).toBe(3);
    const [row] = await t.db.select().from(publicRegistrations).where(eq(publicRegistrations.id, first.registrationId));
    expect(row!.manageTokenHash).toBe(hashToken(token));
    const dump = await t.db.execute(sql`SELECT row_to_json(r)::text AS j FROM public_registrations r WHERE id = ${first.registrationId}`);
    expect(String(dump.rows[0]!.j)).not.toContain(token);
    // the only child datum is a number
    expect(row!.children).toBe(1);
    expect(await mails(occ, "publicpage.registered")).toHaveLength(1);
    // the manage link shows this registration; a wrong token is the same "nothing"
    const own = await getOwnRegistration(visitor(), { slug, token });
    expect(own).toMatchObject({ name: "Ana Popescu", adults: 2, children: 1, status: "registered", canCancel: true });
    expect(await getOwnRegistration(visitor(), { slug, token: `${token.slice(0, -2)}xx` })).toBeNull();
    expect(await getOwnRegistration(visitor(), { slug: "alt-slug-oarecare", token })).toBeNull();
    // cancelled → the same email may register again
    await cancelOwnRegistration(visitor(), { slug, token });
    expect((await cancelOwnRegistration(visitor(), { slug, token })).cancelled).toBe(false);
    expect((await readCapacity(sys(), occ)).taken).toBe(0);
    expect((await registerForEvent(visitor(), reg(slug, "Ana Popescu", { email: "ana.popescu@example.test" }))).status).toBe("registered");
  });

  it("promotes atomically when places free up: oldest party that fits, once, with a single email", async () => {
    const occ = await newOccasion(t);
    await setCapacityTotal(as(t, OWNER), { occasionId: occ, total: 4 });
    const slug = await page(occ);
    const holder = await registerForEvent(visitor(), reg(slug, "Primul Venit", { adults: 2, children: 2 }));
    const big = await registerForEvent(visitor(), reg(slug, "Grup Mare", { adults: 3 }));
    const small = await registerForEvent(visitor(), reg(slug, "Grup Mic", { adults: 1 }));
    const mid = await registerForEvent(visitor(), reg(slug, "Grup Mediu", { adults: 2 }));
    expect([holder.status, big.status, small.status, mid.status]).toEqual(["registered", "waitlisted", "waitlisted", "waitlisted"]);
    expect([big.position, small.position, mid.position]).toEqual([1, 2, 3]);

    // the holder cancels: 4 places free → Grup Mare (3) enters, then Grup Mic (1); Grup Mediu still waits
    const token = holder.managePath!.split("/").pop()!;
    await cancelOwnRegistration(visitor(), { slug, token });
    const view = await listRegistrations(as(t, OWNER), occ);
    expect(view.registered.map((r) => r.name).sort()).toEqual(["Grup Mare", "Grup Mic"]);
    expect(view.waitlisted.map((r) => [r.name, r.position])).toEqual([["Grup Mediu", 1]]);
    expect((await readCapacity(sys(), occ)).taken).toBe(4);
    // running promotion again (any number of times, in parallel) changes nothing
    const again = await Promise.all([promoteWaitlist(sys(), occ), promoteWaitlist(sys(), occ), sweepWaitlists(sys())]);
    expect(again[0].promoted.length + again[1].promoted.length + again[2].promoted).toBe(0);
    // one email per promoted registration, however often the job runs
    await runOnce(sys(), { names: [PROMOTED_EMAIL_JOB] });
    await runOnce(sys(), { names: [PROMOTED_EMAIL_JOB] });
    const promotedMails = await mails(occ, "publicpage.promoted");
    expect(promotedMails.map((m) => m.toEmail).sort()).toEqual(["grup.mare@example.test", "grup.mic@example.test"]);

    // a capacity increase or an invited household giving places back: promoteWaitlist is the hook
    await setCapacityTotal(as(t, OWNER), { occasionId: occ, total: 6 });
    expect((await promoteWaitlist(sys(), occ)).promoted).toHaveLength(1);
    await runOnce(sys(), { names: [PROMOTED_EMAIL_JOB] });
    expect(await mails(occ, "publicpage.promoted")).toHaveLength(3);
    expect((await listRegistrations(as(t, OWNER), occ)).waitlisted).toHaveLength(0);
  });

  it("a newcomer does not jump the line; managers cancel and promote by hand; export is for managers", async () => {
    const occ = await newOccasion(t);
    await setCapacityTotal(as(t, OWNER), { occasionId: occ, total: 2 });
    await claimPlaces(sys(), occ, { key: "rsvp:hh", places: 2 });
    const slug = await page(occ);
    const waiting = await registerForEvent(visitor(), reg(slug, "Asteapta Demult", { adults: 2 }));
    expect(waiting.status).toBe("waitlisted");
    // an invited household gives its places back (outside this module) and nobody ran promotion yet
    await releasePlaces(sys(), occ, { key: "rsvp:hh" });
    const newcomer = await registerForEvent(visitor(), reg(slug, "Nou Venit", { adults: 1 }));
    const view = await listRegistrations(as(t, PM), occ);
    expect(view.registered.map((r) => r.name)).toEqual(["Asteapta Demult"]); // the line came first
    expect([newcomer.status, newcomer.position]).toEqual(["waitlisted", 1]);
    // manual promotion still needs the places
    expect(await code(() => promoteRegistration(as(t, PM), { registrationId: newcomer.registrationId }))).toBe("TAKEN:publicpage.errors.noPlaces");
    expect(await code(() => promoteRegistration(as(t, HELPER), { registrationId: newcomer.registrationId }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => listRegistrations(as(t, HELPER), occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    // the planner cancels the first: its places go to the line at once
    const res = await cancelRegistration(as(t, PM), { registrationId: waiting.registrationId });
    expect(res).toEqual({ cancelled: true, promoted: 1 });
    const csv = await runExport(as(t, OWNER), occ, "registrations-csv");
    expect(csv.content).toContain("nou.venit@example.test");
    expect(csv.content).not.toContain("asteapta.demult@example.test"); // cancelled rows are not exported
    expect(await code(() => runExport(as(t, HELPER), occ, "registrations-csv"))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
  });

  it("without capacity sharing everyone is registered; the window opens and closes", async () => {
    const occ = await newOccasion(t);
    await setCapacityTotal(as(t, OWNER), { occasionId: occ, total: 1 });
    await claimPlaces(sys(), occ, { key: "rsvp:hh", places: 1 });
    const slug = await page(occ, { sharesCapacity: false, opensOn: "2027-03-10", closesOn: "2027-03-20" });
    expect((await getPublicEvent(visitor(), slug))!.registration.window).toBe("notYet");
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Prea Devreme")))).toBe("NOT_FOUND:publicpage.errors.closed");
    const during = new Date("2027-03-20T20:00:00Z"); // still the 20th in Bucharest
    const r = await registerForEvent(visitor(during), reg(slug, "La Timp", { renderedAt: stamp(during) }));
    expect(r.status).toBe("registered");
    expect((await readCapacity(sys(), occ)).taken).toBe(1); // no place taken from the shared count
    const after = new Date("2027-03-20T22:30:00Z"); // the 21st, 00:30 in Bucharest
    expect((await getPublicEvent(visitor(after), slug))!.registration.window).toBe("closed");
    expect(await code(() => registerForEvent(visitor(after), reg(slug, "Prea Tarziu", { renderedAt: stamp(after) })))).toBe("NOT_FOUND:publicpage.errors.closed");
  });
});

describe("bot guard (SEC11)", () => {
  it("rejects a filled honeypot, a too-fast submit, a forged stamp, a missing consent and a hammering IP — with a retry time", async () => {
    const occ = await newOccasion(t);
    const slug = await page(occ);
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Bot Unu", { honeypot: "http://spam.example" })))).toBe("RATE_LIMITED:common.errors.RATE_LIMITED");
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Bot Doi", { renderedAt: issueFormStamp(new Date(NOW.getTime() - 500)) })))).toBe("RATE_LIMITED:common.errors.RATE_LIMITED");
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Bot Trei", { renderedAt: `${NOW.getTime() - 60_000}.forged` })))).toBe("RATE_LIMITED:common.errors.RATE_LIMITED");
    expect(await code(() => registerForEvent(visitor(), reg(slug, "Fara Acord", { consent: false })))).toBe("VALIDATION:publicpage.errors.consent");
    expect(await t.db.select().from(publicRegistrations).where(eq(publicRegistrations.occasionId, occ))).toHaveLength(0);
    // per-IP limit: the same address keeps trying
    const ip = "203.0.113.77";
    const same = () => anonymousCtx(t.db, { now: NOW, ip });
    let limited = 0;
    let retryAt: unknown = null;
    for (let i = 0; i < 24; i++) {
      try {
        await registerForEvent(same(), reg(slug, `Om ${i}`));
      } catch (e) {
        limited++;
        retryAt = (e as { details?: { retryAt?: string } }).details?.retryAt ?? retryAt;
      }
    }
    expect(limited).toBe(4); // 20 per hour pass
    expect(typeof retryAt).toBe("string");
  });
});

describe("lifecycle (cancel / postpone) and purge", () => {
  it("lists registrations in the preview (counts only) and tells each registrant once", async () => {
    const occ = await newOccasion(t);
    const slug = await page(occ);
    await registerForEvent(visitor(), reg(slug, "Ana Unu"));
    await registerForEvent(visitor(), reg(slug, "Dan Doi"));
    const provider = lifecycleImpactProviders().find((p) => p.key === "publicpage.registrations")!;
    const rows = await provider.collect(as(t, OWNER), occ, { kind: "cancel" });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Ana|Dan|@example/);
    expect(await provider.collect(as(t, OWNER), occ, { kind: "close" })).toEqual([]);
    const first = await notifyRegistrantsOfChange(sys(), { occasionId: occ, change: "cancelled", stamp: "s1" });
    const second = await notifyRegistrantsOfChange(sys(), { occasionId: occ, change: "cancelled", stamp: "s1" });
    expect([first.sent, second.sent]).toEqual([2, 0]);
    expect(await mails(occ, "publicpage.lifecycle")).toHaveLength(2);
  });
});
