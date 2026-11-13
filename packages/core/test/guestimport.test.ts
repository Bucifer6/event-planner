import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accounts, eq, guests, households, invitations, occasionMembers, occasions, sql } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountCtx, type Ctx } from "../src/context";
import {
  getImportPreview,
  parseCsv,
  parseGuestFile,
  planImport,
  proposeGuestImport,
  remapGuestImport,
  suggestMapping,
  summarisePlan,
} from "../src/guestimport";
import { createHousehold } from "../src/guests";
import { confirmPreview, discardPreview } from "../src/whatif";

let t: TestDb;
const OWNER = "acc_owner_i";
const HELPER = "acc_helper_i";
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner-i@example.test" },
    { id: HELPER, kind: "email", email: "helper-i@example.test" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const owner = (): Ctx => accountCtx(t.db, OWNER);
async function newOccasion(): Promise<string> {
  const id = `occ_i_${++seq}`;
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title: "Botez", kind: "botez" });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}
const snapshot = async (occ: string) =>
  JSON.stringify([
    (await t.db.execute(sql`SELECT id, name, lead_email, expected_party_size FROM households WHERE occasion_id = ${occ} ORDER BY id`)).rows,
    (await t.db.execute(sql`SELECT household_id, full_name FROM guests WHERE occasion_id = ${occ} ORDER BY id`)).rows,
    (await t.db.execute(sql`SELECT household_id FROM invitations WHERE occasion_id = ${occ} ORDER BY id`)).rows,
  ]);
const bytes = (s: string) => new TextEncoder().encode(s);

const CSV =
  "﻿Familie;Nume;Email;Persoane;Observații\r\n" +
  'Familia Popescu;Ana Popescu;ana@example.test;4;"vin cu mașina; ajung târziu"\r\n' +
  "Familia Popescu;Dan Popescu;;;\r\n" +
  "familia  popescu;ANA POPESCU;;;\r\n" + // duplicate inside the file (case/space-insensitive)
  'Familia Ionescu;"Ionescu, Maria ""Mia""";mia@example.test;2;\r\n' +
  "Familia Șerban;Ștefan Șerban;not-an-email;;\r\n" +
  ";;;;\r\n" +
  "Familia Dinu;Matei, 7 ani;;;\r\n"; // child details: refused

