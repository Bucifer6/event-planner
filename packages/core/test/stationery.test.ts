import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, occasionMembers, occasions, stationeryVersions } from "@ed/db";
import { newId } from "@ed/shared/ids";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx } from "../src/context";
import { recordRsvp } from "../src/rsvp";
import { addTable, assignSeats, createOwnSpace, getSeatingRoster } from "../src/seating";
import {
  buildStationeryPrintPdf,
  buildStationeryProofPdf,
  defaultStationeryTexts,
  getGuestInvitationStyle,
  getStationeryEditor,
  getStationerySummary,
  getStarterWordings,
  getWordingPreset,
  listPlaceCards,
  markStationeryProofed,
  previewStationery,
  stationeryThumbnail,
  saveStationeryVersion,
  setDigitalInvitation,
  STATIONERY_FIELD_LIMITS,
  STATIONERY_TEXT_FIELDS,
  stillAiGenerated,
  type SaveStationeryInput,
} from "../src/stationery";
import { OCCASION_KINDS } from "@ed/db";
import { translate } from "@ed/i18n";
import { KIND_MOTIFS, KIND_PALETTES, STITCH_CHARTS, STUDIO_PALETTES } from "../src/stationerycollections";
import {
  colourwaysFor,
  COLOURWAYS,
  contrastRatio,
  DESIGN_KEYS,
  getColourway,
  getDesign,
  HOUSE_DESIGN_KEYS,
  layoutPiece,
  mm,
  monogramInitials,
  parseDateText,
  PIECES,
  sceneTextBounds,
  sceneTexts,
  sceneToSvg,
  splitNames,
  stationeryFontFamily,
  STATIONERY_DESIGNS,
  STATIONERY_PIECES,
  transformPath,
  type KitTexts,
} from "../src/stationerykit";
import { as, code, guestCtx, HELPER, household, newOccasion, OUTSIDER, OWNER, PM, seedAccounts } from "./_releasec";

// C-04: the designs render, text is fitted and never leaves the sheet, every save is a
// version, and the print-ready PDF exists only for a version a manager marked as proofed.

let t: TestDb;
let dir: string;

const TEXTS: KitTexts = {
  kicker: "Împreună cu părinții și nașii noștri",
  names: "Ioana & Ștefan",
  wording: "avem deosebita plăcere de a vă invita să fiți alături de noi în ziua în care ne unim destinele",
  date: "Sâmbătă, 12 septembrie 2026",
  time: "ora 17:00",
  venue: "Conacul Țărănesc",
  address: "Str. Învățătorilor 14, Snagov, Ilfov",
  rsvp: "Vă rugăm să ne confirmați prezența până la 15 august",
  saveTheDate: "Rezervați data",
  menuTitle: "Meniu",
  menuBody: "Gustare\nPlatou rece\n\nFel principal\nMușchi de vită\n\nDesert\nTort",
  thanks: "Mulțumim\nVă mulțumim din suflet că ați fost alături de noi.",
};

const HOUSE = Object.fromEntries(HOUSE_DESIGN_KEYS.map((k) => [k, true]));
/** House and collection designs; the occasion templates have their own test (stationerytemplates.test.ts). */
const SHARED_DESIGN_KEYS = DESIGN_KEYS.filter((k) => getDesign(k).range !== "occasion");

const draft = (occasionId: string, over: Partial<SaveStationeryInput> = {}, texts: Partial<KitTexts> = {}): SaveStationeryInput => ({
  occasionId,
  designKey: "classic",
  colourwayKey: "ivoire",
  locale: "ro",
  texts: Object.fromEntries(Object.entries({ ...TEXTS, ...texts }).map(([k, v]) => [k, { value: v }])),
  ...over,
});

/** An occasion with a cuid-style id (the seating domain validates ids strictly). */
async function seatedOccasion(): Promise<string> {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title: "Nunta Ioanei și a lui Ștefan", kind: "nunta", startsAt: new Date("2027-06-12T09:00:00Z") });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

/** Tracked capitals come out of pdftotext letter-spaced; compare without white space. */
const squash = (s: string) => s.replace(/\s+/g, "");

