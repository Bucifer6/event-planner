import { and, emailOutbox, eq, jobs, occasionGuestSettings, programmeChanges, programmeCueVersions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { runOnce } from "@ed/jobs";
import { addMinutes } from "@ed/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acknowledgeBriefing, listBriefingVersions, publishBriefing } from "../src/briefings";
import { systemCtx } from "../src/context";
import { runExport } from "../src/exports";
import { getGuestView, markGuestLinkViewed } from "../src/invitations";
import {
  getGuestProgramme,
  includeProgrammeInBriefing,
  listCueVersions,
  listProgramme,
  listProgrammeForDay,
  notifyProgrammeChange,
  parseClock,
  PROGRAMME_NOTIFY_JOB,
  readPublicProgramme,
  removeProgrammeItem,
  saveCueList,
  saveProgrammeItem,
  setProgrammeVisibility,
} from "../src/programme";
import { submitRsvp } from "../src/rsvp";
import { createSupplier, createSupplierLink } from "../src/suppliers";
import { as, code, guestCtx, HELPER, household, newOccasion, NOW, OUTSIDER, OWNER, seedAccounts } from "./_releasec";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  await t.close();
});

const sys = (now: Date = NOW) => systemCtx(t.db, { now });
const mails = (occasionId: string) => t.db.select().from(emailOutbox).where(and(eq(emailOutbox.occasionId, occasionId), eq(emailOutbox.template, "programme.changed")));

describe("programme items (C-03)", () => {
  it("keeps wall time relative to the occasion day, orders by time, past midnight = next day", async () => {
    const occ = await newOccasion(t);
    expect(parseClock("18:30")).toBe(1110);
    expect(parseClock("25:00")).toBeNull();
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Tortul", time: "00:30", nextDay: true, kind: "moment", durationMin: "" });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia religioasă", time: "16:00", kind: "ceremony", durationMin: "60", place: "Biserica Sf. Nicolae" });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Primul dans", time: "20:15", kind: "dance", durationMin: 10 });
    const view = await listProgramme(as(t, HELPER), occ);
    expect(view.items.map((i) => i.title)).toEqual(["Cununia religioasă", "Primul dans", "Tortul"]);
    expect(view.canManage).toBe(false);
    // 16:00 on 12 June 2027 in Bucharest (UTC+3)
    expect(view.items[0]!.startsAt!.toISOString()).toBe("2027-06-12T13:00:00.000Z");
    expect(view.items[0]!.endsAt!.toISOString()).toBe("2027-06-12T14:00:00.000Z");
    expect(view.items[2]!.startsAt!.toISOString()).toBe("2027-06-12T21:30:00.000Z"); // 00:30 on the 13th
    expect(view.items[2]!.durationMin).toBeNull(); // unknown stays unknown
    expect((await listProgrammeForDay(as(t, OWNER), occ)).length).toBe(3);
  });

  it("is private by default and only managers write", async () => {
    const occ = await newOccasion(t);
    expect(await code(() => listProgramme(as(t, OUTSIDER), occ))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    expect(await code(() => saveProgrammeItem(as(t, HELPER), { occasionId: occ, title: "X", time: "10:00" }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "X", time: "30:99" }))).toMatch(/^THROWN|VALIDATION/);
    const closed = await newOccasion(t, { status: "closed", closedAt: NOW });
    expect(await code(() => saveProgrammeItem(as(t, OWNER), { occasionId: closed, title: "X", time: "10:00" }))).toBe("CONFLICT:lifecycle.errors.closed");
  });
});

