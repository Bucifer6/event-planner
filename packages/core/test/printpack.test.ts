import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetCategories, eq, invitations, occasionMembers, occasions } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { newId } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymousCtx, makeCtx } from "../src/context";
import { listExports, runExport } from "../src/exports";
import { createHousehold } from "../src/guests";
import { getGuestView, regenerateInvitation, resolveGuestLink, revokeInvitation, setInvitationExpiry } from "../src/invitations";
import { buildQrInvitationsPdf, buildQrLabelsPdf, buildRoomPlanPdf, buildTableCardsPdf, getEventPageUrl, pickPlanScale, setEventPageUrlProvider } from "../src/printpack";
import { ensureQrIds, listHouseholdQrs, qrCredential, qrLandingUrl, qrMatrix, qrPathData, resolveGuestCredential, resolveQrLink, rotateQrId } from "../src/qr";
import { addTable, createOwnSpace } from "../src/seating";
import { markStationeryProofed, saveStationeryVersion } from "../src/stationery";
import { as, code, HELPER, OUTSIDER, OWNER, seedAccounts } from "./_releasec";

// C-09: a printed QR opens ONE household's own invitation view and dies with its invitation;
// the print pack's PDFs are generated from the records and carry nothing promoted or financial.

let t: TestDb;
let dir: string;
const NOW = new Date("2027-03-01T09:00:00Z");

async function mkOccasion(title = "Nunta Ioanei și a lui Ștefan"): Promise<string> {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title, kind: "nunta", startsAt: new Date("2027-06-12T09:00:00Z"), venueName: "Conacul Polizu" });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}
const hh = (occasionId: string, name: string) => createHousehold(as(t, OWNER), { occasionId, name, guestNames: [`${name} Unu`] });
const anon = (now = NOW, ip = "203.0.113.9") => anonymousCtx(t.db, { now, ip });

function pdfText(bytes: Uint8Array): string {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, bytes);
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
}
const squash = (s: string) => s.replace(/\s+/g, "");
const texts = (names: string) => Object.fromEntries(Object.entries({ kicker: "Cu drag", names, wording: "vă invităm", date: "Sâmbătă, 12 iunie 2027", time: "", venue: "Conacul Polizu", address: "", rsvp: "", saveTheDate: "Rezervați data", menuTitle: "Meniu", menuBody: "Desert\nTort", thanks: "Mulțumim\nVă mulțumim." }).map(([k, v]) => [k, { value: v }]));

