import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accounts, auditLog, eq, occasionMembers, occasions, readinessDecisions, tasks } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBookingState, updateBookingTerms } from "../src/bookings";
import { acknowledgeBriefing, publishBriefing } from "../src/briefings";
import { buildOccasionBriefingPdf, collectOccasionBriefing, pdfFonts } from "../src/briefingpdf";
import { accountCtx, anonymousCtx, type Ctx } from "../src/context";
import { createDelivery, listDeliveries } from "../src/deliveries";
import { addDayItem, getDayView, pickNow, setDayDetails, setDayState } from "../src/eventday";
import { listExports, runExport } from "../src/exports";
import { createHousehold } from "../src/guests";
import { getOverview } from "../src/overview";
import { addPaymentDeadline } from "../src/payments";
import { getReadiness, listEvidenceOptions, recordReadinessDecision } from "../src/readiness";
import { recordRsvp } from "../src/rsvp";
import { createSupplier, createSupplierLink } from "../src/suppliers";
import { createTask, getTask, queryTasks, setTaskStatus, toBoardView } from "../src/tasks";

let t: TestDb;
const OWNER = "acc_owner_e";
const HELPER = "acc_helper_e";
let seq = 0;
// 12 June 2027, 16:00 in Bucharest — the day of the occasion
const NOW = new Date("2027-06-12T13:00:00Z");
const DAY = "2027-06-12";

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner-e@example.test" },
    { id: HELPER, kind: "email", email: "helper-e@example.test" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const owner = (now: Date = NOW): Ctx => accountCtx(t.db, OWNER, { now });
const helper = (): Ctx => accountCtx(t.db, HELPER, { now: NOW });

async function newOccasion(): Promise<string> {
  const id = `occe${++seq}aaaaaa`;
  await t.db.insert(occasions).values({
    id,
    ownerAccountId: OWNER,
    title: "Nunta Ioanei și a lui Ștefan",
    kind: "nunta",
    startsAt: new Date("2027-06-12T09:00:00Z"),
    venueName: "Conacul Țărănesc",
    venueAddress: "Str. Înfrățirii 4, Brașov",
  });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? e.code : `THROWN:${String(e)}`;
  }
  return "OK";
}