describe("cue list — versioned (C-03)", () => {
  it("every save is a new version; old versions stay readable; an identical save changes nothing", async () => {
    const occ = await newOccasion(t);
    const { itemId } = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Primul dans", time: "20:15" });
    const v1 = await saveCueList(as(t, OWNER), { itemId, cues: [{ offsetMin: "2", instruction: "Lumini pe ring", who: "Tehnic" }, { offsetMin: 0, instruction: "Porniți melodia", who: "DJ" }] });
    expect(v1).toEqual({ version: 1, changed: true });
    const same = await saveCueList(as(t, OWNER), { itemId, cues: [{ offsetMin: 0, instruction: "Porniți melodia", who: "DJ" }, { offsetMin: 2, instruction: "Lumini pe ring", who: "Tehnic" }] });
    expect(same).toEqual({ version: 1, changed: false });
    const v2 = await saveCueList(as(t, OWNER), { itemId, cues: [{ offsetMin: 0, instruction: "Porniți melodia", who: "DJ" }] });
    expect(v2.version).toBe(2);
    const versions = await listCueVersions(as(t, HELPER), itemId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1]!.cues.map((c) => c.instruction)).toEqual(["Porniți melodia", "Lumini pe ring"]); // ordered by offset, untouched by v2
    expect((await listProgramme(as(t, OWNER), occ)).items[0]!.cues).toHaveLength(1);
    expect(await t.db.select().from(programmeCueVersions).where(eq(programmeCueVersions.itemId, itemId))).toHaveLength(2);
    expect(await code(() => saveCueList(as(t, HELPER), { itemId, cues: [] }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => saveCueList(as(t, OWNER), { itemId, cues: [{ offsetMin: 0, instruction: "  " }] }))).toBe("VALIDATION:programme.errors.cueInstruction");
  });
});