function pdfText(bytes: Uint8Array): string {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, bytes);
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
}
function pdfInfo(bytes: Uint8Array): string {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(file, bytes);
  return execFileSync("pdfinfo", ["-box", "-f", "1", "-l", "1", file], { encoding: "utf8" }) + execFileSync("pdffonts", [file], { encoding: "utf8" });
}

beforeAll(async () => {
  process.env.APP_URL = "https://app.example.test";
  dir = mkdtempSync(join(tmpdir(), "ed-stationery-"));
  t = await setupTestDb();
  await seedAccounts(t);
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});

describe("the stationery kit: designs as data, one layout", () => {
  it("has eight house designs in our two families, each with two or three curated colourways", () => {
    expect(HOUSE_DESIGN_KEYS).toHaveLength(8);
    expect(stationeryFontFamily()).toBe("maison"); // Bodoni Moda + Hanken Grotesk are embedded, not the fallback
    for (const key of HOUSE_DESIGN_KEYS) {
      const d = STATIONERY_DESIGNS[key]!;
      expect(d.range).toBe("house");
      expect(d.colourways.length, key).toBeGreaterThanOrEqual(2);
      expect(d.colourways.length, key).toBeLessThanOrEqual(3);
      for (const c of d.colourways) expect(COLOURWAYS[c], `${key}/${c}`).toBeDefined();
      for (const style of Object.values(d.styles)) expect(style.font).toMatch(/^(display|text)/);
    }
  });

  it("renders every design × piece × colourway with all text inside the safe sheet", () => {
    for (const key of SHARED_DESIGN_KEYS) {
      // the house designs in each of their colourways; a collection design in the first two it offers a wedding
      for (const colourway of colourwaysFor(getDesign(key), "nunta").slice(0, key in HOUSE ? 3 : 2)) {
        for (const piece of STATIONERY_PIECES) {
          const scene = layoutPiece({ design: key, colourway, piece, texts: TEXTS, occasionKind: "nunta", extra: { tableLabel: "12", tableWord: "Masa", placeName: "Alexandra Constantinescu", placeNote: "Masa 12 · +2 copii" } });
          const spec = PIECES[piece];
          expect(scene.width).toBeCloseTo(mm(spec.widthMm), 1);
          expect(scene.truncated, `${key}/${piece}`).toBe(false);
          const [minX, minY, maxX, maxY] = sceneTextBounds(scene);
          const safe = mm(4);
          expect(minX, `${key}/${piece} left`).toBeGreaterThanOrEqual(safe);
          expect(minY, `${key}/${piece} top`).toBeGreaterThanOrEqual(safe);
          expect(maxX, `${key}/${piece} right`).toBeLessThanOrEqual(scene.width - safe);
          expect(maxY, `${key}/${piece} bottom`).toBeLessThanOrEqual(scene.height - safe);
          const svg = sceneToSvg(scene);
          expect(svg.startsWith("<svg")).toBe(true);
          expect(svg).not.toContain("<text"); // outlines: the proof needs no font in the browser
          expect(svg).not.toMatch(/<image|href=|<script/); // no imagery, nothing external
        }
      }
    }
  });

  it("fits text at the field limits: it is set smaller, never overflows, never silently lost", () => {
    const long = (n: number, word: string) => {
      let s = "";
      while (s.length + word.length + 1 <= n) s += `${s ? " " : ""}${word}`;
      return s;
    };
    const maxed: KitTexts = {
      kicker: long(STATIONERY_FIELD_LIMITS.kicker, "Împreună"),
      names: "Alexandra-Ecaterina Constantinescu & Maximilian-Sebastian Dumitrescu-Popa",
      wording: long(STATIONERY_FIELD_LIMITS.wording, "bucurie"),
      date: long(STATIONERY_FIELD_LIMITS.date, "sâmbătă"),
      time: long(STATIONERY_FIELD_LIMITS.time, "ora"),
      venue: long(STATIONERY_FIELD_LIMITS.venue, "Conacul"),
      address: long(STATIONERY_FIELD_LIMITS.address, "Strada"),
      rsvp: long(STATIONERY_FIELD_LIMITS.rsvp, "confirmați"),
      saveTheDate: long(STATIONERY_FIELD_LIMITS.saveTheDate, "data"),
      menuTitle: long(STATIONERY_FIELD_LIMITS.menuTitle, "Meniu"),
      menuBody: Array.from({ length: 8 }, (_, i) => `Felul ${i + 1}\n${long(90, "preparat")}`).join("\n\n"),
      thanks: `Mulțumim\n${long(STATIONERY_FIELD_LIMITS.thanks - 12, "mulțumim")}`,
    };
    for (const key of SHARED_DESIGN_KEYS) {
      for (const piece of STATIONERY_PIECES) {
        const scene = layoutPiece({ design: key, piece, texts: maxed, extra: { tableLabel: "Masa cu un nume foarte lung", placeName: "Alexandra-Ecaterina Constantinescu-Dumitrescu", placeNote: "Masa 12 · +3 copii" } });
        const [minX, minY, maxX, maxY] = sceneTextBounds(scene);
        expect(minX, `${key}/${piece}`).toBeGreaterThanOrEqual(0);
        expect(minY, `${key}/${piece}`).toBeGreaterThanOrEqual(0);
        expect(maxX, `${key}/${piece}`).toBeLessThanOrEqual(scene.width);
        expect(maxY, `${key}/${piece}`).toBeLessThanOrEqual(scene.height);
        expect(scene.fit, `${key}/${piece}`).toBeLessThanOrEqual(1);
      }
    }
    // a single unbreakable word is shrunk until it fits its line
    const scene = layoutPiece({ design: "classic", piece: "place-card", texts: TEXTS, extra: { placeName: "Constantinescuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu" } });
    const [, , maxX] = sceneTextBounds(scene);
    expect(maxX).toBeLessThanOrEqual(scene.width - mm(4));
  });

  it("reads names, initials and dates the way the designs need them", () => {
    expect(splitNames("Ioana & Ștefan")).toEqual({ first: "Ioana", joiner: "&", second: "Ștefan" });
    expect(splitNames("Ana și Mihai")).toEqual({ first: "Ana", joiner: "și", second: "Mihai" });
    expect(splitNames("Petrecerea Mariei")).toBeNull();
    expect(monogramInitials("Ioana & Ștefan")).toEqual(["I", "Ș"]);
    expect(monogramInitials("Țuțuianu Ștefan")).toEqual(["Ț", "Ș"]);
    expect(parseDateText("Sâmbătă, 12 septembrie 2026")).toEqual({ day: 12, month: 9, year: 2026 });
    expect(parseDateText("Saturday, 12 September 2026")).toEqual({ day: 12, month: 9, year: 2026 });
    expect(parseDateText("12.09.2026")).toEqual({ day: 12, month: 9, year: 2026 });
    expect(parseDateText("la toamnă")).toBeNull();
    // Modern sets the date as numerals when it can read it, and as written when it cannot
    expect(sceneTexts(layoutPiece({ design: "modern", piece: "invitation", texts: TEXTS }))).toEqual(expect.arrayContaining(["12", "09", "2026"]));
    expect(sceneTexts(layoutPiece({ design: "modern", piece: "invitation", texts: { ...TEXTS, date: "la toamnă" } }))).not.toContain("12");
  });

  it("offers ro/en wording for a wedding, a christening and an anniversary", () => {
    for (const kind of ["nunta", "botez", "aniversare"] as const) {
      for (const locale of ["ro", "en"] as const) {
        const p = getWordingPreset(kind, locale);
        for (const v of Object.values(p)) {
          expect(v).not.toMatch(/^stationery\./); // every key exists
          expect(v.length).toBeGreaterThan(3);
        }
      }
    }
    expect(getWordingPreset("nunta", "ro").wording).toContain("vă invita");
    const d = defaultStationeryTexts({ title: "Nunta Ioanei", kind: "nunta", startsAt: new Date("2027-06-12T14:00:00Z"), timezone: "Europe/Bucharest", venueName: "Conac", venueAddress: null }, "ro");
    expect(d.date.value).toBe("Sâmbătă, 12 iunie 2027");
    expect(d.time.value).toBe("ora 17:00");
    expect(STATIONERY_TEXT_FIELDS.every((f) => d[f].aiGenerated === false)).toBe(true);
  });
});

