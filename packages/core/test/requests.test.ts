import { eq, occasions, privateRequests } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { addDays } from "@ed/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBriefingVersions } from "../src/briefings";
import { anonymousCtx, systemCtx } from "../src/context";
import { listExports, runExport } from "../src/exports";
import { getGuestVenue, getJourney, readPublishedJourney, saveJourney } from "../src/guestevent";
import { getGuestView } from "../src/invitations";
import { getPublicEvent, savePublicPage } from "../src/publicpage";
import { issueFormStamp } from "../src/ratelimit";
import { registerForEvent } from "../src/registrations";
import {
  composeShareLines,
  getGuestRequests,
  getPrivateRequestCounts,
  listPrivateRequests,
  PRIVATE_REQUEST_RETENTION_DAYS,
  purgeExpiredPrivateRequests,
  setRequestStatus,
  shareRequestCounts,
  submitGuestRequest,
  submitRegistrantRequest,
} from "../src/requests";
import { listRetentionRules } from "../src/retention";
import { createSupplier } from "../src/suppliers";
import { as, code, guestCtx, HELPER, HOLDER, household, newOccasion, NOW, OUTSIDER, OWNER, PM, seedAccounts } from "./_releasec";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  await t.close();
});

const sys = (now: Date = NOW) => systemCtx(t.db, { now });