beforeAll(async () => {
  process.env.APP_URL = "https://app.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-printpack-"));
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  setEventPageUrlProvider(null);
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("QR for physical invitations (SEC2)", () => {
  it("every invitation gets a stable, random id that is not the token and resolves only to its own household", async () => {
    const occ = await mkOccasion();
    const a = await hh(occ, "Popescu");
    const b = await hh(occ, "Ionescu");
    expect(await ensureQrIds(as(t, OWNER), occ)).toBe(2);
    expect(await ensureQrIds(as(t, OWNER), occ)).toBe(0); // idempotent
    const codes = await listHouseholdQrs(as(t, OWNER), occ);
    expect(codes.map((c) => c.householdName)).toEqual(["Ionescu", "Popescu"]);
    const qa = codes.find((c) => c.householdId === a.householdId)!;
    const qb = codes.find((c) => c.householdId === b.householdId)!;
    // ≥ 128 random bits (32 base64url characters = 192), not the token, not derived from it
    expect(qa.qrId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(qa.qrId).not.toBe(qb.qrId);
    expect(a.token).not.toContain(qa.qrId);
    const [row] = await t.db.select().from(invitations).where(eq(invitations.householdId, a.householdId));
    expect(row!.tokenHash).not.toContain(qa.qrId);
    expect(qa.url).toBe(`https://app.example.test/g/q/${qa.qrId}`);
    expect(qrLandingUrl(qa.qrId)).toBe(qa.url);

    // the code resolves to the SAME guest actor as the household's own link — and to that household only
    const viaQr = await resolveQrLink(anon(), qa.qrId);
    const viaLink = await resolveGuestLink(anon(), a.token);
    expect(viaQr!.actor).toEqual(viaLink!.actor);
    expect(viaQr!.householdId).toBe(a.householdId);
    const view = await getGuestView(makeCtx(t.db, viaQr!.actor, { now: NOW }));
    expect(view.household.name).toBe("Popescu");
    expect(JSON.stringify(view)).not.toContain("Ionescu"); // never the guest list
    // the guest page's credential form resolves the same way; a token still resolves as a token
    expect((await resolveGuestCredential(anon(), qrCredential(qa.qrId)))!.householdId).toBe(a.householdId);
    expect((await resolveGuestCredential(anon(), a.token))!.householdId).toBe(a.householdId);
    expect(await resolveGuestCredential(anon(), qrCredential("A".repeat(32)))).toBeNull();

    // only managers see or make the codes
    expect(await code(() => listHouseholdQrs(as(t, HELPER), occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => listHouseholdQrs(as(t, OUTSIDER), occ))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
  });

  it("unknown, malformed, revoked and expired codes are refused alike; the id stays with the invitation", async () => {
    const occ = await mkOccasion();
    const a = await hh(occ, "Popescu");
    const qrId = (await listHouseholdQrs(as(t, OWNER), occ))[0]!.qrId;
    expect(await resolveQrLink(anon(), "A".repeat(32))).toBeNull();
    expect(await resolveQrLink(anon(), "not a code")).toBeNull();
    expect(await resolveQrLink(anon(), a.token)).toBeNull(); // a link token is not a QR id

    await revokeInvitation(as(t, OWNER), { householdId: a.householdId });
    expect(await resolveQrLink(anon(), qrId)).toBeNull();
    expect(await resolveGuestCredential(anon(), qrCredential(qrId))).toBeNull();
    expect((await listHouseholdQrs(as(t, OWNER), occ))[0]!.revoked).toBe(true);
    // regenerating the link lifts the revocation; the printed code is the same one and works again
    const fresh = await regenerateInvitation(as(t, OWNER), { householdId: a.householdId });
    expect((await resolveQrLink(anon(), qrId))!.householdId).toBe(a.householdId);
    expect(fresh.token).not.toContain(qrId);
    // an expired invitation: refused through the QR exactly as through the link
    await setInvitationExpiry(as(t, OWNER), { householdId: a.householdId, mode: "closeout" });
    await t.db.update(occasions).set({ closedAt: new Date("2027-02-01T00:00:00Z") }).where(eq(occasions.id, occ));
    expect(await resolveQrLink(anon(), qrId)).toBeNull();
    expect(await resolveGuestLink(anon(), fresh.token)).toBeNull();
    await t.db.update(occasions).set({ closedAt: null }).where(eq(occasions.id, occ));
    // a manager can retire one printed code
    const next = await rotateQrId(as(t, OWNER), { householdId: a.householdId });
    expect(await resolveQrLink(anon(), qrId)).toBeNull();
    expect((await resolveQrLink(anon(), next.qrId))!.householdId).toBe(a.householdId);
    expect(await code(() => rotateQrId(as(t, HELPER), { householdId: a.householdId }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
  });

  it("guessing is rate-limited per IP, like link guessing", async () => {
    const ip = "198.51.100.77";
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const res = await code(() => resolveQrLink(anon(NOW, ip), `${String(i).padStart(2, "0")}${"B".repeat(30)}`));
      limited = res.startsWith("RATE_LIMITED");
    }
    expect(limited).toBe(true);
  });

  it("draws the code as vector modules with a quiet zone", () => {
    const m = qrMatrix("https://app.example.test/g/q/abcdefghijklmnopqrstuvwxyz012345");
    expect(m.size).toBeGreaterThanOrEqual(25);
    expect(m.dark).toHaveLength(m.size * m.size);
    const d = qrPathData(m, 10, 10, 100);
    expect(d).toMatch(/^M[\d.]+ [\d.]+h[\d.]+v[\d.]+h-[\d.]+z/);
    const cell = 100 / (m.size + 8);
    const xs = [...d.matchAll(/M([\d.]+) ([\d.]+)/g)].map((x) => Number(x[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 + 4 * cell - 0.01); // 4 modules of quiet zone inside the square
  });
});

describe("print pack PDFs regenerate from the records", () => {
  it("QR labels: a household name and its own code each; revoked invitations are left out", async () => {
    const occ = await mkOccasion("Botezul Sofiei");
    const a = await hh(occ, "Familia Popescu");
    await hh(occ, "Familia Ionescu");
    const gone = await hh(occ, "Familia Revocată");
    await revokeInvitation(as(t, OWNER), { householdId: gone.householdId });
    const pdf = await buildQrLabelsPdf(as(t, OWNER), occ);
    let text = pdfText(pdf.bytes);
    expect(text).toContain("Familia Popescu");
    expect(text).toContain("Familia Ionescu");
    expect(text).not.toContain("Familia Revocată");
    expect(text).toContain("Botezul Sofiei");
    expect(text).not.toContain(a.token); // the sheet never prints a link token
    // renaming the household and regenerating gives the new name: nothing is cached
    const { updateHousehold } = await import("../src/guests");
    await updateHousehold(as(t, OWNER), { householdId: a.householdId, name: "Familia Popescu-Stan" });
    text = pdfText((await buildQrLabelsPdf(as(t, OWNER), occ)).bytes);
    expect(text).toContain("Familia Popescu-Stan");
    expect(await code(() => buildQrLabelsPdf(as(t, HELPER), occ))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
  });

  it("table cards carry each table's label, and a QR to the event page only when there is one", async () => {
    const occ = await mkOccasion();
    expect(await code(() => buildTableCardsPdf(as(t, OWNER), occ))).toBe("CONFLICT:printpack.errors.noTables");
    await createOwnSpace(as(t, OWNER), { occasionId: occ, name: "Salonul Mare", widthMm: 14_000, lengthMm: 9000 });
    await addTable(as(t, OWNER), { occasionId: occ, custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 }, label: "7" });
    await addTable(as(t, OWNER), { occasionId: occ, custom: { name: "Prezidiu", shape: "rect", widthMm: 3000, lengthMm: 900, seats: 6 }, label: "Masa mirilor" });
    // no public page: no provider answer, no code — the cards still print
    expect(await getEventPageUrl(as(t, OWNER), occ)).toBeNull();
    let text = pdfText((await buildTableCardsPdf(as(t, HELPER), occ)).bytes);
    expect(squash(text)).toContain("MASA");
    expect(text).toMatch(/\b7\b/);
    expect(text).toContain("Masa mirilor");
    expect(squash(text)).not.toContain("PROGRAM,MENIUȘIPLAN");
    // with a provider (the public page of the occasion) the caption and the code appear
    const asked: string[] = [];
    setEventPageUrlProvider(async (_ctx, id) => {
      asked.push(id);
      return "https://app.example.test/e/nunta-ioanei";
    });
    expect(await getEventPageUrl(as(t, OWNER), occ)).toBe("https://app.example.test/e/nunta-ioanei");
    text = pdfText((await buildTableCardsPdf(as(t, OWNER), occ)).bytes);
    expect(squash(text)).toContain("PROGRAM,MENIUȘIPLAN");
    expect(asked).toContain(occ);
    // a provider that answers something that is not a web address is ignored
    setEventPageUrlProvider(async () => "javascript:alert(1)");
    expect(await getEventPageUrl(as(t, OWNER), occ)).toBeNull();
    setEventPageUrlProvider(null);

    // an UNPROOFED stationery design is never printed: the cards keep the house design until the proof is marked
    await saveStationeryVersion(as(t, OWNER), { occasionId: occ, designKey: "modern", colourwayKey: "terracotta", locale: "ro", texts: texts("Ioana & Ștefan") });
    expect(pdfText((await buildTableCardsPdf(as(t, OWNER), occ)).bytes)).not.toContain("Ioana & Ștefan");
    await markStationeryProofed(as(t, OWNER), { occasionId: occ, version: 1 });
    expect(pdfText((await buildTableCardsPdf(as(t, OWNER), occ)).bytes)).toContain("Ioana & Ștefan");
  });

  it("the room plan is drawn to a standard scale, as vectors, once a space model exists — published or not", async () => {
    const occ = await mkOccasion("Aniversarea Mariei");
    expect(await code(() => buildRoomPlanPdf(as(t, OWNER), occ))).toBe("CONFLICT:printpack.errors.noSpace");
    await createOwnSpace(as(t, OWNER), { occasionId: occ, name: "Salonul Mare", widthMm: 14_000, lengthMm: 9000 });
    await addTable(as(t, OWNER), { occasionId: occ, custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 }, label: "12" });
    const pdf = await buildRoomPlanPdf(as(t, HELPER), occ); // seating is NOT published: still printable for the planner
    // 14 × 9 m on A4 landscape → 1:75 is the largest standard scale that fits
    expect(pdf.scale).toBe(75);
    expect(pdf.filename).toMatch(/planul-salii-1-75\.pdf$/);
    const text = pdfText(pdf.bytes);
    expect(text).toContain("Aniversarea Mariei");
    expect(text).toContain("Scara 1:75");
    expect(squash(text)).toContain("SALONULMARE");
    expect(text).toMatch(/\b12\b/); // the table label
    expect(text).toMatch(/\d m\b/); // the scale bar
    expect(text).toContain("nu este încă publicată");
    // vector, not a picture of the plan
    const file = join(dir, "plan.pdf");
    writeFileSync(file, pdf.bytes);
    expect(execFileSync("pdfimages", ["-list", file], { encoding: "utf8" }).trim().split("\n").length).toBeLessThanOrEqual(2);
    // the scale picker itself
    expect(pickPlanScale(10_000, 6_000, 600, 400)).toBe(50);
    expect(pickPlanScale(60_000, 40_000, 600, 400)).toBe(300);
  });

  it("invitations with QR go through the proof gate and give each household its own sheet", async () => {
    const occ = await mkOccasion();
    await hh(occ, "Familia Popescu");
    await hh(occ, "Familia Ionescu");
    expect(await code(() => buildQrInvitationsPdf(as(t, OWNER), occ))).toBe("CONFLICT:printpack.errors.noStationery");
    await saveStationeryVersion(as(t, OWNER), { occasionId: occ, designKey: "classic", colourwayKey: "ivoire", locale: "ro", texts: texts("Ioana & Ștefan"), qrOnInvitation: true });
    expect(await code(() => buildQrInvitationsPdf(as(t, OWNER), occ))).toBe("CONFLICT:stationery.errors.notProofed");
    await markStationeryProofed(as(t, OWNER), { occasionId: occ, version: 1 });
    const text = pdfText((await buildQrInvitationsPdf(as(t, OWNER), occ)).bytes);
    expect(squash(text)).toContain("FAMILIAPOPESCU");
    expect(squash(text)).toContain("FAMILIAIONESCU");
    expect(text.split("\f").filter((p) => p.trim()).length).toBe(2);
  });

  it("appear on the print page as exports; nothing promoted and nothing financial is in them (P16)", async () => {
    const occ = await mkOccasion();
    await hh(occ, "Familia Popescu");
    await createOwnSpace(as(t, OWNER), { occasionId: occ, name: "Salon", widthMm: 12_000, lengthMm: 8000 });
    await addTable(as(t, OWNER), { occasionId: occ, custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 } });
    await t.db.insert(budgetCategories).values({ occasionId: occ, name: "Flori", estimateMinor: 123_456_00 }).catch(() => undefined);
    const owner = (await listExports(as(t, OWNER), occ)).map((e) => e.key);
    expect(owner).toEqual(expect.arrayContaining(["qr-labels", "qr-invitations", "table-cards", "room-plan"]));
    const helper = (await listExports(as(t, HELPER), occ)).map((e) => e.key);
    expect(helper).toEqual(expect.arrayContaining(["table-cards", "room-plan"]));
    expect(helper).not.toContain("qr-labels"); // personal links: managers only
    expect(helper).not.toContain("qr-invitations");
    let all = "";
    for (const key of ["qr-labels", "qr-invitations", "table-cards", "room-plan"]) {
      const file = await runExport(as(t, OWNER), occ, key);
      expect(file.mime).toBe("application/pdf");
      all += pdfText(file.content as unknown as Uint8Array);
    }
    // no stationery yet → the QR invitations export explains what to do instead of failing
    expect(all).toContain("Încă nu există o invitație");
    expect(all).not.toMatch(/Promovat|plasare plătită|Featured|Sponsored/i);
    expect(all).not.toMatch(/123[.\s]?456|RON|lei\b|buget|avans|plat[ăa]/i);
  });
});
