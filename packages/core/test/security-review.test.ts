import {
  accounts,
  budgetCategories,
  eq,
  expenses,
  guests,
  households,
  invitations,
  menus,
  occasionMembers,
  paymentDeadlines,
  planItems,
  programmeItems,
  rateLimitBuckets,
  sessions,
  suppliers,
  tasks,
} from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { ZodError } from "zod";
import { getMember } from "../src/access";
import { addCategories, removeCategory } from "../src/budget";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { saveNeed, removeNeed } from "../src/contributions";
import { pdfRasteriserArgs, PDF_RASTER_LONG_SIDE_PX } from "../src/drawings";
import { createExpense, deleteExpense, getExpense } from "../src/expenses";
import { csvCell, listExports, runExport } from "../src/exports";
import { assertXlsxWithinLimits, IMPORT_MAX_BYTES, IMPORT_MAX_UNPACKED_BYTES, parseGuestFile } from "../src/guestimport";
import { addGuest, createHousehold, exportGuestsCsv, getHousehold, removeGuest, updateHousehold } from "../src/guests";
import { getGuestView, regenerateInvitation, resolveGuestLink, revokeInvitation } from "../src/invitations";
import { verifyInvoicingWebhookSecret } from "../src/invoicing";
import { saveMenu, removeMenu } from "../src/menus";
import { removeMember, updateMember } from "../src/members";
import { createOccasion } from "../src/occasions";
import { addPaymentDeadline, listPaymentDeadlines, proposeMovePayment, removePaymentDeadline } from "../src/payments";
import { removeProgrammeItem, saveProgrammeItem } from "../src/programme";
import { rotateQrId } from "../src/qr";
import { enforceRateLimit, ipRateLimitKey } from "../src/ratelimit";
import { getGuestRequests, submitGuestRequest } from "../src/requests";
import { recordRsvp, submitRsvp } from "../src/rsvp";
import { addTable, assignSeats, createOwnSpace, getSeatingEditor, getSpaceModel, moveItem, removeItem, updateItem } from "../src/seating";
import { planToSvgString } from "../src/spacemodel";
import { getStationeryEditor, previewStationery } from "../src/stationery";
import { createSupplier, createSupplierLink, getSupplier, updateSupplier } from "../src/suppliers";
import { createTask, deleteTask, getTask, setTaskStatus, updateTask } from "../src/tasks";
import { confirmPreview, discardPreview, getPreview } from "../src/whatif";
import "../src/all";

// Regression tests of the security review of 14 November 2026 (docs/build/12-security-review.md).
// Each `describe` names the finding (F-nn) or the "verified, no finding" check (V-nn) it covers.

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const NOW = new Date("2027-02-01T08:00:00.000Z");

/** "OK", an AppError code, or INPUT for a zod failure (which would prove nothing about access). */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    if (isAppError(e)) return e.code;
    if (e instanceof ZodError) return "INPUT";
    throw e;
  }
}
const DENIED = ["NOT_FOUND", "FORBIDDEN"];

async function makeAccount(): Promise<string> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `${id}@example.ro` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: NOW, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000), freshAuthAt: NOW });
  return id;
}
const as = (accountId: string): Ctx => accountCtx(t.db, accountId, { now: NOW });
const key = () => newId();

type World = Awaited<ReturnType<typeof world>>;