describe("the invitation collections", () => {
  it("adds the embroidery, signature, rustic, traditional and composition ranges as designs of the same kit", () => {
    const byRange = (r: string) => DESIGN_KEYS.filter((k) => getDesign(k).range === r);
    expect(byRange("embroidery")).toHaveLength(16);
    expect(byRange("featured")).toHaveLength(6);
    expect(byRange("rustic")).toHaveLength(11);
    expect(byRange("traditional")).toHaveLength(11);
    expect(byRange("collection")).toHaveLength(20);
    for (const key of SHARED_DESIGN_KEYS) {
      for (const locale of ["ro", "en"] as const) expect(translate(locale, `stationery.designs.${key}.name`), key).not.toMatch(/^stationery\./);
      const d = getDesign(key);
      if (d.range === "house") continue;
      // every collection design draws artwork, not only text
      const scene = layoutPiece({ design: key, piece: "invitation", texts: TEXTS, occasionKind: "nunta" });
      expect(scene.nodes.filter((n) => n.t === "path").length, key).toBeGreaterThan(0);
      for (const c of colourwaysFor(d, "nunta")) expect(COLOURWAYS[c], `${key}/${c}`).toBeDefined();
    }
    expect(Object.keys(STITCH_CHARTS)).toEqual(DESIGN_KEYS.filter((k) => getDesign(k).range === "embroidery"));
  });

  it("every occasion kind has its five palettes (plus the studio five), a motif and ten starter wordings in both languages", () => {
    for (const kind of OCCASION_KINDS) {
      expect(KIND_PALETTES[kind], kind).toHaveLength(5);
      expect(KIND_MOTIFS[kind], kind).toMatch(/^[Mm]/);
      expect(colourwaysFor(getDesign("frame"), kind)).toHaveLength(10);
      expect(colourwaysFor(getDesign("frame"), kind)).toEqual(expect.arrayContaining([...STUDIO_PALETTES]));
      for (const locale of ["ro", "en"] as const) {
        const starters = getStarterWordings(kind, locale);
        expect(starters, kind).toHaveLength(10);
        for (const s of starters) expect(s.text, `${kind}.${s.key}`).not.toMatch(/^stationery\./);
      }
    }
    // a signature edition opens on its own palette of the kind's five
    expect(colourwaysFor(getDesign("botanical-edition"), "nunta")[0]).toBe(KIND_PALETTES.nunta![2]);
    // a kind the collections never heard of gets the general set
    expect(getStarterWordings("necunoscut", "ro")).toEqual(getStarterWordings("blank", "ro"));
  });

  it("every colourway reads: ink and muted text meet AA on the paper, and a dark sheet's accent does too", () => {
    for (const [key, cw] of Object.entries(COLOURWAYS)) {
      expect(contrastRatio(cw.ink, cw.paper), `${key} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(cw.muted, cw.paper), `${key} muted`).toBeGreaterThanOrEqual(4.5);
      if (cw.dark && !(HOUSE_DESIGN_KEYS as string[]).some((d) => STATIONERY_DESIGNS[d]!.colourways.includes(key))) {
        expect(contrastRatio(cw.accent, cw.paper), `${key} accent`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // the Deco edition prints its palette the other way round, and still reads
    const inverted = getColourway(getDesign("deco-edition"), KIND_PALETTES.nunta![1]);
    expect(inverted.paper).toBe(COLOURWAYS[KIND_PALETTES.nunta![1]!]!.ink);
    expect(contrastRatio(inverted.muted, inverted.paper)).toBeGreaterThanOrEqual(4.5);
    // a colourway from outside the design's set falls back to its first
    expect(getColourway(getDesign("maramures-gate"), "ivoire").key).toBe("maramures-oak");
  });

  it("stretches artwork over a sheet without losing a command, relative or absolute", () => {
    expect(transformPath("M10 10h20v10H10Z", 2, 3)).toBe("M20 30L60 30L60 60L20 60Z");
    expect(transformPath("M0 0l5 5m10 0q5 5 10 0t10 0", 1, 1, 100, 0)).toBe("M100 0L105 5M115 5Q120 10 125 5T135 5");
    expect(transformPath("M0 0c1 1 2 2 3 3s4 4 5 5a2 2 0 0 1 4 0", 2, 2)).toBe("M0 0C2 2 4 4 6 6S14 14 16 16A4 4 0 0 1 24 16");
  });

  it("artwork stays on the sheet in the proof, and the text keeps clear of it", () => {
    const scene = layoutPiece({ design: "imprint", piece: "invitation", texts: TEXTS, occasionKind: "nunta" });
    const svg = sceneToSvg(scene);
    expect(svg).toMatch(/<svg width="[\d.]+" height="[\d.]+" viewBox="0 0 [\d.]+ [\d.]+" overflow="hidden">/);
    // Split keeps the text to the right of its panel; Column sets it ragged-left against the right margin
    const [splitLeft] = sceneTextBounds(layoutPiece({ design: "split", piece: "invitation", texts: TEXTS, occasionKind: "nunta" }));
    expect(splitLeft).toBeGreaterThan(scene.width * 0.3);
    const column = layoutPiece({ design: "column", piece: "invitation", texts: TEXTS, occasionKind: "nunta" });
    const rights = column.nodes.filter((n) => n.t === "text").map((n) => (n.t === "text" ? n.x + n.width : 0));
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThan(1);
  });

  it("saves a collection design in one of the occasion's palettes, refuses a palette from another set, and thumbnails it", async () => {
    const occ = await newOccasion(t);
    const kind = (await getStationeryEditor(as(t, OWNER), occ)).occasion.kind;
    const palette = colourwaysFor(getDesign("frame"), kind)[3]!;
    expect(await saveStationeryVersion(as(t, OWNER), draft(occ, { designKey: "frame", colourwayKey: palette }))).toEqual({ version: 1, created: true });
    expect(await saveStationeryVersion(as(t, OWNER), draft(occ, { designKey: "muscel-check", colourwayKey: "stitched-linen" }))).toEqual({ version: 2, created: true });
    expect(await code(() => saveStationeryVersion(as(t, OWNER), draft(occ, { designKey: "maramures-gate", colourwayKey: palette })))).toBe("VALIDATION:common.errors.VALIDATION");
    const proof = await buildStationeryProofPdf(as(t, HELPER), { occasionId: occ });
    expect(pdfText(proof.bytes)).toContain("Ioana");
    const thumb = await stationeryThumbnail(as(t, HELPER), occ, "maramures-gate");
    expect(thumb.startsWith("<svg")).toBe(true);
    expect(thumb).not.toContain("<text");
    expect(await code(() => stationeryThumbnail(as(t, OUTSIDER), occ, "frame"))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
    expect(await code(() => stationeryThumbnail(as(t, OWNER), occ, "../x"))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });
});

describe("versions and the proof gate", () => {
  it("every save is a new version; saving the same thing again is not", async () => {
    const occ = await newOccasion(t);
    const first = await saveStationeryVersion(as(t, OWNER), draft(occ));
    expect(first).toEqual({ version: 1, created: true });
    expect(await saveStationeryVersion(as(t, OWNER), draft(occ))).toEqual({ version: 1, created: false });
    expect(await saveStationeryVersion(as(t, PM), draft(occ, {}, { time: "ora 18:00" }))).toEqual({ version: 2, created: true });
    expect(await saveStationeryVersion(as(t, OWNER), draft(occ, { colourwayKey: "nuit" }, { time: "ora 18:00" }))).toEqual({ version: 3, created: true });
    const editor = await getStationeryEditor(as(t, HELPER), occ);
    expect(editor.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(editor.current?.texts.time.value).toBe("ora 18:00");
    expect(editor.canManage).toBe(false);
    // contributors read, only managers save; strangers see nothing
    expect(await code(() => saveStationeryVersion(as(t, HELPER), draft(occ)))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => getStationeryEditor(as(t, OUTSIDER), occ))).toMatch(/^(FORBIDDEN|NOT_FOUND)/);
    // validation: names are needed, a foreign colourway is refused, over-long text names its field
    expect(await code(() => saveStationeryVersion(as(t, OWNER), draft(occ, {}, { names: "  " })))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await code(() => saveStationeryVersion(as(t, OWNER), draft(occ, { colourwayKey: "terracotta" })))).toBe("VALIDATION:common.errors.VALIDATION");
    expect(await code(() => saveStationeryVersion(as(t, OWNER), draft(occ, {}, { kicker: "x".repeat(200) })))).toBe("VALIDATION:common.errors.VALIDATION");
    // a closed occasion is read-only
    const closed = await newOccasion(t, { status: "closed", closedAt: new Date("2027-02-01T00:00:00Z") });
    expect(await code(() => saveStationeryVersion(as(t, OWNER), draft(closed)))).toBe("CONFLICT:lifecycle.errors.closed");
  });

  it("a print-ready PDF exists ONLY for a version a manager marked as proofed; any change is a new unproofed version", async () => {
    const occ = await newOccasion(t);
    await saveStationeryVersion(as(t, OWNER), draft(occ));
    // the proof can be read by any planning member, and says what it is
    const proof = await buildStationeryProofPdf(as(t, HELPER), { occasionId: occ });
    const proofText = pdfText(proof.bytes);
    expect(squash(proofText)).toContain("PROBĂ·VERSIUNEA1");
    expect(proofText).toContain("Ioana");
    // the gate
    expect(await code(() => buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ }))).toBe("CONFLICT:stationery.errors.notProofed");
    // a contributor cannot mark the proof, a manager can; marking twice changes nothing
    expect(await code(() => markStationeryProofed(as(t, HELPER), { occasionId: occ, version: 1 }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    const marked = await markStationeryProofed(as(t, PM), { occasionId: occ, version: 1 });
    expect((await markStationeryProofed(as(t, OWNER), { occasionId: occ, version: 1 })).proofedAt).toEqual(marked.proofedAt);
    const [row] = await t.db.select().from(stationeryVersions).where(eq(stationeryVersions.occasionId, occ));
    expect(row!.proofedByAccountId).toBe(PM);

    const print = await buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ, pieces: ["invitation", "menu"], cropMarks: true });
    expect(print.filename).toMatch(/-tipar-v1\.pdf$/);
    const text = pdfText(print.bytes);
    expect(text).toContain("Ștefan"); // live text with Romanian glyphs, not an image
    expect(squash(text)).toContain("ÎMPREUNĂCUPĂRINȚIIȘINAȘIINOȘTRI");
    expect(squash(text)).toContain("148×210mm");
    expect(text).toContain("RGB");
    const info = pdfInfo(print.bytes);
    // A5 trim + 3 mm bleed + 8 mm slug on each side; TrimBox is the exact trim, BleedBox 3 mm outside it
    const pt = (v: number) => (v * 72) / 25.4;
    const size = /Page\s+1 size:\s+([\d.]+) x ([\d.]+)/.exec(info)!;
    expect(Number(size[1])).toBeCloseTo(pt(148 + 22), 0);
    expect(Number(size[2])).toBeCloseTo(pt(210 + 22), 0);
    expect(info).toMatch(/Page\s+1 TrimBox:\s+31\.18\s+31\.18\s+450\.7\d\s+626\.4\d/);
    expect(info).toMatch(/Page\s+1 BleedBox:\s+22\.68\s+22\.68\s+459\.2\d\s+634\.9\d/);
    expect(info).toMatch(/BodoniModa-Regular\s+CID TrueType\s+Identity-H\s+yes yes/); // embedded + subset
    expect(info).toMatch(/HankenGrotesk/);
    // contributors do not make print files; an assistant token never does
    expect(await code(() => buildStationeryPrintPdf(as(t, HELPER), { occasionId: occ }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    expect(await code(() => buildStationeryPrintPdf(makeCtx(t.db, { kind: "mcp", accountId: OWNER, tokenId: "tok", scope: "read_propose" }), { occasionId: occ }))).toMatch(/^FORBIDDEN/);

    // changing ANYTHING — here one comma — makes version 2, which is not proofed
    expect(await saveStationeryVersion(as(t, OWNER), draft(occ, {}, { rsvp: "Vă rugăm să ne confirmați prezența, până la 15 august" }))).toEqual({ version: 2, created: true });
    expect(await code(() => buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ }))).toBe("CONFLICT:stationery.errors.notProofed");
    expect(await code(() => buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ, version: 2 }))).toBe("CONFLICT:stationery.errors.notProofed");
    // version 1 stays printable: it is what was checked
    expect((await buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ, version: 1, pieces: ["invitation"] })).bytes.length).toBeGreaterThan(5000);
    expect((await getStationerySummary(as(t, OWNER), occ)).proofed).toBe(false);
  });

  it("a saved version cannot be rewritten in the database, and a proof mark cannot be moved", async () => {
    const occ = await newOccasion(t);
    await saveStationeryVersion(as(t, OWNER), draft(occ));
    await expect(t.db.update(stationeryVersions).set({ designKey: "modern" }).where(eq(stationeryVersions.occasionId, occ))).rejects.toThrow();
    await markStationeryProofed(as(t, OWNER), { occasionId: occ, version: 1 });
    await expect(t.db.update(stationeryVersions).set({ proofedAt: new Date("2030-01-01T00:00:00Z") }).where(eq(stationeryVersions.occasionId, occ))).rejects.toThrow();
  });

  it("the live preview draws an unsaved draft and stores nothing", async () => {
    const occ = await newOccasion(t);
    const before = (await t.db.select().from(stationeryVersions)).length;
    const [p] = await previewStationery(as(t, OWNER), { ...draft(occ), designKey: "botanical", colourwayKey: "sauge", pieces: ["invitation"] });
    expect(p!.svg).toContain(COLOURWAYS.sauge!.paper);
    expect(p!.widthMm).toBe(148);
    expect((await t.db.select().from(stationeryVersions)).length).toBe(before);
    expect(await code(() => previewStationery(makeCtx(t.db, { kind: "anonymous" }), draft(occ)))).toMatch(/^UNAUTHENTICATED/);
  });
});

describe("the AI label stays with AI text until it is substantially rewritten (INF7)", () => {
  it("keeps the label through light edits and across versions, drops it after a rewrite", async () => {
    const suggestion = "Ne-ar face mare bucurie să vă avem alături la nunta noastră. Vă așteptăm cu drag, Ioana și Ștefan.";
    expect(stillAiGenerated(suggestion, suggestion)).toBe(true);
    expect(stillAiGenerated(suggestion, suggestion.replace("mare bucurie", "o mare bucurie"))).toBe(true);
    expect(stillAiGenerated(suggestion, "Dragii noștri, vă chemăm la o seară de vară în grădina bunicilor.")).toBe(false);
    expect(stillAiGenerated(null, suggestion)).toBe(false);

    const occ = await newOccasion(t);
    const input = draft(occ);
    input.texts.wording = { value: suggestion, aiOriginal: suggestion };
    await saveStationeryVersion(as(t, OWNER), input);
    let summary = await getStationerySummary(as(t, OWNER), occ);
    expect(summary.texts.find((x) => x.field === "wording")).toMatchObject({ aiGenerated: true });
    expect(summary.texts.find((x) => x.field === "names")).toMatchObject({ aiGenerated: false });
    // a light edit saved WITHOUT the client repeating the original: the label is carried forward
    await saveStationeryVersion(as(t, OWNER), draft(occ, {}, { wording: suggestion.replace("cu drag", "cu mult drag") }));
    summary = await getStationerySummary(as(t, OWNER), occ);
    expect(summary.version).toBe(2);
    expect(summary.texts.find((x) => x.field === "wording")!.aiGenerated).toBe(true);
    // a substantial rewrite makes it the user's own text
    await saveStationeryVersion(as(t, OWNER), draft(occ, {}, { wording: "Dragii noștri, vă chemăm la o seară de vară în grădina bunicilor." }));
    summary = await getStationerySummary(as(t, OWNER), occ);
    expect(summary.texts.find((x) => x.field === "wording")!.aiGenerated).toBe(false);
  });
});

describe("pieces from the seating plan and the digital invitation", () => {
  it("place cards name adults only; children ride as a count on the household's first card", async () => {
    const occ = await seatedOccasion();
    const pop = await household(t, occ, "Popescu");
    const ion = await household(t, occ, "Ionescu");
    await recordRsvp(as(t, OWNER), { householdId: pop.householdId, attending: "yes", adultsCount: 2, childrenCount: 2 });
    await recordRsvp(as(t, OWNER), { householdId: ion.householdId, attending: "no", adultsCount: 0, childrenCount: 0 });
    await createOwnSpace(as(t, OWNER), { occasionId: occ, name: "Salon", widthMm: 12_000, lengthMm: 9000 });
    const table = await addTable(as(t, OWNER), { occasionId: occ, custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 } });
    const roster = await getSeatingRoster(as(t, OWNER), occ);
    const popRow = roster.find((h) => h.householdId === pop.householdId)!;
    await assignSeats(as(t, OWNER), { occasionId: occ, tableItemId: table.id, guestIds: popRow.adults.map((a) => a.guestId), groups: [{ householdId: pop.householdId, kind: "children" }] });

    const cards = await listPlaceCards(as(t, OWNER), occ, "ro");
    // the household that declined has no card; no card is named after a child
    expect(cards.map((c) => c.name).sort()).toEqual(["Popescu Doi", "Popescu Unu"]);
    expect(cards.map((c) => c.note).sort()).toEqual([`Masa ${table.label}`, `Masa ${table.label} · +2 copii`]);

    await saveStationeryVersion(as(t, OWNER), draft(occ));
    await markStationeryProofed(as(t, OWNER), { occasionId: occ, version: 1 });
    const pdf = await buildStationeryPrintPdf(as(t, OWNER), { occasionId: occ, pieces: ["place-card", "table-card"], cropMarks: false });
    const text = pdfText(pdf.bytes);
    expect(text).toContain("Popescu Unu");
    expect(squash(text)).toContain("+2COPII");
    expect(text).not.toContain("Ionescu");
    expect(squash(text)).toContain("MASA");
    // without crop marks the page is exactly trim + bleed
    const size = /Page\s+1 size:\s+([\d.]+) x ([\d.]+)/.exec(pdfInfo(pdf.bytes))!; // 90+6 × 55+6 mm
    expect(Number(size[1])).toBeCloseTo((96 * 72) / 25.4, 0);
    expect(Number(size[2])).toBeCloseTo((61 * 72) / 25.4, 0);
  });

  it("the guest link adopts a version's wording and colourway only when a manager says so", async () => {
    const occ = await newOccasion(t);
    const h = await household(t, occ, "Popescu");
    const guest = await guestCtx(t, h.token);
    expect(await getGuestInvitationStyle(guest)).toBeNull();
    expect(await code(() => setDigitalInvitation(as(t, OWNER), { occasionId: occ, enabled: true }))).toBe("CONFLICT:stationery.errors.saveFirst");
    await saveStationeryVersion(as(t, OWNER), draft(occ, { designKey: "nocturne", colourwayKey: "minuit" }));
    expect(await code(() => setDigitalInvitation(as(t, HELPER), { occasionId: occ, enabled: true }))).toBe("FORBIDDEN:common.errors.FORBIDDEN");
    await setDigitalInvitation(as(t, OWNER), { occasionId: occ, enabled: true });
    expect(await getGuestInvitationStyle(guest)).toMatchObject({ designKey: "nocturne", names: "Ioana & Ștefan", colours: { paper: COLOURWAYS.minuit!.paper, dark: true } });
    // a later save moves the guest link to the new wording
    await saveStationeryVersion(as(t, OWNER), draft(occ, { designKey: "nocturne", colourwayKey: "minuit" }, { kicker: "Cu drag" }));
    expect((await getGuestInvitationStyle(guest))!.kicker).toBe("Cu drag");
    await setDigitalInvitation(as(t, OWNER), { occasionId: occ, enabled: false });
    expect(await getGuestInvitationStyle(guest)).toBeNull();
    // only the guest of THIS occasion's link may ask
    expect(await code(() => getGuestInvitationStyle(as(t, OWNER)))).toBe("NOT_FOUND:common.errors.NOT_FOUND");
  });
});