describe("guest list import (A13)", () => {
  it("parses CSV with ; or , separators, quotes, BOM and diacritics", async () => {
    const table = await parseGuestFile({ name: "invitati.csv", bytes: bytes(CSV) });
    expect(table.headers).toEqual(["Familie", "Nume", "Email", "Persoane", "Observații"]);
    expect(table.rows).toHaveLength(6); // the empty row is dropped
    expect(table.rows[0]![4]).toBe("vin cu mașina; ajung târziu");
    expect(table.rows[3]![1]).toBe('Ionescu, Maria "Mia"');
    expect(table.rows[4]![0]).toBe("Familia Șerban");
    expect(parseCsv('name,email\n"Pop, Ion",ion@example.test\n')).toEqual([
      ["name", "email"],
      ["Pop, Ion", "ion@example.test"],
    ]);
    // windows-1250 bytes (old Excel export) still give diacritics
    const legacy = Uint8Array.from([0x4e, 0x75, 0x6d, 0x65, 0x0a, 0xaa, 0x74, 0x65, 0x66, 0x61, 0x6e, 0x0a]);
    expect((await parseGuestFile({ name: "a.csv", bytes: legacy })).rows[0]![0]).toBe("Ştefan".normalize("NFC"));
  });

  it("reads XLSX and suggests the mapping from ro/en headers; child columns are refused", async () => {
    const file = readFileSync(join(__dirname, "fixtures", "guests.xlsx"));
    const table = await parseGuestFile({ name: "guests.xlsx", bytes: new Uint8Array(file) });
    expect(table.headers).toEqual(["Familie", "Nume și prenume", "E-mail", "Limba", "Nr. persoane", "Vârstă"]);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]!.slice(0, 5)).toEqual(["Familia Țăranu", "Ștefan Țăranu", "stefan@example.test", "ro", "3"]);
    const { mapping, childColumns } = suggestMapping(table.headers);
    expect(mapping).toEqual({ household: 0, name: 1, email: 2, language: 3, partySize: 4 });
    expect(childColumns).toEqual([5]);
    expect(suggestMapping(["Full name", "Email address", "Date of birth", "Notes"])).toEqual({
      mapping: { name: 0, email: 1, notes: 3 },
      childColumns: [2],
    });

    const occ = await newOccasion();
    let err: unknown;
    await proposeGuestImport(owner(), { occasionId: occ, table, mapping: { ...mapping, notes: 5 } }).catch((e) => (err = e));
    expect(isAppError(err) && err.messageKey).toBe("guests.import.errors.childColumn");
    expect(isAppError(err) && err.details?.fieldErrors).toEqual({ map_notes: ["guests.import.errors.childColumn"] });

    const preview = await proposeGuestImport(owner(), { occasionId: occ, table, mapping });
    await confirmPreview(owner(), preview.id);
    const rows = await t.db.select().from(households).where(eq(households.occasionId, occ));
    expect(rows.map((h) => [h.name, h.language, h.expectedPartySize, h.leadEmail]).sort()).toEqual([
      ["Familia Țăranu", "ro", 3, "stefan@example.test"],
      ["The Browns", "en", 2, "emma@example.test"],
    ]);
    // the age column went nowhere
    const dump = JSON.stringify((await t.db.execute(sql`SELECT * FROM households WHERE occasion_id = ${occ}`)).rows);
    expect(dump).not.toContain("41");
  });

  it("shows a create / change / skip diff, applies exactly it on confirm, and cancel changes nothing", async () => {
    const occ = await newOccasion();
    const existing = await createHousehold(owner(), { occasionId: occ, name: "familia popescu", guestNames: ["Ana Popescu"] });
    const table = await parseGuestFile({ name: "invitati.csv", bytes: bytes(CSV) });
    const { mapping } = suggestMapping(table.headers);
    expect(mapping).toEqual({ household: 0, name: 1, email: 2, partySize: 3, notes: 4 });

    const before = await snapshot(occ);
    const preview = await proposeGuestImport(owner(), { occasionId: occ, fileName: "invitati.csv", table, mapping });
    const view = await getImportPreview(owner(), preview.id);
    expect(view.summary).toEqual({ create: 2, change: 1, skip: 4 });
    const input = preview.input as { plan: Array<Record<string, unknown>> };
    expect(input.plan.filter((p) => p.action !== "skip")).toEqual([
      // existing household matched by name (case/diacritics-insensitive): only what is new changes
      { action: "change", householdId: existing.householdId, name: "familia popescu", addAdults: ["Dan Popescu"], email: "ana@example.test", partySize: 4 },
      { action: "create", name: "Familia Ionescu", adults: ['Ionescu, Maria "Mia"'], email: "mia@example.test", partySize: 2 },
      { action: "create", name: "Familia Șerban", adults: ["Ștefan Șerban"] },
    ]);
    expect(input.plan.filter((p) => p.action === "skip").map((p) => p.reason).sort()).toEqual([
      "badEmail",
      "childDetails",
      "duplicate",
      "duplicate",
    ]);
    expect(preview.delta.length).toBe(7);
    // a preview changes nothing…
    expect(await snapshot(occ)).toBe(before);
    // …and neither does cancelling
    await discardPreview(owner(), preview.id);
    expect(await snapshot(occ)).toBe(before);
    let err: unknown;
    await confirmPreview(owner(), preview.id).catch((e) => (err = e));
    expect(isAppError(err)).toBe(true);
    expect(await snapshot(occ)).toBe(before);

    // a new preview, confirmed (twice): applied exactly once
    const again = await proposeGuestImport(owner(), { occasionId: occ, table, mapping });
    const [r1, r2] = await Promise.all([confirmPreview(owner(), again.id), confirmPreview(owner(), again.id)]);
    expect([r1.appliedNow, r2.appliedNow].filter(Boolean)).toHaveLength(1);
    const hs = await t.db.select().from(households).where(eq(households.occasionId, occ));
    expect(hs.map((h) => h.name).sort()).toEqual(["Familia Ionescu", "Familia Șerban", "familia popescu"]);
    const popescu = hs.find((h) => h.id === existing.householdId)!;
    expect([popescu.leadEmail, popescu.expectedPartySize]).toEqual(["ana@example.test", 4]);
    const gs = await t.db.select().from(guests).where(eq(guests.occasionId, occ));
    expect(gs.map((g) => g.fullName).sort()).toEqual(["Ana Popescu", "Dan Popescu", 'Ionescu, Maria "Mia"', "Ștefan Șerban"]);
    expect(gs.some((g) => /Matei/.test(g.fullName))).toBe(false);
    // every imported household got its own invitation
    expect(await t.db.select().from(invitations).where(eq(invitations.occasionId, occ))).toHaveLength(3);

    // importing the same file again: everything is a duplicate, nothing to create
    const third = await proposeGuestImport(owner(), { occasionId: occ, table, mapping });
    expect(summarisePlan((third.input as { plan: never[] }).plan)).toMatchObject({ create: 0, change: 0 });
  });

  it("refuses a stale preview, lets the planner re-map, and is for managers only", async () => {
    const occ = await newOccasion();
    const table = await parseGuestFile({ name: "a.csv", bytes: bytes("Invitat,Grup\nAna Pop,Colegi\nDan Pop,Colegi\n") });
    const { mapping } = suggestMapping(table.headers);
    expect(mapping).toEqual({ name: 0, household: 1 });
    const preview = await proposeGuestImport(owner(), { occasionId: occ, table, mapping });
    await createHousehold(owner(), { occasionId: occ, name: "Adăugat între timp" });
    let err: unknown;
    await confirmPreview(owner(), preview.id).catch((e) => (err = e));
    expect(isAppError(err) && err.code).toBe("CONFLICT");
    expect(await t.db.select().from(households).where(eq(households.occasionId, occ))).toHaveLength(1);

    // re-map: each person becomes their own household; the old preview is dropped
    const remapped = await remapGuestImport(owner(), { previewId: preview.id, mapping: { name: 0 } });
    expect((await getImportPreview(owner(), remapped.id)).summary).toEqual({ create: 2, change: 0, skip: 0 });
    await confirmPreview(owner(), remapped.id);
    expect(await t.db.select().from(households).where(eq(households.occasionId, occ))).toHaveLength(3);

    await proposeGuestImport(accountCtx(t.db, HELPER), { occasionId: occ, table, mapping }).catch((e) => (err = e));
    expect(isAppError(err) && err.code).toBe("FORBIDDEN");
    // pure planner: a file with no usable column is refused
    expect(planImport({ headers: ["x"], rows: [["y"]] }, {}, { households: [], guests: [] })).toEqual([
      { action: "skip", name: "", reason: "noName" },
    ]);
  });
});
