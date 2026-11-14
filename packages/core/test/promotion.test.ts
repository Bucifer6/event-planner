import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPromotionCard, buildPromotionIcs, buildPromotionPoster, composePromotionTexts, getPromotionPage, occasionToIcs, savePromotionTexts } from "../src/promotion";
import { saveStationeryVersion } from "../src/stationery";
import { as, code, HELPER, newOccasion, OUTSIDER, OWNER, seedAccounts } from "./_releasec";

// C-12: generated copy and assets to DOWNLOAD. Nothing is posted, sent or spent.

let t: TestDb;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ed-promotion-"));
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("description texts from the occasion's own facts", () => {
  it("composes short and long copy in Romanian and English, leaving out what is not known", async () => {
    const occ = await newOccasion(t);
    const page = await getPromotionPage(as(t, HELPER), occ);
    expect(page.texts.shortRo).toMatchObject({ value: "Nunta Ioanei și a lui Andrei — sâmbătă, 12 iunie 2027, Conacul Polizu, Str. Polizu 4, Iași.", saved: false, aiGenerated: false });
    expect(page.texts.shortEn.value).toBe("Nunta Ioanei și a lui Andrei — Saturday, 12 June 2027, Conacul Polizu, Str. Polizu 4, Iași.");
    expect(page.texts.longRo.value).toContain("Vă așteptăm la „Nunta Ioanei și a lui Andrei”.");
    expect(page.texts.longRo.value).toContain("Locul: Conacul Polizu, Str. Polizu 4, Iași.");
    expect(page.canManage).toBe(false);
    // no date, no venue: nothing invented, no "undefined", no empty brackets
    const bare = composePromotionTexts({ title: "Picnic", startsAt: null, timezone: "Europe/Bucharest", venueName: null, venueAddress: null, purpose: null }, "ro");
    expect(bare.short).toBe("Picnic.");
    expect(bare.long).toBe("Vă așteptăm la „Picnic”. Abia așteptăm să ne revedem.");
    // a real time of day is said; a day-anchored occasion has none
    const timed = composePromotionTexts({ title: "Cină", startsAt: new Date("2027-06-12T16:30:00Z"), timezone: "Europe/Bucharest", venueName: "Acasă", venueAddress: null, purpose: "Sărbătorim zece ani." }, "ro");
    expect(timed.short).toBe("Cină — sâmbătă, 12 iunie 2027, ora 19:30, Acasă.");
    expect(timed.long).toContain("Sărbătorim zece ani.");
  });

  it("keeps the planner's edits, with the AI label where the text came from a suggestion", async () => {
    const occ = await newOccasion(t);
    const suggestion = "Vă așteptăm cu drag la nunta noastră. Veniți să ne bucurăm împreună!";
    await savePromotionTexts(as(t, OWNER), { occasionId: occ, texts: { shortRo: { value: "Ne căsătorim!" }, longRo: { value: suggestion, aiOriginal: suggestion } } });
    let page = await getPromotionPage(as(t, OWNER), occ);
    expect(page.texts.shortRo).toMatchObject({ value: "Ne căsătorim!", saved: true, aiGenerated: false });
    expect(page.texts.longRo).toMatchObject({ aiGenerated: true, saved: true });
    expect(page.texts.shortEn.saved).toBe(false); // untouched texts stay composed
    await savePromotionTexts(as(t, OWNER), { occasionId: occ, texts: { longRo: { value: "O zi de vară, o grădină, oameni dragi și noi doi." } } });
    page = await getPromotionPage(as(t, OWNER), occ);
    expect(page.texts.longRo.aiGenerated).toBe(false);
    expect(await code(() => savePromotionTexts(as(t, HELPER), { occasionId: occ, texts: { shortRo: { value: "x" } } }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => savePromotionTexts(as(t, OWNER), { occasionId: occ, texts: { shortRo: { value: "x".repeat(400) } } }))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await code(() => getPromotionPage(as(t, OUTSIDER), occ))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
  });
});

describe("assets to download", () => {
  it("image cards are PNGs of the right size, drawn with the stationery design", async () => {
    const occ = await newOccasion(t);
    const square = await buildPromotionCard(as(t, HELPER), { occasionId: occ, size: "square" });
    expect(square.mime).toBe("image/png");
    expect(await sharp(Buffer.from(square.bytes)).metadata()).toMatchObject({ format: "png", width: 1080, height: 1080 });
    const story = await buildPromotionCard(as(t, OWNER), { occasionId: occ, size: "story" });
    expect(await sharp(Buffer.from(story.bytes)).metadata()).toMatchObject({ width: 1080, height: 1920 });
    // before a stationery set exists the house design is used; afterwards the occasion's own
    expect((await getPromotionPage(as(t, OWNER), occ)).design).toEqual({ fromStationery: false, designKey: "classic", colourwayKey: "ivoire" });
    const centre = async (bytes: Uint8Array) => (await sharp(Buffer.from(bytes)).extract({ left: 150, top: 150, width: 4, height: 4 }).raw().toBuffer())[0]!;
    const light = await centre(square.bytes);
    const texts = Object.fromEntries(["kicker", "names", "wording", "date", "time", "venue", "address", "rsvp", "saveTheDate", "menuTitle", "menuBody", "thanks"].map((k) => [k, { value: k === "names" ? "Ioana & Andrei" : "" }]));
    await saveStationeryVersion(as(t, OWNER), { occasionId: occ, designKey: "nocturne", colourwayKey: "minuit", locale: "ro", texts });
    expect((await getPromotionPage(as(t, OWNER), occ)).design).toMatchObject({ fromStationery: true, designKey: "nocturne" });
    const dark = await centre((await buildPromotionCard(as(t, OWNER), { occasionId: occ, size: "square" })).bytes);
    expect(light).toBeGreaterThan(200);
    expect(dark).toBeLessThan(80);
    expect(await code(() => buildPromotionCard(as(t, OUTSIDER), { occasionId: occ, size: "square" }))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
  });

  it("the calendar file is valid iCalendar: all-day for a day-anchored date, UTC for a real time", async () => {
    const occ = await newOccasion(t);
    const file = await buildPromotionIcs(as(t, OWNER), occ);
    expect(file.mime).toBe("text/calendar; charset=utf-8");
    const ics = Buffer.from(file.bytes).toString("utf8");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270612\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270613\r\n");
    expect(ics).toContain("LOCATION:Conacul Polizu\\, Str. Polizu 4\\, Iași\r\n");
    expect(ics.replace(/\r\n /g, "")).toContain("SUMMARY:Nunta Ioanei și a lui Andrei");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    const timed = occasionToIcs({ id: "o1", title: "Cină; cu, virgule", startsAt: new Date("2027-06-12T16:30:00Z"), endsAt: null, timezone: "Europe/Bucharest", venueName: null, venueAddress: null }, "Rând unu\nRând doi", new Date("2027-01-01T00:00:00Z"));
    expect(timed).toContain("DTSTART:20270612T163000Z");
    expect(timed).toContain("DTEND:20270612T203000Z");
    expect(timed).toContain("SUMMARY:Cină\\; cu\\, virgule");
    expect(timed).toContain("DESCRIPTION:Rând unu\\nRând doi");
    expect(timed).not.toContain("LOCATION");
    const undated = await newOccasion(t, { startsAt: null });
    expect(await code(() => buildPromotionIcs(as(t, OWNER), undated))).toBe("CONFLICT:promotion.errors.noDate");
  });

  it("the poster is a vector PDF at A4 or A3 with live text", async () => {
    const occ = await newOccasion(t);
    for (const [size, w, h] of [["A4", 595, 842], ["A3", 842, 1191]] as const) {
      const pdf = await buildPromotionPoster(as(t, HELPER), { occasionId: occ, size });
      const path = join(dir, `poster-${size}.pdf`);
      writeFileSync(path, pdf.bytes);
      const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
      const m = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info)!;
      expect(Math.round(Number(m[1]))).toBe(w);
      expect(Math.round(Number(m[2]))).toBe(h);
      expect(execFileSync("pdftotext", [path, "-"], { encoding: "utf8" })).toContain("Nunta Ioanei");
      expect(execFileSync("pdfimages", ["-list", path], { encoding: "utf8" }).trim().split("\n").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("export only", () => {
  it("the module has no network client, no posting or advertising integration, and schedules nothing", () => {
    const code_ = readFileSync(join(__dirname, "..", "src", "promotion.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code_).not.toMatch(/\bfetch\s*\(|safeFetch|XMLHttpRequest|node:https?|from "(node:)?(http|https|net|tls|dgram)"|axios|undici|WebSocket/);
    expect(code_.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//); // not even a URL to call (the SVG namespace is a name, not an address)
    expect(code_).not.toMatch(/facebook|instagram|tiktok|twitter|linkedin|whatsapp|graph\.|oauth|access_token|\bads?\b|campaign|budgetSpend/i);
    expect(code_).not.toMatch(/@ed\/jobs|defineJob|enqueue\(|sendEmail|@ed\/email/);
    const imports = [...code_.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    for (const spec of imports) expect(spec, spec).toMatch(/^(@ed\/(db|i18n|i18n\/format|shared\/errors|shared\/time)|zod|\.\/(access|audit|context|lifecycle|occasions|stationery|stationerykit|suppliers|tx))$/);
  });
});