/** One occasion of `owner`, populated across the domains. */
async function world(owner: string, title = "Nunta Ioanei") {
  const ctx = as(owner);
  const occasion = await createOccasion(ctx, { title, kind: "nunta", dateMode: "date", startsOn: "2027-06-12" });
  const occ = occasion.id;
  const task = await createTask(ctx, { occasionId: occ, title: "Rezervă sala", dueOn: "2027-05-01" });
  const hh = await createHousehold(ctx, { occasionId: occ, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"], leadEmail: "ana@example.ro" });
  const [guest] = await t.db.select().from(guests).where(eq(guests.householdId, hh.householdId));
  const sup = await createSupplier(ctx, { occasionId: occ, name: "Formația Allegro", categoryLabel: "Muzică" });
  const [category] = await addCategories(ctx, { occasionId: occ, categories: [{ name: "Sală", estimateMinor: 1_000_000 }] });
  const expense = await createExpense(ctx, { occasionId: occ, categoryId: category!.id, description: "Avans sală", amountMinor: 500_000, spentOn: "2027-01-15", idempotencyKey: key() });
  const { deadlineId } = await addPaymentDeadline(ctx, { bookingId: sup.bookingId, kind: "advance", dueOn: "2027-03-01", amount: "3.000" });
  const item = await saveProgrammeItem(ctx, { occasionId: occ, title: "Cununia", time: "16:00", kind: "ceremony", durationMin: "60" } as never);
  const menu = await saveMenu(ctx, { occasionId: occ, name: "Cina" });
  await createOwnSpace(ctx, { occasionId: occ, name: "Salon" });
  const table = await addTable(ctx, { occasionId: occ, custom: { name: "Masă rotundă", shape: "round", diameterMm: 1800, seats: 10 } });
  const need = await saveNeed(ctx, { occasionId: occ, title: "Prăjituri", unitsNeeded: 4 } as never);
  const me = (await getMember(ctx, occ))!;
  return { owner, ctx, occ, task, hh, guestId: guest!.id, sup, categoryId: category!.id, expenseId: expense.id, deadlineId, itemId: item.itemId, menuId: menu.menuId, tableId: table.id, needId: need.needId, ownerMemberId: me.id };
}

async function addMember(occasionId: string, role: "pm" | "contributor" | "workstream_lead", grants: { finance?: boolean; privateRequests?: boolean } = {}) {
  const accountId = await makeAccount();
  const [row] = await t.db
    .insert(occasionMembers)
    .values({ occasionId, accountId, role, grantFinance: grants.finance ?? false, grantPrivateRequests: grants.privateRequests ?? false })
    .returning({ id: occasionMembers.id });
  return { accountId, memberId: row!.id, ctx: as(accountId) };
}

/* ── V-01: IDOR — ids of another occasion, with and without the attacker's own occasion id ── */

describe("V-01 cross-occasion access by id (IDOR sweep)", () => {
  let mine: World; // the attacker's own occasion: they are its owner
  let theirs: World; // the victim's
  beforeAll(async () => {
    mine = await world(await makeAccount(), "Petrecerea mea");
    theirs = await world(await makeAccount(), "Nunta lor");
  });

  it("an owner of one occasion is refused on every object of another — reads and writes, 30+ entry points", async () => {
    const a = mine.ctx;
    const v = theirs;
    const attempts: Record<string, () => Promise<unknown>> = {
      // tasks
      "tasks.getTask": () => getTask(a, v.task.id),
      "tasks.updateTask": () => updateTask(a, { taskId: v.task.id, title: "pwned" } as never),
      "tasks.setTaskStatus": () => setTaskStatus(a, { taskId: v.task.id, status: "done" }),
      "tasks.deleteTask": () => deleteTask(a, { taskId: v.task.id }),
      // guests / invitations / RSVP
      "guests.getHousehold": () => getHousehold(a, v.hh.householdId),
      "guests.updateHousehold": () => updateHousehold(a, { householdId: v.hh.householdId, name: "pwned" } as never),
      "guests.addGuest": () => addGuest(a, { householdId: v.hh.householdId, fullName: "Intrus" }),
      "guests.removeGuest": () => removeGuest(a, { guestId: v.guestId }),
      "guests.exportGuestsCsv": () => exportGuestsCsv(a, { occasionId: v.occ, labels: {} as never, formatDate: String }),
      "invitations.regenerate": () => regenerateInvitation(a, { householdId: v.hh.householdId } as never),
      "invitations.revoke": () => revokeInvitation(a, { householdId: v.hh.householdId }),
      "qr.rotateQrId": () => rotateQrId(a, { householdId: v.hh.householdId }),
      "rsvp.recordRsvp": () => recordRsvp(a, { householdId: v.hh.householdId, attending: "no" } as never),
      // suppliers / money
      "suppliers.getSupplier": () => getSupplier(a, v.sup.supplierId),
      "suppliers.updateSupplier": () => updateSupplier(a, { supplierId: v.sup.supplierId, name: "pwned" }),
      "suppliers.createSupplierLink": () => createSupplierLink(a, { bookingId: v.sup.bookingId }),
      "expenses.getExpense": () => getExpense(a, v.expenseId),
      "expenses.deleteExpense": () => deleteExpense(a, { expenseId: v.expenseId }),
      "budget.removeCategory": () => removeCategory(a, { categoryId: v.categoryId }),
      "payments.list": () => listPaymentDeadlines(a, v.occ),
      "payments.add": () => addPaymentDeadline(a, { bookingId: v.sup.bookingId, kind: "final", dueOn: "2027-04-01", amount: "1" }),
      "payments.remove": () => removePaymentDeadline(a, { deadlineId: v.deadlineId }),
      "payments.proposeMove": () => proposeMovePayment(a, { deadlineId: v.deadlineId, dueOn: "2027-03-15" }),
      // programme / menus / seating / contributions
      "programme.remove": () => removeProgrammeItem(a, { itemId: v.itemId }),
      "menus.remove": () => removeMenu(a, { menuId: v.menuId }),
      "seating.moveItem": () => moveItem(a, { itemId: v.tableId, x: 1, y: 1 }),
      "seating.getEditor": () => getSeatingEditor(a, v.occ),
      "contributions.removeNeed": () => removeNeed(a, { needId: v.needId }),
      // team
      "members.updateMember": () => updateMember(a, { occasionId: v.occ, memberId: v.ownerMemberId, role: "contributor" } as never),
      "members.removeMember": () => removeMember(a, { occasionId: v.occ, memberId: v.ownerMemberId }),
    };
    const results: Record<string, string> = {};
    for (const [name, fn] of Object.entries(attempts)) results[name] = await outcome(fn);
    const leaked = Object.entries(results).filter(([, r]) => !DENIED.includes(r));
    expect(leaked).toEqual([]);
    expect(Object.keys(attempts).length).toBeGreaterThanOrEqual(30);

    // nothing of theirs changed
    const [task] = await t.db.select().from(tasks).where(eq(tasks.id, v.task.id));
    expect(task).toMatchObject({ title: "Rezervă sala", status: "todo" });
    const [hh] = await t.db.select().from(households).where(eq(households.id, v.hh.householdId));
    expect(hh!.name).toBe("Familia Popescu");
    expect(await t.db.select().from(guests).where(eq(guests.householdId, v.hh.householdId))).toHaveLength(2);
    const [inv] = await t.db.select().from(invitations).where(eq(invitations.householdId, v.hh.householdId));
    expect(inv!.revokedAt).toBeNull();
    expect((await t.db.select().from(suppliers).where(eq(suppliers.id, v.sup.supplierId)))[0]!.name).toBe("Formația Allegro");
    expect(await t.db.select().from(expenses).where(eq(expenses.id, v.expenseId))).toHaveLength(1);
    expect(await t.db.select().from(budgetCategories).where(eq(budgetCategories.id, v.categoryId))).toHaveLength(1);
    expect(await t.db.select().from(paymentDeadlines).where(eq(paymentDeadlines.bookingId, v.sup.bookingId))).toHaveLength(1);
    expect(await t.db.select().from(programmeItems).where(eq(programmeItems.id, v.itemId))).toHaveLength(1);
    expect(await t.db.select().from(menus).where(eq(menus.id, v.menuId))).toHaveLength(1);
    expect((await t.db.select().from(planItems).where(eq(planItems.id, v.tableId)))[0]).toMatchObject({ occasionId: v.occ });
  });

  it("their id slipped into a form of MY occasion (occasionId mine, object theirs) links or changes nothing", async () => {
    const a = mine.ctx;
    const v = theirs;
    // each of these passes the membership check of MY occasion; the foreign id must still be refused or ignored
    const mixed: Record<string, () => Promise<unknown>> = {
      "expense with their category": () => createExpense(a, { occasionId: mine.occ, categoryId: v.categoryId, description: "x", amountMinor: 100, spentOn: "2027-01-10", idempotencyKey: key() }),
      "programme item of theirs saved under my occasion": () => saveProgrammeItem(a, { occasionId: mine.occ, itemId: v.itemId, title: "pwned", time: "10:00", kind: "moment", durationMin: "" } as never),
      "menu of theirs saved under my occasion": () => saveMenu(a, { occasionId: mine.occ, menuId: v.menuId, name: "pwned" }),
      "need of theirs saved under my occasion": () => saveNeed(a, { occasionId: mine.occ, needId: v.needId, title: "pwned", unitsNeeded: 1 } as never),
      "their guest seated at my table": () => assignSeats(a, { occasionId: mine.occ, tableItemId: mine.tableId, guestIds: [v.guestId] }),
      "my guest seated at their table": () => assignSeats(a, { occasionId: mine.occ, tableItemId: v.tableId, guestIds: [mine.guestId] }),
      "their member edited through my occasion": () => updateMember(a, { occasionId: mine.occ, memberId: v.ownerMemberId, role: "contributor" } as never),
      "their member removed through my occasion": () => removeMember(a, { occasionId: mine.occ, memberId: v.ownerMemberId }),
      "task of mine made a child of theirs": () => createTask(a, { occasionId: mine.occ, title: "copil", parentId: v.task.id } as never),
    };
    const results: Record<string, string> = {};
    for (const [name, fn] of Object.entries(mixed)) results[name] = await outcome(fn);
    expect(Object.entries(results).filter(([, r]) => r === "OK" || r === "INPUT")).toEqual([]);

    // removeItem is idempotent by design (no error for "not there"): the foreign row must survive
    await removeItem(a, { itemId: v.tableId, occasionId: mine.occ });
    expect(await t.db.select().from(planItems).where(eq(planItems.id, v.tableId))).toHaveLength(1);

    expect((await t.db.select().from(programmeItems).where(eq(programmeItems.id, v.itemId)))[0]).toMatchObject({ occasionId: v.occ, title: "Cununia" });
    expect((await t.db.select().from(menus).where(eq(menus.id, v.menuId)))[0]).toMatchObject({ occasionId: v.occ, name: "Cina" });
    const [owner] = await t.db.select().from(occasionMembers).where(eq(occasionMembers.id, v.ownerMemberId));
    expect(owner).toMatchObject({ role: "owner", removedAt: null });
    expect(await t.db.select().from(expenses).where(eq(expenses.categoryId, v.categoryId))).toHaveLength(1);
  });

  it("a What-if preview of another occasion can be neither read, confirmed nor discarded", async () => {
    const preview = await proposeMovePayment(theirs.ctx, { deadlineId: theirs.deadlineId, dueOn: "2027-03-20" });
    for (const fn of [() => getPreview(mine.ctx, preview.id), () => confirmPreview(mine.ctx, preview.id), () => discardPreview(mine.ctx, preview.id)]) {
      expect(DENIED).toContain(await outcome(fn));
    }
    // a member of THEIR occasion without the finance grant cannot confirm a money change either
    const helper = await addMember(theirs.occ, "pm");
    expect(await outcome(() => confirmPreview(helper.ctx, preview.id))).toBe("FORBIDDEN");
    expect((await getPreview(theirs.ctx, preview.id)).state).toBe("pending");
  });
});

/* ── V-02: every export and money read for a member WITHOUT the finance grant ── */

describe("V-02 a member without the finance / private-requests grant", () => {
  it("cannot run or even see a finance or private-requests export; the supplier export carries no amounts", async () => {
    const w = await world(await makeAccount());
    const pm = await addMember(w.occ, "pm"); // a manager, but no grants
    const helper = await addMember(w.occ, "contributor");

    const visibleToPm = (await listExports(pm.ctx, w.occ)).map((e) => e.key);
    for (const k of ["budget-csv", "ledger-csv", "payments", "private-requests-csv"]) {
      expect(visibleToPm).not.toContain(k);
      expect(await outcome(() => runExport(pm.ctx, w.occ, k))).toBe("FORBIDDEN");
      expect(await outcome(() => runExport(helper.ctx, w.occ, k))).toBe("FORBIDDEN");
    }
    // manager-only exports are refused to a contributor
    for (const k of ["suppliers", "seating", "arrivals", "rooming-list", "registrations-csv", "qr-labels", "qr-invitations"]) {
      expect(await outcome(() => runExport(helper.ctx, w.occ, k))).toBe("FORBIDDEN");
    }
    // the supplier list a grant-less manager may export has no money column and no amount
    const csv = (await runExport(pm.ctx, w.occ, "suppliers")).content;
    expect(csv).not.toMatch(/agreed_amount|3000|3\.000/);
    // every remaining export a grant-less manager CAN run is free of the amounts in this occasion
    for (const k of visibleToPm) {
      const file = await runExport(pm.ctx, w.occ, k).catch(() => null);
      if (!file || typeof file.content !== "string") continue;
      expect(`${k}: ${file.content}`).not.toMatch(/5\.?000[,.]00|500000|Avans sală/);
    }
    expect(await outcome(() => getExpense(pm.ctx, w.expenseId))).toBe("FORBIDDEN");
    expect(await outcome(() => listPaymentDeadlines(pm.ctx, w.occ))).toBe("FORBIDDEN");
    // and with the grant the same manager can
    const finance = await addMember(w.occ, "pm", { finance: true });
    expect(await outcome(() => runExport(finance.ctx, w.occ, "budget-csv"))).toBe("OK");
  });
});

/* ── V-03: CSV / spreadsheet formula injection through every export ── */

describe("V-03 spreadsheet formulas in exported text", () => {
  const PAYLOADS = ["=HYPERLINK(\"http://evil.test\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1"];

  it("csvCell neutralises every leading formula character and quotes separators", () => {
    for (const p of PAYLOADS) expect(csvCell(p).replace(/^"/, "").startsWith("'")).toBe(true);
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("no cell of any export of an occasion full of formula-shaped names starts a formula", async () => {
    const owner = await makeAccount();
    const ctx = as(owner);
    const occasion = await createOccasion(ctx, { title: "=cmd|' /C calc'!A0", kind: "nunta", dateMode: "date", startsOn: "2027-06-12" });
    const occ = occasion.id;
    await createTask(ctx, { occasionId: occ, title: "=1+1", dueOn: "2027-05-01" });
    await createTask(ctx, { occasionId: occ, title: "@SUM(1)", dueOn: "2027-05-02" });
    const hh = await createHousehold(ctx, { occasionId: occ, name: "=HYPERLINK(\"http://evil.test\")", guestNames: ["+Ana", "-Dan"], leadEmail: "ana@example.ro" });
    const sup = await createSupplier(ctx, { occasionId: occ, name: "=Formația", categoryLabel: "+Muzică", contactName: "@Ion", notes: "-note" });
    const [cat] = await addCategories(ctx, { occasionId: occ, categories: [{ name: "=Sală", estimateMinor: 1000 }] });
    await createExpense(ctx, { occasionId: occ, categoryId: cat!.id, description: "=Avans", amountMinor: 500, spentOn: "2027-01-15", supplierLabel: "+Furnizor", idempotencyKey: key() } as never);
    await addPaymentDeadline(ctx, { bookingId: sup.bookingId, kind: "advance", dueOn: "2027-03-01", amount: "10", note: "=nota" } as never);
    await saveProgrammeItem(ctx, { occasionId: occ, title: "=Cununia", time: "16:00", kind: "ceremony", durationMin: "60", place: "+Biserica" } as never);
    await saveMenu(ctx, { occasionId: occ, name: "=Cina" });
    await recordRsvp(ctx, { householdId: hh.householdId, attending: "yes", adults: 2, children: 0 } as never).catch(() => undefined);

    const dangerous: string[] = [];
    const check = (name: string, csv: string) => {
      // split into cells the way a spreadsheet would (quoted cells may hold separators)
      const cells = csv.replace(/^﻿/, "").match(/"(?:[^"]|"")*"|[^,;\r\n]+/g) ?? [];
      for (const cell of cells) {
        const text = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
        if (/^[=+@\t\r]/.test(text) || /^-(?!\d+([.,]\d+)?$)/.test(text)) dangerous.push(`${name}: ${text.slice(0, 40)}`);
      }
    };
    let csvExports = 0;
    for (const e of await listExports(ctx, occ)) {
      const file = await runExport(ctx, occ, e.key).catch(() => null);
      if (!file || !/csv/.test(file.mime) || typeof file.content !== "string") continue;
      csvExports++;
      check(e.key, file.content);
    }
    check("guests", await exportGuestsCsv(ctx, { occasionId: occ, labels: { household: "h", lead: "l", email: "e", language: "lang", adults: "a", status: "s", adultsCount: "ac", childrenCount: "cc", answeredAt: "at", statuses: { yes: "yes", maybe: "maybe", no: "no", pending: "pending" } }, formatDate: (d) => d.toISOString() }));
    expect(csvExports).toBeGreaterThanOrEqual(8);
    expect(dangerous).toEqual([]);
  });
});

/* ── V-04: markup in names never becomes markup in generated SVG ── */

describe("V-04 SVG / XML injection through user text", () => {
  const EVIL = `"><script>alert(1)</script><image href="http://evil.test/x"/>&`;

  it("plan drawings escape labels and titles", async () => {
    const owner = await makeAccount();
    const ctx = as(owner);
    const occasion = await createOccasion(ctx, { title: "Plan", kind: "nunta", dateMode: "date", startsOn: "2027-06-12" });
    await createOwnSpace(ctx, { occasionId: occasion.id, name: EVIL.slice(0, 60), widthMm: 10_000, lengthMm: 8000 });
    const table = await addTable(ctx, { occasionId: occasion.id, custom: { name: `<b>&"x"</b>`, shape: "round", diameterMm: 1800, seats: 10 } });
    await updateItem(ctx, { itemId: table.id, label: `<i>&"'` });
    const view = (await getSpaceModel(ctx, occasion.id))!;
    const svg = planToSvgString(view.model, { ariaLabel: EVIL, showTables: true });
    expect(svg).toContain("&lt;i&gt;&amp;&quot;"); // the label is there — as text
    expect(svg).not.toMatch(/<script|<image|<i>|<b>| href="/i);
    expect(svg).not.toContain(`"><script`);
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
  });

  it("stationery proofs draw text as outlines: no user text, tag or attribute reaches the SVG", async () => {
    const owner = await makeAccount();
    const occasion = await createOccasion(as(owner), { title: "Nunta", kind: "nunta", dateMode: "date", startsOn: "2027-06-12" });
    const editor = await getStationeryEditor(as(owner), occasion.id);
    const d = editor.defaults;
    const texts = Object.fromEntries(Object.keys(d.texts).map((k) => [k, { value: EVIL }]));
    const previews = await previewStationery(as(owner), { occasionId: occasion.id, designKey: d.designKey, colourwayKey: d.colourwayKey, locale: d.locale, texts } as never);
    expect(previews.length).toBeGreaterThan(0);
    for (const p of previews) {
      expect(p.svg.startsWith("<svg ")).toBe(true);
      expect(p.svg).not.toMatch(/<script|<image|<text|onload=|href=/i);
      expect(p.svg).not.toContain("alert(1)");
      expect(p.svg).not.toContain("evil.test");
    }
  });
});

/* ── V-05: a guest link is one household ── */

describe("V-05 guest link scope (SEC2)", () => {
  it("a guest sees and changes only their own household — whatever ids they send", async () => {
    const w = await world(await makeAccount());
    const other = await createHousehold(w.ctx, { occasionId: w.occ, name: "Familia Ionescu", guestNames: ["Maria Ionescu"], leadEmail: "maria@example.ro" });
    const link = await resolveGuestLink(anonymousCtx(t.db, { now: NOW }), w.hh.token, { rateLimit: false });
    const guest = makeCtx(t.db, link!.actor, { now: NOW });

    const view = JSON.stringify(await getGuestView(guest));
    expect(view).toContain("Familia Popescu");
    expect(view).not.toMatch(/Ionescu|maria@example\.ro/);

    // planner functions and other households are closed to a guest actor
    for (const fn of [
      () => getHousehold(guest, other.householdId),
      () => getHousehold(guest, w.hh.householdId),
      () => exportGuestsCsv(guest, { occasionId: w.occ, labels: {} as never, formatDate: String }),
      () => recordRsvp(guest, { householdId: other.householdId, attending: "no" } as never),
      () => getTask(guest, w.task.id),
      () => getSupplier(guest, w.sup.supplierId),
      () => getExpense(guest, w.expenseId),
      () => runExport(guest, w.occ, "tasks"),
    ]) {
      expect([...DENIED, "UNAUTHENTICATED"]).toContain(await outcome(fn));
    }

    // an RSVP that names another household still lands on the guest's own
    await submitRsvp(guest, { attending: "no", adultsCount: 0, childrenCount: 0, householdId: other.householdId } as never);
    const viewOf = async (token: string) => {
      const l = await resolveGuestLink(anonymousCtx(t.db, { now: NOW }), token, { rateLimit: false });
      return { ctx: makeCtx(t.db, l!.actor, { now: NOW }), view: await getGuestView(makeCtx(t.db, l!.actor, { now: NOW })) };
    };
    expect((await viewOf(w.hh.token)).view.rsvp.response).toMatchObject({ attending: "no" });
    const theirs = await viewOf(other.token);
    expect(theirs.view.rsvp.response?.attending ?? null).toBeNull();

    // a private request is readable by its sender only
    await submitGuestRequest(guest, { kind: "dietary", body: "fără gluten, vă rog" } as never);
    expect((await getGuestRequests(guest))!.sent).toHaveLength(1); // the sender sees THAT they sent one (the text is not echoed)
    expect((await getGuestRequests(theirs.ctx))!.sent).toHaveLength(0);
    expect(JSON.stringify(await getGuestRequests(theirs.ctx))).not.toContain("gluten");
    expect(JSON.stringify(theirs.view)).not.toContain("gluten");
  });
});

/* ── F-01: the IP axis of the rate limiter ── */

describe("F-01 per-IP limits count one visitor once", () => {
  it("an IPv6 visitor is counted by /64, IPv4-mapped addresses as IPv4", () => {
    expect(ipRateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipRateLimitKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipRateLimitKey("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ipRateLimitKey("2001:db8:1:3::1")).not.toBe(ipRateLimitKey("2001:db8:1:2::1"));
    expect(ipRateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipRateLimitKey("::1")).toBe("0:0:0:0::/64");
  });

  it("rotating through addresses of one /64 does not reset the limit", async () => {
    const rule = (ip: string) => ({ scope: "review.v6", rules: [{ axis: "ip" as const, key: ip, limit: 3, windowSeconds: 3600 }] });
    for (let i = 1; i <= 3; i++) await enforceRateLimit(anonymousCtx(t.db, { now: NOW }), rule(`2001:db8:aaaa:1::${i}`));
    expect(await outcome(() => enforceRateLimit(anonymousCtx(t.db, { now: NOW }), rule("2001:db8:aaaa:1:dead:beef:0:99")))).toBe("RATE_LIMITED");
    expect(await outcome(() => enforceRateLimit(anonymousCtx(t.db, { now: NOW }), rule("2001:db8:aaaa:2::1")))).toBe("OK");
    const buckets = await t.db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.scope, "review.v6"));
    expect(buckets).toHaveLength(2);
  });
});

/* ── F-02: decompression bomb in the guest-list import ── */

/** A minimal zip with one deflated entry of `size` bytes of `fill`. */
function zipOf(name: string, size: number, opts: { hiddenTail?: Buffer; lieAboutSize?: number } = {}): Uint8Array {
  const data = Buffer.alloc(size, "a");
  const deflated = deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(opts.lieAboutSize ?? size, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const body = Buffer.concat([local, nameBuf, deflated, opts.hiddenTail ?? Buffer.alloc(0)]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(opts.lieAboutSize ?? size, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const dir = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, dir, end]));
}

describe("F-02 an .xlsx that unpacks to far more than it weighs is refused before it is unpacked", () => {
  it("refuses a small file that would unpack past the cap — quickly and as 'too big'", async () => {
    const bomb = zipOf("xl/worksheets/sheet1.xml", IMPORT_MAX_UNPACKED_BYTES + 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(IMPORT_MAX_BYTES / 10); // a few dozen KB on the wire
    const started = Date.now();
    const err = await parseGuestFile({ name: "lista.xlsx", bytes: bomb }).catch((e) => e);
    expect(isAppError(err) && err.messageKey).toBe("guests.import.errors.tooBig");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("is not fooled by a directory that understates the size, nor by data hidden outside the listed entries", () => {
    const lying = zipOf("xl/worksheets/sheet1.xml", IMPORT_MAX_UNPACKED_BYTES + 1024 * 1024, { lieAboutSize: 10 });
    expect(() => assertXlsxWithinLimits(lying)).toThrowError(/tooBig/);
    const hidden = zipOf("a.xml", 100, { hiddenTail: Buffer.from(zipOf("b.xml", 100)).subarray(0, 60) });
    expect(() => assertXlsxWithinLimits(hidden)).toThrowError(/unreadable/);
    expect(() => assertXlsxWithinLimits(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrowError(/unreadable/);
    expect(() => assertXlsxWithinLimits(zipOf("a.xml", 1000))).not.toThrow();
  });
});

/* ── F-04: PDF drawings are rasterised to a fixed size ── */

describe("F-04 the PDF rasteriser never follows the page's own dimensions", () => {
  it("asks for a fixed long side and no resolution flag", () => {
    const args = pdfRasteriserArgs("/tmp/in.pdf", "/tmp/page");
    expect(args).toContain("-scale-to");
    expect(args[args.indexOf("-scale-to") + 1]).toBe(String(PDF_RASTER_LONG_SIDE_PX));
    expect(PDF_RASTER_LONG_SIDE_PX).toBeLessThanOrEqual(4000);
    expect(args).not.toContain("-r");
    expect(args.slice(-2)).toEqual(["/tmp/in.pdf", "/tmp/page"]);
  });
});

/* ── F-06: the invoicing webhook secret ── */

describe("F-06 invoicing webhook secret comparison", () => {
  it("accepts only the exact secret and nothing when none is configured", () => {
    const env = { INVOICING_WEBHOOK_SECRET: "s3cret-s3cret-s3cret-s3cret" };
    expect(verifyInvoicingWebhookSecret("s3cret-s3cret-s3cret-s3cret", env)).toBe(true);
    for (const bad of ["s3cret-s3cret-s3cret-s3cre", "s3cret-s3cret-s3cret-s3cret ", "", null, undefined, "x"]) {
      expect(verifyInvoicingWebhookSecret(bad, env)).toBe(false);
    }
    expect(verifyInvoicingWebhookSecret("anything", {})).toBe(false);
    expect(verifyInvoicingWebhookSecret("", { INVOICING_WEBHOOK_SECRET: "" })).toBe(false);
  });
});