describe("event-day view (B7, principle 2)", () => {
  it("the four day states are the statuses of the same task rows — a change shows in the Tasks views and back", async () => {
    const occ = await newOccasion();
    const ceremony = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Cununia religioasă", startTime: "16:00", contactPhone: "0722 111 222" });
    const dinner = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Cina", startTime: "19:30" });
    const photos = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Ședința foto" }); // no fixed time: after the timed ones
    await createTask(owner(), { occasionId: occ, title: "Trimite mulțumirile", dueOn: "2027-06-20" }); // another day: not shown

    const view = await getDayView(owner(), occ);
    expect(view.day).toBe(DAY);
    expect(view.isToday).toBe(true);
    expect(view.items.map((i) => [i.startTime, i.title, i.state])).toEqual([
      ["16:00", "Cununia religioasă", "ready"],
      ["19:30", "Cina", "ready"],
      [null, "Ședința foto", "ready"],
    ]);
    // a day item IS a task: it is in the task query the list, board and calendar read
    const all = await queryTasks(owner(), occ, {});
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ceremony.taskId, dinner.taskId, photos.taskId]));

    // day view → Tasks views
    expect(await setDayState(owner(), { taskId: ceremony.taskId, state: "running" })).toEqual({ taskId: ceremony.taskId, state: "running" });
    expect((await getTask(owner(), ceremony.taskId)).task.status).toBe("doing");
    const board = toBoardView((await queryTasks(owner(), occ, {})).rows);
    expect(board.find((c) => c.status === "doing")!.tasks.map((x) => x.id)).toEqual([ceremony.taskId]);
    await setDayState(owner(), { taskId: dinner.taskId, state: "waiting" });
    expect((await getTask(owner(), dinner.taskId)).task.status).toBe("waiting");

    // Tasks views → day view
    await setTaskStatus(owner(), { taskId: ceremony.taskId, status: "done" });
    const after = await getDayView(owner(), occ);
    expect(after.items.find((i) => i.taskId === ceremony.taskId)!.state).toBe("done");
    expect(after.counts).toEqual({ ready: 1, running: 0, waiting: 1, done: 1 });

    // idempotent: the same state again writes nothing more
    const auditsBefore = await t.db.select().from(auditLog).where(eq(auditLog.objectId, dinner.taskId));
    await setDayState(owner(), { taskId: dinner.taskId, state: "waiting" });
    const auditsAfter = await t.db.select().from(auditLog).where(eq(auditLog.objectId, dinner.taskId));
    expect(auditsAfter.length).toBe(auditsBefore.length);
    const [row] = await t.db.select().from(tasks).where(eq(tasks.id, ceremony.taskId));
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  it("exactly one row is 'Acum': the running item, else the next one that is not done", async () => {
    const occ = await newOccasion();
    const a = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Sosirea invitaților", startTime: "15:00" });
    const b = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Cununia", startTime: "16:00" });
    const c = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Cina", startTime: "19:30" });
    const nowOf = async () => {
      const v = await getDayView(owner(), occ);
      expect(v.items.filter((i) => i.isNow).length).toBeLessThanOrEqual(1);
      return v.nowTaskId;
    };
    expect(await nowOf()).toBe(a.taskId); // nothing runs: the next one due
    await setDayState(owner(), { taskId: b.taskId, state: "running" });
    expect(await nowOf()).toBe(b.taskId); // the running one wins
    await setDayState(owner(), { taskId: a.taskId, state: "done" });
    await setDayState(owner(), { taskId: b.taskId, state: "done" });
    expect(await nowOf()).toBe(c.taskId);
    await setDayState(owner(), { taskId: c.taskId, state: "waiting" });
    expect(await nowOf()).toBe(c.taskId); // only a waiting one is left
    await setDayState(owner(), { taskId: c.taskId, state: "done" });
    expect(await nowOf()).toBeNull(); // everything done
    expect(pickNow([{ taskId: "x", state: "waiting" }, { taskId: "y", state: "ready" }, { taskId: "z", state: "running" }])).toBe("z");
  });

  it("today's deliveries and the phone numbers are on the day view; permissions follow the task's", async () => {
    const occ = await newOccasion();
    const sup = await createSupplier(owner(), { occasionId: occ, name: "Florăria Iris", categoryLabel: "Flori", contactName: "Ana", contactPhone: "0744 555 666" });
    await createDelivery(owner(), { occasionId: occ, supplierId: sup.supplierId, title: "Aranjamente florale", expectedFrom: new Date("2027-06-12T07:00:00Z"), items: [{ label: "Buchete", expectedQty: 20, deposit: "300" }] });
    await createDelivery(owner(), { occasionId: occ, title: "Tort", expectedFrom: new Date("2027-06-11T07:00:00Z") }); // the day before
    const mine = await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Deschiderea sălii", startTime: "14:00" });
    const theirs = await addDayItem(helper(), { occasionId: occ, day: DAY, title: "Proba de sunet", startTime: "14:30" });

    const view = await getDayView(helper(), occ);
    expect(view.deliveries.map((d) => d.title)).toEqual(["Aranjamente florale"]);
    expect(JSON.stringify(view.deliveries)).not.toContain("30000"); // no money on the day view
    expect(view.contacts).toEqual([{ key: `supplier:${sup.supplierId}`, name: "Florăria Iris · Ana", label: "Flori", phone: "0744 555 666" }]);
    // a contributor moves their own item, not someone else's
    expect(view.items.find((i) => i.taskId === theirs.taskId)!.canProgress).toBe(true);
    expect(view.items.find((i) => i.taskId === mine.taskId)!.canProgress).toBe(false);
    expect(await code(() => setDayState(helper(), { taskId: mine.taskId, state: "running" }))).toBe("FORBIDDEN");
    expect(await code(() => setDayDetails(helper(), { taskId: mine.taskId, startTime: "15:00" }))).toBe("FORBIDDEN");
    await setDayDetails(owner(), { taskId: mine.taskId, startTime: "13:45", contactPhone: "" });
    expect((await getDayView(owner(), occ)).items[0]).toMatchObject({ taskId: mine.taskId, startTime: "13:45" });
    expect(await code(() => setDayDetails(owner(), { taskId: mine.taskId, startTime: "25:99" }))).toMatch(/VALIDATION|THROWN/);
    expect(await code(() => getDayView(accountCtx(t.db, "acc_nobody"), occ))).toBe("NOT_FOUND");
  });
});