describe("performer briefing reuses the supplier briefing (B4)", () => {
  it("publishes the performer's moments and cues as the next briefing version, acknowledged on the supplier link", async () => {
    const occ = await newOccasion(t);
    const band = await createSupplier(as(t, OWNER), { occasionId: occ, name: "Formația Allegro" });
    const photo = await createSupplier(as(t, OWNER), { occasionId: occ, name: "Foto Lumina" });
    await publishBriefing(as(t, OWNER), { bookingId: band.bookingId, what: "Muzică live", freeText: "Parcare în spate." });
    const dance = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Primul dans", time: "20:15", durationMin: 10, place: "Ring", supplierId: band.supplierId });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Fotografii de grup", time: "17:30", supplierId: photo.supplierId });
    await saveCueList(as(t, OWNER), { itemId: dance.itemId, cues: [{ offsetMin: 0, instruction: "Porniți melodia", who: "DJ" }] });

    const res = await includeProgrammeInBriefing(as(t, OWNER), { occasionId: occ, supplierId: band.supplierId });
    expect(res).toMatchObject({ bookingId: band.bookingId, version: 2, moments: 1 });
    const [latest] = await listBriefingVersions(as(t, OWNER), band.bookingId);
    expect(latest!.content.what).toBe("Muzică live");
    expect(latest!.content.freeText).toContain("Parcare în spate.");
    expect(latest!.content.freeText).toContain("20:15 · Primul dans · Ring");
    expect(latest!.content.freeText).toContain("Porniți melodia (DJ)");
    expect(latest!.content.freeText).not.toContain("Fotografii de grup"); // another performer's moment

    // nothing changed → no empty version
    expect(await code(() => includeProgrammeInBriefing(as(t, OWNER), { occasionId: occ, supplierId: band.supplierId }))).toBe("CONFLICT:programme.errors.briefingUpToDate");
    // a changed cue list → version 3 with ONE programme block (the old block is replaced)
    await saveCueList(as(t, OWNER), { itemId: dance.itemId, cues: [{ offsetMin: 0, instruction: "Porniți melodia", who: "DJ" }, { offsetMin: 3, instruction: "Artificii reci" }] });
    const again = await includeProgrammeInBriefing(as(t, OWNER), { occasionId: occ, supplierId: band.supplierId });
    expect(again.version).toBe(3);
    const [v3] = await listBriefingVersions(as(t, OWNER), band.bookingId);
    expect(v3!.content.freeText.match(/— Program —/g)).toHaveLength(1);
    expect(v3!.content.freeText).toContain("Artificii reci");

    // the supplier acknowledges it through the existing mechanism
    const link = await createSupplierLink(as(t, OWNER), { bookingId: band.bookingId });
    const ack = await acknowledgeBriefing(sys(), { token: link.token, versionId: v3!.id, name: "Mihai Allegro" });
    expect(ack).toMatchObject({ version: 3, alreadyAcknowledged: false });
    expect(await code(() => includeProgrammeInBriefing(as(t, HELPER), { occasionId: occ, supplierId: band.supplierId }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
  });
});

describe("guest-visible programme and programmeRevision (C-10, INF5)", () => {
  it("bumps the revision only for changes guests can see", async () => {
    const occ = await newOccasion(t);
    const hidden = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Probă de sunet", time: "14:00" });
    expect(hidden.revision).toBe(0);
    const shown = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia", time: "16:00", visibleToGuests: "on" });
    expect(shown).toMatchObject({ revision: 1, guestsNotified: true });
    // notes, performer and cues are not guest-visible
    const notes = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, itemId: shown.itemId, title: "Cununia", time: "16:00", visibleToGuests: "on", notes: "Preotul ajunge la 15:30" });
    expect(notes.revision).toBe(1);
    await saveCueList(as(t, OWNER), { itemId: shown.itemId, cues: [{ offsetMin: 0, instruction: "Clopote" }] });
    const moved = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, itemId: shown.itemId, title: "Cununia", time: "16:30", visibleToGuests: "on", notes: "Preotul ajunge la 15:30" });
    expect(moved.revision).toBe(2);
    expect((await setProgrammeVisibility(as(t, OWNER), { itemId: hidden.itemId, visible: true })).revision).toBe(3);
    expect((await setProgrammeVisibility(as(t, OWNER), { itemId: hidden.itemId, visible: true })).revision).toBe(3); // repeat
    expect((await removeProgrammeItem(as(t, OWNER), { itemId: hidden.itemId })).revision).toBe(4);
    const changes = await t.db.select().from(programmeChanges).where(eq(programmeChanges.occasionId, occ));
    expect(changes.map((c) => `${c.revision}:${c.kind}`).sort()).toEqual(["1:added", "2:changed", "3:added", "4:removed"]);
    // the public page only ever gets guest-visible moments that concern everyone
    expect((await readPublicProgramme(sys(), occ)).map((i) => i.title)).toEqual(["Cununia"]);
  });

  it("a guest sees only visible moments that concern their household — no notes, cues or performers", async () => {
    const occ = await newOccasion(t);
    const a = await household(t, occ, "Familia Popescu");
    const b = await household(t, occ, "Familia Ionescu");
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia", time: "16:00", visibleToGuests: true, notes: "secret de culise" });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Fotografii cu nașii", time: "17:00", visibleToGuests: true, concerns: "some", householdIds: [a.householdId] });
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Probă de sunet", time: "14:00" });
    const forA = await getGuestProgramme(await guestCtx(t, a.token));
    const forB = await getGuestProgramme(await guestCtx(t, b.token));
    expect(forA!.items.map((i) => i.title)).toEqual(["Cununia", "Fotografii cu nașii"]);
    expect(forB!.items.map((i) => i.title)).toEqual(["Cununia"]);
    expect(JSON.stringify(forA)).not.toContain("secret de culise");
    // it arrives on the guest link as the "programme" section
    const view = await getGuestView(await guestCtx(t, a.token));
    expect(view.sections.find((s) => s.key === "programme")).toBeTruthy();
    expect(await code(() => getGuestProgramme(as(t, OWNER)))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    expect(await code(() => saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "X", time: "10:00", concerns: "some" }))).toBe("VALIDATION:programme.errors.chooseHouseholds");
  });

  it("notifies ONCE per change: email to concerned leads with an email, marker for the others, nothing for the unconcerned", async () => {
    const occ = await newOccasion(t);
    const withMail = await household(t, occ, "Familia Popescu", "popescu@example.test");
    const noMail = await household(t, occ, "Familia Ionescu");
    const other = await household(t, occ, "Familia Georgescu", "georgescu@example.test");
    // everyone has opened their link once (so "changed since your last visit" has a baseline)
    for (const h of [withMail, noMail, other]) await markGuestLinkViewed(await guestCtx(t, h.token));

    const later = addMinutes(NOW, 30);
    const saved = await saveProgrammeItem(as(t, OWNER, later), {
      occasionId: occ,
      title: "Fotografii cu nașii",
      time: "17:00",
      visibleToGuests: true,
      concerns: "some",
      householdIds: [withMail.householdId, noMail.householdId],
    });
    expect(saved.revision).toBe(1);
    // a job is queued for this revision, a few minutes out, under a unique key
    const queued = await t.db.select().from(jobs).where(eq(jobs.name, PROGRAMME_NOTIFY_JOB));
    const mine = queued.filter((j) => (j.payload as { occasionId: string }).occasionId === occ);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.uniqueKey).toBe(`${PROGRAMME_NOTIFY_JOB}:${occ}:1`);
    expect(mine[0]!.runAt.getTime()).toBeGreaterThan(later.getTime());
    // a targeted change does not raise the link-wide notice for everybody
    const [settings] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, occ));
    expect(settings?.guestRevision ?? 0).toBe(0);

    const first = await notifyProgrammeChange(sys(addMinutes(later, 6)), { occasionId: occ, revision: 1 });
    expect(first).toEqual({ sent: 1, skipped: 0, superseded: false });
    const again = await notifyProgrammeChange(sys(addMinutes(later, 7)), { occasionId: occ, revision: 1 });
    expect(again.sent).toBe(0);
    const sent = await mails(occ);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toEmail).toBe("popescu@example.test"); // not Georgescu: the moment does not concern them

    // the household without an email sees the moment marked on its link; the unconcerned one sees nothing
    const marked = await getGuestProgramme(await guestCtx(t, noMail.token, addMinutes(later, 10)));
    expect(marked!.items.map((i) => [i.title, i.changed])).toEqual([["Fotografii cu nașii", true]]);
    expect(await getGuestProgramme(await guestCtx(t, other.token, addMinutes(later, 10)))).toBeNull();
    // once seen, the marker is gone
    await markGuestLinkViewed(await guestCtx(t, noMail.token, addMinutes(later, 11)));
    const seen = await getGuestProgramme(await guestCtx(t, noMail.token, addMinutes(later, 12)));
    expect(seen!.items[0]!.changed).toBe(false);
  });

  it("a burst of edits is one message; a change for everyone raises the link notice; decliners get nothing", async () => {
    const occ = await newOccasion(t);
    const a = await household(t, occ, "Familia Popescu", "popescu2@example.test");
    const b = await household(t, occ, "Familia Refuz", "refuz@example.test");
    await submitRsvp(await guestCtx(t, b.token), { attending: "no", adultsCount: 0, childrenCount: 0 });
    void a;
    const r1 = await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia", time: "16:00", visibleToGuests: true });
    const r2 = await saveProgrammeItem(as(t, OWNER, addMinutes(NOW, 2)), { occasionId: occ, itemId: r1.itemId, title: "Cununia", time: "16:30", visibleToGuests: true });
    expect([r1.revision, r2.revision]).toEqual([1, 2]);
    const [settings] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, occ));
    expect(settings!.guestRevision).toBe(2);
    expect(settings!.guestRevisionReasonKey).toBe("programme.guest.changedNotice");
    // the first job finds a newer change and leaves the round to it
    expect(await notifyProgrammeChange(sys(addMinutes(NOW, 5)), { occasionId: occ, revision: 1 })).toEqual({ sent: 0, skipped: 0, superseded: true });
    expect(await mails(occ)).toHaveLength(0);
    // run through the queue: one email in total, for both changes
    await runOnce(sys(addMinutes(NOW, 20)), { names: [PROGRAMME_NOTIFY_JOB] });
    await runOnce(sys(addMinutes(NOW, 21)), { names: [PROGRAMME_NOTIFY_JOB] });
    const sent = await mails(occ);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toEmail).toBe("popescu2@example.test");
    expect((await t.db.select().from(programmeChanges).where(eq(programmeChanges.occasionId, occ))).every((c) => c.notifiedAt !== null)).toBe(true);
    expect(await code(() => notifyProgrammeChange(as(t, OWNER), { occasionId: occ, revision: 2 }))).toMatch(/^FORBIDDEN/);
  });

  it("exports the programme as CSV for members", async () => {
    const occ = await newOccasion(t);
    await saveProgrammeItem(as(t, OWNER), { occasionId: occ, title: "Cununia", time: "16:00", visibleToGuests: true });
    const file = await runExport(as(t, HELPER), occ, "programme-csv");
    expect(file.content).toContain("Cununia");
    expect(file.content).toContain("16:00");
    expect(await code(() => runExport(as(t, OUTSIDER), occ, "programme-csv"))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });
});