describe("private requests (C-07, D2)", () => {
  it("a guest sends a request from their link; the child-details warning is the RSVP one; text is not echoed back", async () => {
    const occ = await newOccasion(t);
    const h = await household(t, occ, "Familia Popescu");
    const g = await guestCtx(t, h.token);
    expect(await code(() => submitGuestRequest(g, { kind: "dietary" }))).toBe("VALIDATION:requests.errors.empty");
    expect(await code(() => submitGuestRequest(g, { kind: "dietary", body: "Fiul meu Andrei, 4 ani, are alergie la nuci" }))).toBe("VALIDATION:rsvp.errors.childDetails");
    // after the warning they may still send
    await submitGuestRequest(g, { kind: "dietary", body: "Fiul meu Andrei, 4 ani, are alergie la nuci", childDetailsAcknowledged: true });
    await submitGuestRequest(g, { kind: "dietary", dietTag: "gluten_free" });
    await submitGuestRequest(g, { kind: "access", body: "Am nevoie de rampă la intrare", dietTag: "vegan" });
    const mine = (await getGuestRequests(g))!;
    expect(mine.sent.map((s) => s.kind).sort()).toEqual(["access", "dietary", "dietary"]);
    expect(JSON.stringify(mine)).not.toMatch(/rampă|nuci/);
    const section = (await getGuestView(g)).sections.find((s) => s.key === "privateRequest");
    expect(JSON.stringify(section)).not.toMatch(/rampă|nuci/);
    // the diet tag only belongs to dietary requests
    const rows = await t.db.select().from(privateRequests).where(eq(privateRequests.occasionId, occ));
    expect(rows.find((r) => r.kind === "access")!.dietTag).toBeNull();
    // a planner is not a guest
    expect(await code(() => submitGuestRequest(as(t, OWNER), { kind: "other", body: "x" }))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });

  it("ONLY holders of the privateRequests grant read them — a manager without it gets FORBIDDEN, everywhere", async () => {
    const occ = await newOccasion(t);
    const h = await household(t, occ, "Familia Ionescu");
    await submitGuestRequest(await guestCtx(t, h.token), { kind: "dietary", dietTag: "vegan", body: "Fără produse animale" });
    const [row] = await t.db.select().from(privateRequests).where(eq(privateRequests.occasionId, occ));

    // owner (implicit grant) and the contributor who was given the grant
    for (const who of [OWNER, HOLDER]) {
      const { requests } = await listPrivateRequests(as(t, who), occ);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ kind: "dietary", dietTag: "vegan", body: "Fără produse animale", from: { type: "household", name: "Familia Ionescu" } });
      expect((await getPrivateRequestCounts(as(t, who), occ)).total).toBe(1);
    }
    // the project manager WITHOUT the grant, a plain contributor, an outsider
    for (const who of [PM, HELPER]) {
      expect(await code(() => listPrivateRequests(as(t, who), occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
      expect(await code(() => getPrivateRequestCounts(as(t, who), occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
      expect(await code(() => setRequestStatus(as(t, who), { requestId: row!.id, status: "handled" }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
      expect(await code(() => runExport(as(t, who), occ, "private-requests-csv"))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
      // …and the export is not even listed for them
      expect((await listExports(as(t, who), occ)).map((e) => e.key)).not.toContain("private-requests-csv");
      // no other export of theirs carries the request
      for (const e of await listExports(as(t, who), occ)) {
        const file = await runExport(as(t, who), occ, e.key).catch(() => null);
        if (file && typeof file.content === "string") expect(file.content).not.toContain("Fără produse animale");
      }
    }
    expect(await code(() => listPrivateRequests(as(t, OUTSIDER), occ))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
    expect((await listExports(as(t, HOLDER), occ)).map((e) => e.key)).toContain("private-requests-csv");
    expect((await runExport(as(t, HOLDER), occ, "private-requests-csv")).content).toContain("Fără produse animale");

    // handled / unhandled with a note
    await setRequestStatus(as(t, HOLDER), { requestId: row!.id, status: "handled", note: "Vorbit cu bucătarul" });
    const after = (await listPrivateRequests(as(t, OWNER), occ)).requests[0]!;
    expect(after).toMatchObject({ status: "handled", note: "Vorbit cu bucătarul" });
    expect(after.handledAt).toEqual(NOW);
    await setRequestStatus(as(t, HOLDER), { requestId: row!.id, status: "open" });
    expect((await listPrivateRequests(as(t, OWNER), occ)).requests[0]!.handledAt).toBeNull();
  });

  it("suppliers get anonymous counts only, and only when a holder shares them into a briefing", async () => {
    const occ = await newOccasion(t);
    const a = await household(t, occ, "Familia A");
    const b = await household(t, occ, "Familia B");
    for (const h of [a, b]) await submitGuestRequest(await guestCtx(t, h.token), { kind: "dietary", dietTag: "gluten_free", body: `Celiachie — ${h.householdId}` });
    await submitGuestRequest(await guestCtx(t, a.token), { kind: "dietary", dietTag: "gluten_free" });
    await submitGuestRequest(await guestCtx(t, b.token), { kind: "access", body: "Scaun cu rotile" });
    const catering = await createSupplier(as(t, OWNER), { occasionId: occ, name: "Catering Bun" });

    const counts = await getPrivateRequestCounts(as(t, HOLDER), occ);
    expect(counts.byDietTag).toEqual([{ tag: "gluten_free", count: 3 }]);
    expect(composeShareLines(counts, { tags: ["gluten_free"], access: true }, "ro")).toEqual(["3 × fără gluten", "1 × nevoi de acces (detalii la organizator)"]);
    // nothing reaches the briefing by itself
    expect(await listBriefingVersions(as(t, OWNER), catering.bookingId)).toHaveLength(0);
    // a holder who cannot manage briefings cannot share; a manager without the grant cannot either
    expect(await code(() => shareRequestCounts(as(t, HOLDER), { occasionId: occ, bookingId: catering.bookingId, tags: ["gluten_free"] }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => shareRequestCounts(as(t, PM), { occasionId: occ, bookingId: catering.bookingId, tags: ["gluten_free"] }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => shareRequestCounts(as(t, OWNER), { occasionId: occ, bookingId: catering.bookingId, tags: ["vegan"] }))).toBe("VALIDATION:requests.errors.nothingToShare");

    const shared = await shareRequestCounts(as(t, OWNER), { occasionId: occ, bookingId: catering.bookingId, tags: ["gluten_free"] });
    expect(shared).toEqual({ version: 1, lines: ["3 × fără gluten"] });
    const [v] = await listBriefingVersions(as(t, OWNER), catering.bookingId);
    expect(v!.content.specialNotes).toContain("3 × fără gluten");
    const whole = JSON.stringify(v!.content);
    expect(whole).not.toMatch(/Celiachie|Familia|rotile|hh_|acces/);
    expect(await code(() => shareRequestCounts(as(t, OWNER), { occasionId: occ, bookingId: catering.bookingId, tags: ["gluten_free"] }))).toBe("CONFLICT:requests.errors.alreadyShared");
  });

  it("public registrants can send one from their manage link", async () => {
    const occ = await newOccasion(t);
    await savePublicPage(as(t, OWNER), { occasionId: occ, slug: `req-${occ.replace(/_/g, "-")}`, titleRo: "Eveniment", showDate: true, showVenue: true, registrationEnabled: true, sharesCapacity: true, published: true });
    const slug = `req-${occ.replace(/_/g, "-")}`;
    const visitor = anonymousCtx(t.db, { now: NOW, ip: "198.51.100.200" });
    const stamp = issueFormStamp(new Date(NOW.getTime() - 20_000));
    const r = await registerForEvent(visitor, { slug, name: "Maria Pop", email: "maria@example.test", adults: 1, children: 0, consent: true, idempotencyKey: "req-key-0001", honeypot: "", renderedAt: stamp });
    const token = r.managePath!.split("/").pop()!;
    await submitRegistrantRequest(visitor, { slug, token, kind: "access", body: "Loc aproape de ieșire", honeypot: "", renderedAt: stamp });
    expect(await code(() => submitRegistrantRequest(visitor, { slug, token: "x".repeat(43), kind: "access", body: "x", honeypot: "", renderedAt: stamp }))).toBe("NOT_FOUND:publicpage.errors.linkGone");
    expect(await code(() => submitRegistrantRequest(visitor, { slug, token, kind: "access", body: "x", honeypot: "bot", renderedAt: stamp }))).toBe("RATE_LIMITED:common.errors.RATE_LIMITED");
    const { requests } = await listPrivateRequests(as(t, HOLDER), occ);
    expect(requests).toEqual([expect.objectContaining({ kind: "access", from: { type: "registration", name: "Maria Pop" } })]);
  });

  it("is purged 30 days after closeout — not before (INF6, fake clock)", async () => {
    expect(listRetentionRules()).toContain("private-requests");
    expect(PRIVATE_REQUEST_RETENTION_DAYS).toBe(30);
    const closing = await newOccasion(t);
    const open = await newOccasion(t);
    for (const occ of [closing, open]) {
      const h = await household(t, occ, "Familia X");
      await submitGuestRequest(await guestCtx(t, h.token), { kind: "other", body: "Vă rog un loc liniștit" });
    }
    const closedAt = new Date("2027-07-01T10:00:00Z");
    await t.db.update(occasions).set({ status: "closed", closedAt }).where(eq(occasions.id, closing));
    const count = async (occ: string) => (await t.db.select().from(privateRequests).where(eq(privateRequests.occasionId, occ))).length;

    expect(await purgeExpiredPrivateRequests(sys(addDays(closedAt, 29)))).toBe(0);
    expect(await count(closing)).toBe(1);
    expect(await purgeExpiredPrivateRequests(sys(addDays(closedAt, 31)))).toBe(1);
    expect(await count(closing)).toBe(0);
    expect(await count(open)).toBe(1); // an occasion still running keeps its requests
    expect(await purgeExpiredPrivateRequests(sys(addDays(closedAt, 40)))).toBe(0); // idempotent
    expect(await code(() => purgeExpiredPrivateRequests(as(t, OWNER)))).toMatch(/^FORBIDDEN/);
    // a closed occasion takes no new requests
    const h = await household(t, open, "Familia Y");
    await t.db.update(occasions).set({ status: "closed", closedAt }).where(eq(occasions.id, open));
    expect(await code(async () => submitGuestRequest(await guestCtx(t, h.token), { kind: "other", body: "prea târziu" }))).toMatch(/CONFLICT:lifecycle.errors.closed|THROWN/);
  });
});

describe("accessible guest journey (C-07)", () => {
  it("every fact is known or unknown — unknown stays visible; published in ro + en on the guest link and the public page", async () => {
    const occ = await newOccasion(t);
    const h = await household(t, occ, "Familia Popescu");
    const g = await guestCtx(t, h.token);
    // before anything is saved: five unknown facts, nothing published
    const blank = await getJourney(as(t, HELPER), occ);
    expect(blank.published).toBe(false);
    expect(blank.facts.map((f) => f.state)).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown"]);
    expect(await readPublishedJourney(sys(), occ)).toBeNull();
    // the venue section still gives the address and the navigation link
    const venue = (await getGuestVenue(g))!;
    expect(venue.navigationHref).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Conacul%20Polizu/);
    expect(venue.journey).toBeNull();

    expect(await code(() => saveJourney(as(t, HELPER), { occasionId: occ, facts: {}, published: true } as never))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    await saveJourney(as(t, OWNER), {
      occasionId: occ,
      facts: { stepFree: { state: "yes", noteRo: "Rampă la intrarea din curte", noteEn: "Ramp at the courtyard entrance" }, accessibleToilets: { state: "no" } },
      contactName: "Ioana",
      contactRoute: "0722 000 111",
      published: true,
    } as never);
    const pub = (await getGuestVenue(g))!.journey!;
    expect(pub.facts.map((f) => [f.key, f.state])).toEqual([
      ["stepFree", "yes"],
      ["accessibleToilets", "no"],
      ["parking", "unknown"],
      ["quietRoom", "unknown"],
      ["seatingHelp", "unknown"],
    ]);
    expect(pub.facts[0]!.note).toEqual({ ro: "Rampă la intrarea din curte", en: "Ramp at the courtyard entrance" });
    expect(pub.contact).toEqual({ name: "Ioana", route: "0722 000 111" });
    expect((await getGuestView(g)).sections.some((s) => s.key === "venue")).toBe(true);
    // and on the public page
    const slug = `acc-${occ.replace(/_/g, "-")}`;
    await savePublicPage(as(t, OWNER), { occasionId: occ, slug, titleRo: "Eveniment", showDate: true, showVenue: true, published: true });
    expect((await getPublicEvent(anonymousCtx(t.db, { now: NOW }), slug))!.journey!.facts).toHaveLength(5);
    // withdrawn → gone from both
    await saveJourney(as(t, OWNER), { occasionId: occ, facts: {}, published: false } as never);
    expect((await getGuestVenue(g))!.journey).toBeNull();
    expect((await getPublicEvent(anonymousCtx(t.db, { now: NOW }), slug))!.journey).toBeNull();
  });
});