describe("readiness decisions (B8)", () => {
  it("a decision without evidence is rejected; with evidence it is recorded with actor and time; history is visible", async () => {
    const occ = await newOccasion();
    const task = await createTask(owner(), { occasionId: occ, title: "Verifică sonorizarea", dueOn: DAY });
    const sup = await createSupplier(owner(), { occasionId: occ, name: "Formația Allegro" });
    const v1 = await publishBriefing(owner(), { bookingId: sup.bookingId, what: "Muzică live" });
    const link = await createSupplierLink(owner(), { bookingId: sup.bookingId });
    await acknowledgeBriefing(anonymousCtx(t.db), { token: link.token, versionId: v1.versionId, name: "Mihai" });
    const { deliveryId } = await createDelivery(owner(), { occasionId: occ, title: "Scaune" });
    const options = await listEvidenceOptions(owner(), occ);
    expect(options.acks).toHaveLength(1);

    const none = await recordReadinessDecision(owner(), { occasionId: occ, decision: "proceed", evidence: [] }).catch((e) => e);
    expect(isAppError(none) && none.code).toBe("VALIDATION");
    expect(none.details.fieldErrors.evidence).toEqual(["eventday.errors.evidenceRequired"]);
    expect(await t.db.select().from(readinessDecisions).where(eq(readinessDecisions.occasionId, occ))).toHaveLength(0);
    // a note needs a real link; a reference must belong to this occasion
    expect(await code(() => recordReadinessDecision(owner(), { occasionId: occ, decision: "proceed", evidence: [{ type: "note", label: "am vorbit la telefon", url: "nu e link" }] }))).toBe("VALIDATION");
    const other = await newOccasion();
    const foreign = await createTask(owner(), { occasionId: other, title: "Altă ocazie" });
    expect(await code(() => recordReadinessDecision(owner(), { occasionId: occ, decision: "proceed", evidence: [{ type: "task", refId: foreign.id }] }))).toBe("VALIDATION");
    expect(await code(() => recordReadinessDecision(owner(), { occasionId: occ, decision: "conditions", evidence: [{ type: "task", refId: task.id }] }))).toBe("VALIDATION"); // conditions missing
    expect(await code(() => recordReadinessDecision(helper(), { occasionId: occ, decision: "proceed", evidence: [{ type: "task", refId: task.id }] }))).toBe("FORBIDDEN");

    const first = await recordReadinessDecision(owner(new Date("2027-06-12T08:00:00Z")), {
      occasionId: occ,
      decision: "conditions",
      conditions: "Dacă nu plouă până la ora 15",
      evidence: [
        { type: "task", refId: task.id },
        { type: "delivery", refId: deliveryId },
        { type: "briefing_ack", refId: options.acks[0]!.id },
        { type: "note", label: "Prognoza meteo", url: "https://www.meteoromania.ro/" },
      ],
    });
    await recordReadinessDecision(owner(new Date("2027-06-12T12:00:00Z")), { occasionId: occ, decision: "proceed", evidence: [{ type: "task", refId: task.id }] });

    const state = await getReadiness(owner(), occ);
    expect(state.history.map((d) => d.decision)).toEqual(["proceed", "conditions"]);
    expect(state.latest!.decision).toBe("proceed");
    const old = state.history[1]!;
    expect(old.id).toBe(first.decisionId);
    expect(old.decidedByAccountId).toBe(OWNER);
    expect(old.decidedAt.toISOString()).toBe("2027-06-12T08:00:00.000Z");
    expect(old.evidence.map((e) => [e.type, e.label])).toEqual([
      ["task", "Verifică sonorizarea"],
      ["delivery", "Scaune"],
      ["briefing_ack", "Formația Allegro · v1"],
      ["note", "Prognoza meteo"],
    ]);
    // append-only
    await expect(t.db.update(readinessDecisions).set({ decision: "hold" }).where(eq(readinessDecisions.id, first.decisionId))).rejects.toThrow();
    await expect(t.db.delete(readinessDecisions).where(eq(readinessDecisions.id, first.decisionId))).rejects.toThrow();

    // the standing decision is on the day view and the overview; contributors see it without the history
    expect((await getDayView(helper(), occ)).readiness?.decision).toBe("proceed");
    const forHelper = await getReadiness(helper(), occ);
    expect(forHelper).toMatchObject({ canDecide: false, history: [] });
    expect(forHelper.latest?.decision).toBe("proceed");
    const overview = await getOverview(helper(), occ);
    expect(JSON.stringify(overview.extra.find((e) => e.key === "readiness"))).toContain("eventday.readiness.overview.proceed");
  });
});

describe("downloadable briefing PDF (B11, P16)", () => {
  it("is a real PDF with the occasion's own data, Romanian diacritics, guest counts only and nothing financial", async () => {
    const occ = await newOccasion();
    await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Cununia religioasă", startTime: "16:00" });
    await addDayItem(owner(), { occasionId: occ, day: DAY, title: "Tăierea tortului", startTime: "22:30" });
    const sup = await createSupplier(owner(), { occasionId: occ, name: "Formația Țărănească", categoryLabel: "Muzică", contactName: "Ștefan Înalt", contactPhone: "0722 333 444" });
    await updateBookingTerms(owner(), { bookingId: sup.bookingId, agreedAmount: "98.765", notes: "NOTA-FINANCIARA" });
    await setBookingState(owner(), { bookingId: sup.bookingId, state: "booked" });
    await addPaymentDeadline(owner(), { bookingId: sup.bookingId, kind: "advance", dueOn: "2027-05-01", amount: "43.210" });
    await publishBriefing(owner(), { bookingId: sup.bookingId, what: "Muzică live între orele 19 și 2", where: "Salonul mare, lângă șemineu", specialNotes: "Acces prin curtea din spate" });
    await createDelivery(owner(), { occasionId: occ, supplierId: sup.supplierId, title: "Montaj scenă", expectedFrom: new Date("2027-06-12T07:00:00Z"), place: "Intrarea din spate", items: [{ label: "Boxe", expectedQty: 4, unit: "buc", deposit: "5.432" }] });
    const hh = await createHousehold(owner(), { occasionId: occ, name: "Familia Secretescu", guestNames: "Gheorghe Secretescu" });
    await recordRsvp(owner(), { householdId: hh.householdId, attending: "yes", adultsCount: 2, childrenCount: 1 });

    // the data model itself has no place for money or guest names
    const model = await collectOccasionBriefing(owner(), occ);
    expect(model.guests).toEqual({ adults: 2, children: 1, total: 3 });
    const modelJson = JSON.stringify(model);
    for (const leak of ["9876500", "4321000", "543200", "NOTA-FINANCIARA", "Secretescu", "agreed", "deposit", "amountMinor"]) expect(modelJson).not.toContain(leak);

    const file = await buildOccasionBriefingPdf(owner(), occ);
    expect(file.mime).toBe("application/pdf");
    expect(file.filename).toBe("nunta-ioanei-si-a-lui-stefan-briefing.pdf");
    expect(Buffer.from(file.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(file.bytes.length).toBeGreaterThan(5_000);
    expect(Object.values(pdfFonts()).every((p) => p.endsWith(".ttf"))).toBe(true);

    // text extraction (poppler); the diacritics must survive the font embedding
    const dir = mkdtempSync(join(tmpdir(), "ed-briefing-"));
    const path = join(dir, "briefing.pdf");
    writeFileSync(path, file.bytes);
    const text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], { encoding: "utf8" });
    for (const expected of [
      "Nunta Ioanei și a lui Ștefan",
      "Conacul Țărănesc",
      "Str. Înfrățirii 4, Brașov",
      "16:00",
      "Cununia religioasă",
      "Tăierea tortului",
      "Formația Țărănească",
      "Ștefan Înalt",
      "0722 333 444",
      "Muzică live între orele 19 și 2",
      "lângă șemineu",
      "Montaj scenă",
      "Boxe",
      "3 persoane — 2 adulți, 1 copii",
      "Rezervat",
    ]) {
      expect(text).toContain(expected);
    }
    for (const leak of ["98.765", "98765", "43.210", "5.432", "RON", "NOTA-FINANCIARA", "Secretescu", "Avans", "Garanție", "Promovat", "Featured"]) {
      expect(text).not.toContain(leak);
    }

    // registered as an export: on the print page, downloadable, bytes intact
    expect((await listExports(helper(), occ)).map((e) => e.key)).toContain("briefing-pdf");
    const viaExport = await runExport(helper(), occ, "briefing-pdf");
    expect(viaExport.mime).toBe("application/pdf");
    const body = new Uint8Array(await new Response(viaExport.content).arrayBuffer());
    expect(Buffer.from(body.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(await code(() => buildOccasionBriefingPdf(accountCtx(t.db, "acc_nobody"), occ))).toBe("NOT_FOUND");
    expect((await listDeliveries(owner(), occ)).items).toHaveLength(1);
  });
});
