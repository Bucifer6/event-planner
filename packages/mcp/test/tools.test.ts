import { createBusinessOccasion } from "@ed/core/bizoccasions";
import { addCategories, getBudget } from "@ed/core/budget";
import { createBusiness } from "@ed/core/business";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "@ed/core/context";
import { getDirectoryResults, setFeaturedProvider } from "@ed/core/directory";
import { createHousehold } from "@ed/core/guests";
import { proposeHandover } from "@ed/core/handover";
import { getGuestInvitationText, getInvitationText, setInvitationText } from "@ed/core/invitationtext";
import { getStationeryEditor } from "@ed/core/stationery";
import { resolveGuestLink } from "@ed/core/invitations";
import { createListing, createUnclaimedListing, submitListing } from "@ed/core/listings";
import { decideRevision } from "@ed/core/moderation";
import { createOccasion } from "@ed/core/occasions";
import { deletePlanNote, listPlanNotes } from "@ed/core/plannotes";
import { recordRsvp } from "@ed/core/rsvp";
import { createOwnSpace, getSpaceModel } from "@ed/core/seating";
import { createSupplier, listSuppliers } from "@ed/core/suppliers";
import { createTask, queryTasks } from "@ed/core/tasks";
import { confirmPreview, listPending } from "@ed/core/whatif";
import {
  accounts,
  auditLog,
  bookings,
  businessMembers,
  categories,
  delegations,
  emailOutbox,
  enquiries,
  eq,
  localities,
  mcpTokens,
  occasionMembers,
  planNotes,
  sessions,
  staffMembers,
  statsDaily,
  suppliers,
  whatifPreviews,
  type OccasionRole,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { translate } from "@ed/i18n";
import { hashToken, newId } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMcpToken,
  EXTERNAL_ASSISTANT_LABEL,
  handleMcpRequest,
  listMcpTools,
  MCP_CONSENT_DATA_CLASSES,
  MCP_TOOL_CATALOGUE,
} from "../src/index";

// The release 0–P tool catalogue, end to end through the MCP endpoint: what a token can read
// is what its user can see (MCP2), propose tools only ever create What-if previews (MCP3),
// proposing is bounded by the user's WRITE access (SEC15), and no tool exists outside the
// allowlist (MCP6, MCP8).

let t: TestDb;
const T0 = new Date("2026-05-04T09:00:00Z");
const APP = "https://app.eventdesk.test";
let seq = 0;
let foto: { id: string; slug: string };
let cluj: { id: string };
let moderator: Ctx;

type Person = { id: string; ctx: Ctx };

async function mkAccount(): Promise<Person> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `tool${++seq}@example.test`, locale: "ro" });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), createdAt: T0, lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: T0 });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }) };
}

async function mkToken(p: Person, scope: "read" | "read_propose" = "read_propose"): Promise<string> {
  return (await createMcpToken(p.ctx, { name: "Asistent", scope, consent: true })).token;
}

async function join(occasionId: string, role: OccasionRole, grants: { finance?: boolean } = {}): Promise<Person & { memberId: string }> {
  const p = await mkAccount();
  const [row] = await t.db.insert(occasionMembers).values({ occasionId, accountId: p.id, role, grantFinance: grants.finance ?? false }).returning();
  return { ...p, memberId: row!.id };
}

async function mkOccasion(title = "Nunta Ana & Mihai") {
  const owner = await mkAccount();
  const occasion = await createOccasion(owner.ctx, { title, kind: "blank", dateMode: "date", startsOn: "2026-09-12", venueName: "Conacul Vechi", purpose: "Să ne adunăm familia", priorities: ["Mâncare bună"] });
  const [me] = await t.db.select().from(occasionMembers).where(eq(occasionMembers.occasionId, occasion.id));
  return { owner, id: occasion.id, ownerMemberId: me!.id };
}

type ToolOut = { isError: boolean; data: any; text: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
  const res = await handleMcpRequest(
    new Request(`${APP}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    { db: t.db, now: new Date(T0.getTime() + 60_000), appUrl: APP, env: {} },
  );
  const body = (await res.json()) as { result?: { isError: boolean; structuredContent?: unknown; content: Array<{ text: string }> }; error?: { message: string } };
  if (!body.result) throw new Error(`rpc error (${res.status}): ${body.error?.message}`);
  return { isError: body.result.isError, data: body.result.structuredContent ?? null, text: body.result.content[0]?.text ?? "" };
}

const previewsOf = (occasionId: string) => t.db.select().from(whatifPreviews).where(eq(whatifPreviews.occasionId, occasionId));

async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = await mkAccount();
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc.id, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc.id, staffId: row!.id, roles }, { now: T0 });
}

async function mkLiveListing(name: string) {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `${name} SRL` });
  const listing = await createListing(owner.ctx, {
    businessId: business.id,
    payload: { name, descriptionRo: "Fotografie de eveniment, cu experiență de zece ani în județul Cluj.", categoryIds: [foto.id], countyCodes: ["CJ"], localityIds: [cluj.id] },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return listing.id;
}

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
  const cats = await t.db.select().from(categories);
  foto = cats.find((c) => c.slug === "fotografi")!;
  const locs = await t.db.select().from(localities).where(eq(localities.countyCode, "CJ"));
  cluj = locs.find((l) => l.slug === "cluj-napoca")!;
  moderator = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  await t.close();
});

describe("the catalogue (MCP6, MCP8)", () => {
  it("is exactly the allowlist: every tool, its scope, and nothing else", () => {
    const registered = listMcpTools().map((x) => ({ name: x.name, scope: x._meta["eventdesk.ro/scope"] }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect(registered.sort(byName)).toEqual([...MCP_TOOL_CATALOGUE].sort(byName));
    // the explicit snapshot: adding a tool means changing this list on purpose
    expect(MCP_TOOL_CATALOGUE.map((x) => `${x.scope}:${x.name}`)).toEqual([
      "read:whoami",
      "read:list_occasions",
      "read:get_occasion",
      "read:list_tasks",
      "read:get_rsvp_summary",
      "read:list_households",
      "read:list_pending_proposals",
      "read:get_budget_summary",
      "read:list_suppliers",
      "read:get_space_model",
      "read:get_seating_summary",
      "read:list_directory_filters",
      "read:search_directory",
      "read:get_listing",
      "read:list_catalogues",
      "propose:propose_task_list",
      "propose:propose_invitation_text",
      "propose:propose_budget",
      "propose:propose_budget_note",
      "propose:propose_supplier_shortlist",
      "propose:propose_seating_layout",
      "propose:propose_custom_table",
      "propose:propose_arrangement_design",
      "read:list_invitation_designs",
      "read:get_invitation_preview",
      "propose:propose_invitation_design",
    ]);
  });

  it("has no payment, admin, enquiry-sending, publishing or other-account tool", () => {
    const names = listMcpTools().map((x) => x.name);
    for (const name of names) {
      expect(name, name).not.toMatch(/pay|refund|invoice|billing|subscription|charge|admin|console|staff|moderat|approv|enquir|send|publish|delete|remove|account|token|session/);
      expect(name, name).toMatch(/^(whoami$|get_|list_|search_|propose_)/);
    }
    for (const tool of listMcpTools()) {
      expect(tool.annotations.destructiveHint).toBe(false);
      if (tool.name.startsWith("propose_")) expect(tool.description).toContain("nothing changes until the user confirms");
    }
  });

  it("every tool and every consent data class has its line in Romanian and English", () => {
    for (const locale of ["ro", "en"] as const) {
      for (const tool of [...MCP_TOOL_CATALOGUE.map((x) => x.name), "propose_arrangement_design"]) {
        const key = `mcp.tools.${tool}`;
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
      for (const cls of MCP_CONSENT_DATA_CLASSES) {
        const key = `mcp.consent.classes.${cls}`;
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });
});

describe("read tools return what the user can see (MCP2)", () => {
  it("whoami, list_occasions and get_occasion: details, brief, days left, role, team, pending proposals", async () => {
    const occ = await mkOccasion();
    const token = await mkToken(occ.owner, "read");
    const who = await call(token, "whoami");
    expect(who.data.occasions).toEqual([{ id: occ.id, title: "Nunta Ana & Mihai" }]);
    const list = await call(token, "list_occasions");
    expect(list.data.occasions).toEqual([expect.objectContaining({ id: occ.id, kind: "blank", status: "planning", role: "owner", startsAt: expect.stringMatching(/^2026-09-12T/) })]);

    const got = await call(token, "get_occasion", { occasionId: occ.id });
    expect(got.isError).toBe(false);
    expect(got.data).toMatchObject({
      id: occ.id,
      title: "Nunta Ana & Mihai",
      timezone: "Europe/Bucharest",
      daysLeft: 131,
      venue: { name: "Conacul Vechi", address: null },
      brief: { purpose: "Să ne adunăm familia", priorities: ["Mâncare bună"] },
      member: { role: "owner", grants: { finance: true, privateRequests: true } },
      pendingProposals: 0,
      guestCounts: { households: { total: 0 }, invited: null },
    });
    expect(got.data.team).toEqual([expect.objectContaining({ memberId: occ.ownerMemberId, role: "owner", isSelf: true })]);

    // someone who is not a member learns nothing — not even that the occasion exists
    const stranger = await mkToken(await mkAccount(), "read");
    const denied = await call(stranger, "get_occasion", { occasionId: occ.id });
    expect(denied.isError).toBe(true);
    expect(denied.text).not.toContain("Nunta");
    expect((await call(stranger, "list_occasions")).data.occasions).toEqual([]);
    for (const tool of ["list_tasks", "get_rsvp_summary", "list_households", "get_budget_summary", "get_space_model", "get_seating_summary", "list_suppliers", "list_pending_proposals"]) {
      expect((await call(stranger, tool, { occasionId: occ.id })).isError, tool).toBe(true);
    }
  });

  it("list_tasks: status and due filters, mine, pagination", async () => {
    const occ = await mkOccasion();
    const helper = await join(occ.id, "contributor");
    await createTask(occ.owner.ctx, { occasionId: occ.id, title: "Alege formația", dueOn: "2026-06-01", owner: "me" });
    await createTask(occ.owner.ctx, { occasionId: occ.id, title: "Degustare meniu", dueOn: "2026-07-10" });
    await createTask(helper.ctx, { occasionId: occ.id, title: "Listă cântece", owner: "me" });
    const token = await mkToken(occ.owner, "read");

    const all = await call(token, "list_tasks", { occasionId: occ.id });
    expect(all.data).toMatchObject({ total: 3, hasMore: false, offset: 0 });
    expect(all.data.tasks.map((x: { title: string }) => x.title)).toEqual(["Alege formația", "Degustare meniu", "Listă cântece"]);
    expect(all.data.tasks[0]).toMatchObject({ status: "todo", dueOn: "2026-06-01", owner: { memberId: occ.ownerMemberId, isSelf: true } });
    expect(all.data.tasks[1].owner).toBeNull();

    expect((await call(token, "list_tasks", { occasionId: occ.id, mine: true })).data.tasks.map((x: { title: string }) => x.title)).toEqual(["Alege formația"]);
    expect((await call(token, "list_tasks", { occasionId: occ.id, dueFrom: "2026-07-01", dueTo: "2026-07-31" })).data.tasks.map((x: { title: string }) => x.title)).toEqual(["Degustare meniu"]);
    expect((await call(token, "list_tasks", { occasionId: occ.id, status: ["done"] })).data.total).toBe(0);
    const page = await call(token, "list_tasks", { occasionId: occ.id, limit: 2, offset: 0 });
    expect(page.data).toMatchObject({ total: 3, hasMore: true });
    expect((await call(token, "list_tasks", { occasionId: occ.id, limit: 2, offset: 2 })).data.tasks).toHaveLength(1);
    expect((await call(token, "list_tasks", { occasionId: occ.id, limit: 1000 })).isError).toBe(true);
  });

  it("get_rsvp_summary gives counts only; list_households is for managers and never carries contacts", async () => {
    const occ = await mkOccasion();
    const h = await createHousehold(occ.owner.ctx, { occasionId: occ.id, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"], leadEmail: "ana.popescu@example.test" });
    await createHousehold(occ.owner.ctx, { occasionId: occ.id, name: "Familia Ionescu", guestNames: ["Ion Ionescu"] });
    await recordRsvp(occ.owner.ctx, { householdId: h.householdId, attending: "yes", adultsCount: 2, childrenCount: 1 });
    const contributor = await join(occ.id, "contributor");
    const cTok = await mkToken(contributor, "read");
    const oTok = await mkToken(occ.owner, "read");

    const summary = await call(cTok, "get_rsvp_summary", { occasionId: occ.id });
    expect(summary.data).toMatchObject({ households: { total: 2, yes: 1, pending: 1 }, attending: { adults: 2, children: 1, total: 3 }, capacity: { total: null, left: null }, rsvpDeadline: null });
    expect(summary.text).not.toMatch(/Popescu|Ionescu|example\.test/);

    const denied = await call(cTok, "list_households", { occasionId: occ.id });
    expect(denied.isError).toBe(true);
    expect(denied.text).not.toMatch(/Popescu/);

    const list = await call(oTok, "list_households", { occasionId: occ.id });
    expect(list.data.total).toBe(2);
    const popescu = list.data.households.find((x: { name: string }) => x.name === "Familia Popescu");
    expect(popescu).toMatchObject({ householdId: h.householdId, answer: "yes", children: { count: 1 } });
    expect(popescu.adults.map((a: { name: string }) => a.name).sort()).toEqual(["Ana Popescu", "Dan Popescu"]);
    expect(list.text).not.toContain("example.test"); // no contact details, even for the owner
    expect((await call(oTok, "list_households", { occasionId: occ.id, status: "pending" })).data.households.map((x: { name: string }) => x.name)).toEqual(["Familia Ionescu"]);

    // a guest-role member sees neither
    const guestTok = await mkToken(await join(occ.id, "guest"), "read");
    expect((await call(guestTok, "get_rsvp_summary", { occasionId: occ.id })).isError).toBe(true);
    expect((await call(guestTok, "get_occasion", { occasionId: occ.id })).data.guestCounts).toBeNull();
  });

  it("get_budget_summary needs the finance grant; unknown amounts are null, never 0", async () => {
    const occ = await mkOccasion();
    await addCategories(occ.owner.ctx, { occasionId: occ.id, categories: [{ name: "Locație", estimateMinor: 1_200_000 }, { name: "Flori" }] });
    const ok = await call(await mkToken(occ.owner, "read"), "get_budget_summary", { occasionId: occ.id });
    expect(ok.data.categories).toEqual([
      expect.objectContaining({ name: "Locație", estimate: { amountMinor: 1_200_000, currency: "RON" }, forecast: null, paid: { amountMinor: 0, currency: "RON" } }),
      expect.objectContaining({ name: "Flori", estimate: null, forecast: null }),
    ]);
    expect(ok.data.totals[0]).toMatchObject({ currency: "RON", estimate: { amountMinor: 1_200_000, currency: "RON" }, categoriesWithoutEstimate: 1 });

    const contributor = await join(occ.id, "contributor");
    const denied = await call(await mkToken(contributor), "get_budget_summary", { occasionId: occ.id });
    expect(denied.isError).toBe(true);
    expect(denied.data).toBeNull();
    expect(denied.text).not.toMatch(/Locație|1200000|RON/);
    // the same contributor WITH the grant reads it
    const trusted = await join(occ.id, "contributor", { finance: true });
    expect((await call(await mkToken(trusted, "read"), "get_budget_summary", { occasionId: occ.id })).data.categories).toHaveLength(2);
  });

  it("list_suppliers shows booking state to planners and money only with finance; never contacts", async () => {
    const occ = await mkOccasion();
    const s = await createSupplier(occ.owner.ctx, { occasionId: occ.id, name: "Foto Lumina", categoryLabel: "Fotograf", contactEmail: "contact@fotolumina.example", contactPhone: "0740 000 000" });
    await t.db.update(bookings).set({ agreedMinor: 450_000 }).where(eq(bookings.id, s.bookingId));
    const owner = await call(await mkToken(occ.owner, "read"), "list_suppliers", { occasionId: occ.id });
    expect(owner.data).toMatchObject({ moneyVisible: true, suppliers: [{ name: "Foto Lumina", booking: { state: "enquired", agreed: { amountMinor: 450_000, currency: "RON" } }, nextDeadline: null }] });
    const plain = await call(await mkToken(await join(occ.id, "contributor"), "read"), "list_suppliers", { occasionId: occ.id });
    expect(plain.data.moneyVisible).toBe(false);
    expect(plain.data.suppliers[0].booking).toEqual({ bookingId: s.bookingId, state: "enquired", hasQuote: false });
    expect("nextDeadline" in plain.data.suppliers[0]).toBe(false);
    for (const out of [owner, plain]) expect(out.text).not.toMatch(/fotolumina|0740/);
    expect(plain.text).not.toContain("450000");
  });

  it("get_space_model returns geometry (no picture link); get_seating_summary returns counts", async () => {
    const occ = await mkOccasion();
    const token = await mkToken(occ.owner);
    expect((await call(token, "get_space_model", { occasionId: occ.id })).data).toEqual({ hasSpace: false });
    await createOwnSpace(occ.owner.ctx, { occasionId: occ.id, name: "Cort", widthMm: 10_000, lengthMm: 8000 });
    const space = await call(token, "get_space_model", { occasionId: occ.id });
    expect(space.data).toMatchObject({ hasSpace: true, name: "Cort", source: "own", units: "mm", model: { widthMm: 10_000, lengthMm: 8000, items: [] } });
    expect(space.text).not.toMatch(/pictureUrl|https?:\/\//);
    const seating = await call(token, "get_seating_summary", { occasionId: occ.id });
    expect(seating.data).toMatchObject({ hasSpace: true, tables: [], seats: { total: 0, taken: 0 }, publishedAt: null });
  });
});

describe("propose tools are bounded by write access (SEC15)", () => {
  const PROPOSE_ARGS = (occasionId: string, listingId = "x".repeat(24)): Record<string, Record<string, unknown>> => ({
    propose_task_list: { occasionId, tasks: [{ title: "Rezervă formația" }] },
    propose_invitation_text: { occasionId, text: "Vă așteptăm cu drag!" },
    propose_budget: { occasionId, categories: [{ name: "Muzică", estimateMinor: 500_000 }] },
    propose_budget_note: { occasionId, text: "De cerut trei oferte." },
    propose_supplier_shortlist: { occasionId, listings: [{ listingId }] },
    propose_seating_layout: { occasionId, tables: [{ custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 }, x: 3000, y: 3000 }] },
    propose_custom_table: { occasionId, name: "Prezidiu", shape: "rect", widthMm: 3000, lengthMm: 800, seats: 6 },
    propose_arrangement_design: { occasionId, form: "round_bouquet", items: [{ catalogueItemId: "x".repeat(24), stems: 12 }] },
    propose_invitation_design: { occasionId, designKey: "t.blank.01", colourwayKey: "tp-x", locale: "ro", texts: { names: "Ana & Mihai" } },
  });

  it("a read-only token cannot call any propose tool", async () => {
    const occ = await mkOccasion();
    await createOwnSpace(occ.owner.ctx, { occasionId: occ.id, name: "Cort", widthMm: 10_000, lengthMm: 8000 });
    const token = await mkToken(occ.owner, "read");
    const args = PROPOSE_ARGS(occ.id);
    const proposeTools = MCP_TOOL_CATALOGUE.filter((x) => x.scope === "propose").map((x) => x.name);
    expect(Object.keys(args).sort()).toEqual([...proposeTools].sort());
    for (const name of proposeTools) {
      const out = await call(token, name, args[name]);
      expect(out.isError, name).toBe(true);
      expect(out.text, name).toContain(`${APP}/account/assistants`);
    }
    expect(await previewsOf(occ.id)).toHaveLength(0);
  });

  it("a guest-role member cannot propose tasks; a contributor without finance cannot propose a budget", async () => {
    const occ = await mkOccasion();
    await createOwnSpace(occ.owner.ctx, { occasionId: occ.id, name: "Cort", widthMm: 10_000, lengthMm: 8000 });
    const args = PROPOSE_ARGS(occ.id);
    const guestTok = await mkToken(await join(occ.id, "guest"));
    const supplierTok = await mkToken(await join(occ.id, "supplier"));
    for (const tok of [guestTok, supplierTok]) {
      for (const name of Object.keys(args)) expect((await call(tok, name, args[name])).isError, name).toBe(true);
    }
    const contributorTok = await mkToken(await join(occ.id, "contributor"));
    for (const name of ["propose_budget", "propose_budget_note", "propose_invitation_text", "propose_supplier_shortlist", "propose_seating_layout", "propose_custom_table", "propose_arrangement_design", "propose_invitation_design"]) {
      expect((await call(contributorTok, name, args[name])).isError, name).toBe(true);
    }
    expect(await previewsOf(occ.id)).toHaveLength(0);
    // …but a contributor may add tasks in the app, so may propose them
    const ok = await call(contributorTok, "propose_task_list", args.propose_task_list);
    expect(ok.isError).toBe(false);
    // and a stranger's token gets nothing at all
    const stranger = await mkToken(await mkAccount());
    for (const name of Object.keys(args)) expect((await call(stranger, name, args[name])).isError, name).toBe(true);
    expect(await previewsOf(occ.id)).toHaveLength(1);
  });
});

describe("propose tools create previews and apply nothing (MCP3, MCP5)", () => {
  it("propose_task_list: a labelled proposal; tasks exist only after the user confirms; an owner is asked, not assigned", async () => {
    const occ = await mkOccasion();
    const helper = await join(occ.id, "contributor");
    const token = await mkToken(occ.owner);
    const out = await call(token, "propose_task_list", {
      occasionId: occ.id,
      tasks: [{ title: "Rezervă formația", dueOn: "2026-06-15", ownerMemberId: helper.memberId }, { title: "Trimite invitațiile", ownerMemberId: occ.ownerMemberId }, { title: "Probă rochie" }],
    });
    expect(out.isError).toBe(false);
    expect(out.data).toMatchObject({ applied: false, label: EXTERNAL_ASSISTANT_LABEL, confirmUrl: `${APP}/occasions/${occ.id}/proposals`, summary: { tasks: 3 } });
    expect((await queryTasks(occ.owner.ctx, occ.id)).total).toBe(0); // nothing applied
    const [preview] = await previewsOf(occ.id);
    const [tokenRow] = await t.db.select().from(mcpTokens).where(eq(mcpTokens.accountId, occ.owner.id));
    expect(preview).toMatchObject({ id: out.data.proposalId, kind: "tasks.proposeList", state: "pending", proposedByKind: "mcp", proposedById: tokenRow!.id });
    expect(preview!.delta.map((d) => d.what)).toEqual(["Rezervă formația", "Trimite invitațiile", "Probă rochie"]);

    // it shows up in list_pending_proposals and in get_occasion
    const pending = await call(token, "list_pending_proposals", { occasionId: occ.id });
    expect(pending.data.proposals).toEqual([expect.objectContaining({ proposalId: preview!.id, proposedBy: "external_assistant", mine: true, title: "Sarcini noi propuse: 3", changesTotal: 3 })]);
    expect((await call(token, "get_occasion", { occasionId: occ.id })).data.pendingProposals).toBe(1);

    // an unknown owner is refused before anything is stored
    const bad = await call(token, "propose_task_list", { occasionId: occ.id, tasks: [{ title: "x y", ownerMemberId: newId() }] });
    expect(bad.isError).toBe(true);
    expect(await previewsOf(occ.id)).toHaveLength(1);

    await confirmPreview(occ.owner.ctx, preview!.id);
    const tasks = (await queryTasks(occ.owner.ctx, occ.id)).rows;
    expect(tasks.map((x) => x.title).sort()).toEqual(["Probă rochie", "Rezervă formația", "Trimite invitațiile"]);
    expect(tasks.find((x) => x.title === "Rezervă formația")).toMatchObject({ dueDay: "2026-06-15", ownerMemberId: null, offer: { toMemberId: helper.memberId } });
    expect(tasks.find((x) => x.title === "Trimite invitațiile")!.ownerMemberId).toBe(occ.ownerMemberId);
    expect(await t.db.select().from(delegations).where(eq(delegations.occasionId, occ.id))).toHaveLength(1);
    // confirming twice does not add them twice (Q4)
    expect((await confirmPreview(occ.owner.ctx, preview!.id)).appliedNow).toBe(false);
    expect((await queryTasks(occ.owner.ctx, occ.id)).total).toBe(3);
  });

  it("propose_invitation_text: stored on confirm, labelled on the guest plate until the planner edits it", async () => {
    const occ = await mkOccasion();
    const h = await createHousehold(occ.owner.ctx, { occasionId: occ.id, name: "Familia Pop" });
    const link = await resolveGuestLink(anonymousCtx(t.db, { now: T0 }), h.token);
    const guest = makeCtx(t.db, link!.actor, { now: T0 });
    const wording = "Cu bucurie vă invităm să fiți alături de noi în ziua nunții noastre.";
    const out = await call(await mkToken(occ.owner), "propose_invitation_text", { occasionId: occ.id, text: wording });
    expect(out.isError).toBe(false);
    expect(await getGuestInvitationText(guest)).toEqual({ text: null, externalAssistant: false }); // nothing applied

    await confirmPreview(occ.owner.ctx, out.data.proposalId);
    expect(await getGuestInvitationText(guest)).toEqual({ text: wording, externalAssistant: true });
    expect(await getInvitationText(occ.owner.ctx, occ.id)).toEqual({ text: wording, externalAssistant: true });

    await setInvitationText(occ.owner.ctx, { occasionId: occ.id, text: `${wording} Vă așteptăm!` });
    expect(await getGuestInvitationText(guest)).toEqual({ text: `${wording} Vă așteptăm!`, externalAssistant: false });
    // only managers edit it; another occasion's guest never reads it
    const contributor = await join(occ.id, "contributor");
    await expect(setInvitationText(contributor.ctx, { occasionId: occ.id, text: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getGuestInvitationText(occ.owner.ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setInvitationText(occ.owner.ctx, { occasionId: occ.id, text: "" });
    expect((await getGuestInvitationText(guest)).text).toBeNull();
  });

  it("propose_budget and propose_budget_note: estimates labelled as estimates; applied only on confirm", async () => {
    const occ = await mkOccasion();
    const [venue] = await addCategories(occ.owner.ctx, { occasionId: occ.id, categories: [{ name: "Locație" }] });
    const token = await mkToken(occ.owner);
    const out = await call(token, "propose_budget", {
      occasionId: occ.id,
      categories: [{ categoryId: venue!.id, estimateMinor: 1_500_000, note: "Pe baza a 120 de invitați." }, { name: "Muzică", estimateMinor: 600_000 }],
    });
    expect(out.isError).toBe(false);
    expect(out.data.summary).toMatchObject({ categories: 2, amountsAre: "estimates" });
    const [preview] = await previewsOf(occ.id);
    const estimateRows = preview!.delta.filter((d) => d.key.startsWith("estimate:"));
    expect(estimateRows).toHaveLength(2);
    for (const row of estimateRows) expect(row.noteKey).toBe("mcp.whatif.budget.estimateNote");
    expect(estimateRows[0]).toMatchObject({ what: "Locație", before: null, after: "15.000 RON" }); // before: unknown, not 0
    expect((await getBudget(occ.owner.ctx, occ.id)).categories.map((c) => c.estimateMinor)).toEqual([null]);

    // a member with no finance grant does not even see that the proposal exists
    const contributor = await join(occ.id, "contributor");
    expect(await listPending(contributor.ctx, occ.id)).toHaveLength(0);

    await confirmPreview(occ.owner.ctx, preview!.id);
    const budget = await getBudget(occ.owner.ctx, occ.id);
    expect(budget.categories.map((c) => [c.name, c.estimateMinor])).toEqual([["Locație", 1_500_000], ["Muzică", 600_000]]);

    const note = await call(token, "propose_budget_note", { occasionId: occ.id, categoryId: venue!.id, text: "Avansul se plătește la semnare." });
    expect(note.isError).toBe(false);
    expect((await listPlanNotes(occ.owner.ctx, occ.id)).map((n) => n.body)).toEqual(["Pe baza a 120 de invitați."]);
    await confirmPreview(occ.owner.ctx, note.data.proposalId);
    const notes = await listPlanNotes(occ.owner.ctx, occ.id, { kind: "budget_note" });
    expect(notes.map((n) => [n.body, n.budgetCategoryId, n.source]).sort()).toEqual([
      ["Avansul se plătește la semnare.", venue!.id, "external_assistant"],
      ["Pe baza a 120 de invitați.", venue!.id, "external_assistant"],
    ]);
    // budget notes are finance data: hidden from a contributor, present in the summary for the owner
    expect(await listPlanNotes(contributor.ctx, occ.id)).toHaveLength(0);
    const summary = await call(token, "get_budget_summary", { occasionId: occ.id });
    expect(summary.data.notes.map((n: { label: string }) => n.label)).toEqual([EXTERNAL_ASSISTANT_LABEL, EXTERNAL_ASSISTANT_LABEL]);
    await expect(deletePlanNote(contributor.ctx, { noteId: notes[0]!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deletePlanNote(occ.owner.ctx, { noteId: notes[0]!.id });
    expect(await listPlanNotes(occ.owner.ctx, occ.id)).toHaveLength(1);
    // an unknown category is refused
    expect((await call(token, "propose_budget", { occasionId: occ.id, categories: [{ categoryId: newId(), estimateMinor: 1 }] })).isError).toBe(true);
  });

  it("propose_seating_layout and propose_custom_table: fit-checked previews of the existing kinds", async () => {
    const occ = await mkOccasion();
    const token = await mkToken(occ.owner);
    // no space model yet: the proposal is refused, nothing stored
    expect((await call(token, "propose_custom_table", { occasionId: occ.id, name: "Prezidiu", shape: "rect", widthMm: 3000, lengthMm: 800, seats: 6 })).isError).toBe(true);
    await createOwnSpace(occ.owner.ctx, { occasionId: occ.id, name: "Cort", widthMm: 10_000, lengthMm: 8000 });
    const h = await createHousehold(occ.owner.ctx, { occasionId: occ.id, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"] });
    const households = await call(token, "list_households", { occasionId: occ.id });
    const guestIds = households.data.households[0].adults.map((a: { guestId: string }) => a.guestId);

    const table = await call(token, "propose_custom_table", { occasionId: occ.id, name: "Prezidiu", shape: "rect", widthMm: 3000, lengthMm: 800, seats: 6, count: 2 });
    expect(table.data).toMatchObject({ applied: false, summary: { tables: 2, seats: 12 } });
    const layout = await call(token, "propose_seating_layout", {
      occasionId: occ.id,
      tables: [{ custom: { name: "Rotundă", shape: "round", diameterMm: 1800, seats: 10 }, x: 3000, y: 3000, guestIds, groups: [] }],
    });
    expect(layout.isError).toBe(false);
    expect(layout.data.summary).toMatchObject({ tables: 1, mode: "merge" });
    expect(typeof layout.data.summary.fitCheck).toBe("string");
    const previews = await previewsOf(occ.id);
    expect(previews.map((p) => p.kind).sort()).toEqual(["seating.applyLayout", "space.addCustomTable"]);
    expect((await getSpaceModel(occ.owner.ctx, occ.id))!.model.items).toHaveLength(0); // nothing applied

    await confirmPreview(occ.owner.ctx, layout.data.proposalId);
    const after = await call(token, "get_seating_summary", { occasionId: occ.id });
    expect(after.data.tables).toEqual([expect.objectContaining({ name: "Rotundă", seats: 10, seated: 2 })]);
    expect((await call(token, "list_households", { occasionId: occ.id })).data.households[0]).toMatchObject({ householdId: h.householdId });
  });
});

describe("directory tools (D3, P14, P16, P29)", () => {
  it("search_directory returns the directory's own order and labels verbatim; Featured arrives labelled and beside, never mixed in", async () => {
    const ids: string[] = [];
    for (const name of ["Foto Alfa", "Foto Beta", "Foto Gama", "Foto Delta", "Foto Epsilon"]) ids.push(await mkLiveListing(name));
    const { listingId: unclaimedId, revisionId } = await createUnclaimedListing(moderator, {
      name: "Studio Vechi",
      categoryIds: [foto.id],
      localityIds: [cluj.id],
      publicContactRoute: "Telefon 0264 000 000, str. Memorandumului 1",
      sourceUrl: "https://example.org/studio-vechi",
    });
    await decideRevision(await mkStaff(["listing_moderator"]), { id: revisionId, decision: "approve" });
    const token = await mkToken(await mkAccount(), "read");
    const now = new Date(T0.getTime() + 60_000);
    const statsBefore = (await t.db.select().from(statsDaily)).length;

    // organic only (Featured does not exist while monetization is off, MON5)
    const inApp = await getDirectoryResults(anonymousCtx(t.db, { now }), { categoryId: foto.id, countyCode: "CJ" });
    expect(inApp.organic).toHaveLength(6);
    const plain = await call(token, "search_directory", { category: "fotografi", countyCode: "cj" });
    expect(plain.isError).toBe(false);
    expect(plain.data.featured).toEqual([]);
    expect(plain.data.results.map((r: { listingId: string }) => r.listingId)).toEqual(inApp.organic.map((c) => c.id));
    expect(plain.data).toMatchObject({ day: inApp.day, total: 6, hasMore: false });
    for (const [i, r] of plain.data.results.entries()) {
      const c = inApp.organic[i]!;
      expect(r).toMatchObject({ name: c.name, claimed: c.claimed, excerpt: c.excerpt, badges: c.badges, responseStats: c.stats, featured: false });
      expect(r.categories).toEqual(c.categories);
      expect(r.counties).toEqual(c.counties);
    }
    // the category id works as well as its slug, and paging follows the same order
    const byId = await call(token, "search_directory", { category: foto.id, countyCode: "CJ", limit: 2, offset: 2 });
    expect(byId.data.results.map((r: { listingId: string }) => r.listingId)).toEqual(inApp.organic.slice(2, 4).map((c) => c.id));
    expect(byId.data.hasMore).toBe(true);
    const unclaimed = plain.data.results.find((r: { listingId: string }) => r.listingId === unclaimedId);
    expect(unclaimed).toMatchObject({ claimed: false, unclaimedNote: "Această listare nu a fost încă revendicată", badges: [], responseStats: null });

    // with a Featured provider: the card arrives labelled, in `featured`; `results` is untouched
    setFeaturedProvider(async () => [ids[3]!]);
    try {
      const withFeatured = await call(token, "search_directory", { category: "fotografi", countyCode: "CJ" });
      expect(withFeatured.data.featured).toEqual([expect.objectContaining({ listingId: ids[3], featured: true, label: "Promovat — plasare plătită", labelKey: "featured.label" })]);
      expect(withFeatured.data.results.map((r: { listingId: string }) => r.listingId)).toEqual(inApp.organic.map((c) => c.id));
      expect(withFeatured.data.results.every((r: { featured: boolean; label?: string }) => r.featured === false && r.label === undefined)).toBe(true);
    } finally {
      setFeaturedProvider(null);
    }
    // an assistant's search writes nothing — no search statistics, no listing views
    expect((await t.db.select().from(statsDaily)).length).toBe(statsBefore);
    // the tool has no way to ask for another order, day or boost
    const schema = listMcpTools().find((x) => x.name === "search_directory")!.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(["category", "countyCode", "limit", "localityId", "offset"]);

    const filters = await call(token, "list_directory_filters");
    expect(filters.data.categories.find((c: { slug: string }) => c.slug === "fotografi")).toMatchObject({ id: foto.id });
    expect(filters.data.counties.find((c: { code: string }) => c.code === "CJ")).toBeTruthy();
  });

  it("get_listing: an unclaimed listing exposes only its published contact route (P29)", async () => {
    const claimedId = await mkLiveListing("Foto Zeta");
    const { listingId, revisionId } = await createUnclaimedListing(moderator, {
      name: "Atelier Nou",
      categoryIds: [foto.id],
      localityIds: [cluj.id],
      publicContactRoute: "Telefon 0264 111 111",
      sourceUrl: "https://example.org/atelier-nou",
    });
    await decideRevision(await mkStaff(["listing_moderator"]), { id: revisionId, decision: "approve" });
    const token = await mkToken(await mkAccount(), "read");
    const u = await call(token, "get_listing", { listingId });
    expect(u.data).toMatchObject({
      name: "Atelier Nou",
      claimed: false,
      acceptsEnquiries: false,
      contact: null,
      unclaimed: { publicContactRoute: "Telefon 0264 111 111", sourceUrl: "https://example.org/atelier-nou" },
      spaces: [],
      catalogues: [],
    });
    const c = await call(token, "get_listing", { listingId: claimedId });
    expect(c.data).toMatchObject({ name: "Foto Zeta", claimed: true, acceptsEnquiries: true, unclaimed: null });
    expect((await call(token, "get_listing", { listingId: newId() })).isError).toBe(true);
    expect((await call(token, "list_catalogues", {})).data).toMatchObject({ total: 0, catalogues: [], pricesAre: "indicative" });
  });

  it("propose_supplier_shortlist creates ONLY a plan note: no supplier, no enquiry, no email, nobody notified", async () => {
    const occ = await mkOccasion();
    const a = await mkLiveListing("Foto Eta");
    const b = await mkLiveListing("Foto Theta");
    const token = await mkToken(occ.owner);
    const emailsBefore = (await t.db.select().from(emailOutbox)).length;

    const out = await call(token, "propose_supplier_shortlist", {
      occasionId: occ.id,
      title: "Fotografi de sunat",
      listings: [{ listingId: a, reason: "Stil documentar, aproape de locație.", featured: true }, { listingId: b }],
    });
    expect(out.isError).toBe(false);
    expect(out.data.summary).toMatchObject({ listings: 2, notifies: "nobody", enquiriesSent: 0 });
    expect(await t.db.select().from(planNotes).where(eq(planNotes.occasionId, occ.id))).toHaveLength(0);
    const [preview] = await previewsOf(occ.id);
    // the paid label travels with the entry that had it — and only with that one
    expect(preview!.delta.map((d) => [d.what, d.kindLabelKey])).toEqual([["Foto Eta", "featured.label"], ["Foto Theta", "mcp.whatif.shortlist.listing"]]);

    await confirmPreview(occ.owner.ctx, preview!.id);
    const notes = await listPlanNotes(occ.owner.ctx, occ.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: "supplier_shortlist",
      title: "Fotografi de sunat",
      source: "external_assistant",
      items: [
        { listingId: a, name: "Foto Eta", reason: "Stil documentar, aproape de locație.", featured: true },
        { listingId: b, name: "Foto Theta", reason: null, featured: false },
      ],
    });
    // a note and nothing else
    expect(await t.db.select().from(enquiries).where(eq(enquiries.occasionId, occ.id))).toHaveLength(0);
    expect(await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occ.id))).toHaveLength(0);
    expect((await listSuppliers(occ.owner.ctx, occ.id)).items).toHaveLength(0);
    expect((await t.db.select().from(emailOutbox)).length).toBe(emailsBefore);
    const actions = (await t.db.select().from(auditLog)).filter((r) => (r.meta as { occasionId?: string } | null)?.occasionId === occ.id).map((r) => r.action);
    expect(actions).toContain("plan_note.added");
    expect(actions.some((x) => /enquir|email|notif|supplier\./.test(x))).toBe(false);

    // a listing that is not public cannot be shortlisted
    const bad = await call(token, "propose_supplier_shortlist", { occasionId: occ.id, listings: [{ listingId: newId() }] });
    expect(bad.isError).toBe(true);
  });
});

describe("business tokens (MCP7)", () => {
  it("a business token reads its client occasion — and nothing of it after handover", async () => {
    const owner = await mkAccount();
    const business = await createBusiness(owner.ctx, { name: "Agenția Test SRL" });
    const staff = await mkAccount();
    await t.db.insert(businessMembers).values({ businessId: business.id, accountId: staff.id, role: "staff" });
    const occ = await createBusinessOccasion(staff.ctx, { businessId: business.id, occasion: { title: "Nunta de predat", kind: "blank", dateMode: "date", startsOn: "2027-06-12" } });
    const client = await join(occ.id, "contributor");

    const raw = `edmcp_${newId()}${newId()}`;
    const [bizToken] = await t.db
      .insert(mcpTokens)
      .values({ accountId: owner.id, name: "Asistent firmă", tokenHash: hashToken(raw), last4: raw.slice(-4), scope: "read_propose", businessId: business.id, createdAt: T0, consentAcceptedAt: T0 })
      .returning();
    const before = await call(raw, "get_occasion", { occasionId: occ.id });
    expect(before.data).toMatchObject({ title: "Nunta de predat", member: { role: "pm", viaBusiness: true } });
    expect((await call(raw, "list_occasions")).data.occasions.map((o: { id: string }) => o.id)).toEqual([occ.id]);

    const preview = await proposeHandover(owner.ctx, { occasionId: occ.id, toMemberId: client.memberId });
    await confirmPreview(owner.ctx, preview.id);
    const [revoked] = await t.db.select().from(mcpTokens).where(eq(mcpTokens.id, bizToken!.id));
    expect(revoked!.revokedAt).not.toBeNull(); // the token stops working at handover

    // even if such a token were still alive, core's membership check refuses the occasion
    await t.db.update(mcpTokens).set({ revokedAt: null, revokedReason: null, tokenHash: hashToken(raw) }).where(eq(mcpTokens.id, bizToken!.id));
    await t.db.insert(occasionMembers).values({ occasionId: occ.id, accountId: owner.id, role: "pm" }); // a row planted by hand
    for (const tool of ["get_occasion", "list_tasks", "get_rsvp_summary", "get_budget_summary", "list_suppliers"]) {
      const out = await call(raw, tool, { occasionId: occ.id });
      expect(out.isError, tool).toBe(true);
      expect(out.text, tool).not.toContain("Nunta de predat");
    }
    expect((await call(raw, "propose_task_list", { occasionId: occ.id, tasks: [{ title: "x y" }] })).isError).toBe(true);
    expect((await call(raw, "list_occasions")).data.occasions).toEqual([]);
    expect((await call(raw, "whoami")).data.occasions).toEqual([]);
    // the client, who now owns it, reads it with their own token
    expect((await call(await mkToken(client, "read"), "get_occasion", { occasionId: occ.id })).data.member.role).toBe("owner");
  });
});

describe("the invitation builder (list_invitation_designs, get_invitation_preview, propose_invitation_design)", () => {
  async function rawCall(token: string, name: string, args: Record<string, unknown>) {
    const res = await handleMcpRequest(
      new Request(`${APP}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
      { db: t.db, now: new Date(T0.getTime() + 60_000), appUrl: APP, env: {} },
    );
    return ((await res.json()) as { result: { isError: boolean; structuredContent?: any; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } }).result; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it("an assistant reads the designs, looks at a draft, proposes it; the planner's confirmation makes a new, unproofed, AI-labelled version", async () => {
    const occ = await mkOccasion();
    const token = await mkToken(occ.owner);

    const list = await call(token, "list_invitation_designs", { occasionId: occ.id });
    expect(list.isError).toBe(false);
    expect(list.data.collection).toBe("occasion");
    expect(list.data.total).toBeGreaterThanOrEqual(50);
    expect(list.data.designs[0]).toMatchObject({ key: expect.stringMatching(/^t\.blank\./), name: expect.stringContaining(" · ") });
    expect(list.data.designs[0].colourways).toHaveLength(3);
    expect(list.data.fields.find((f: { field: string }) => f.field === "names")).toMatchObject({ required: true, maxLength: 90 });
    expect(list.data.starterWordings).toHaveLength(10);
    expect(list.data.current).toBeNull();
    expect(list.data.collections.map((c: { key: string }) => c.key)).toContain("embroidery");
    // another kind's templates are never offered, and a collection can be asked for
    expect(list.data.designs.every((d: { key: string }) => !d.key.startsWith("t.nunta."))).toBe(true);
    expect((await call(token, "list_invitation_designs", { occasionId: occ.id, collection: "house" })).data.designs.map((d: { key: string }) => d.key)).toContain("classic");

    const design = list.data.designs[4];
    const draft = { occasionId: occ.id, designKey: design.key, colourwayKey: design.colourways[0].key, locale: "ro", texts: { kicker: "Cu drag", names: "Ana & Mihai", wording: "vă invităm la nunta noastră", date: "Sâmbătă, 12 septembrie 2026", venue: "Conacul Vechi", rsvp: "Confirmați până la 1 august" } };
    const preview = await rawCall(token, "get_invitation_preview", draft);
    expect(preview.isError, preview.content[0]?.text).toBe(false);
    expect(preview.structuredContent).toMatchObject({ piece: "invitation", widthMm: 148, heightMm: 210, tooLong: [], fitsAsDesigned: true });
    const image = preview.content.find((c) => c.type === "image")!;
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(JSON.stringify(preview.structuredContent)).not.toContain(image.data!.slice(0, 40)); // the picture is not repeated in the JSON
    // too long is reported, not refused; a design of another kind is refused
    const long = await call(token, "get_invitation_preview", { ...draft, texts: { ...draft.texts, kicker: "x".repeat(120) } });
    expect(long.data.tooLong).toEqual(["kicker"]);
    expect((await call(token, "get_invitation_preview", { ...draft, designKey: "t.nunta.01", colourwayKey: "tp-macaron" })).isError).toBe(true);

    const out = await call(token, "propose_invitation_design", draft);
    expect(out.isError).toBe(false);
    expect(out.data).toMatchObject({ applied: false, label: EXTERNAL_ASSISTANT_LABEL, confirmUrl: `${APP}/occasions/${occ.id}/proposals` });
    expect((await getStationeryEditor(occ.owner.ctx, occ.id)).current).toBeNull(); // nothing saved yet
    const [p] = await previewsOf(occ.id);
    expect(p).toMatchObject({ kind: "stationery.version", state: "pending", proposedByKind: "mcp" });
    expect(p!.delta.map((d) => d.key)).toEqual(expect.arrayContaining(["design", "colourway", "text:names", "text:wording"]));
    // texts over the limit are refused at proposal time
    expect((await call(token, "propose_invitation_design", { ...draft, texts: { ...draft.texts, names: "" } })).isError).toBe(true);

    await confirmPreview(occ.owner.ctx, p!.id);
    const editor = await getStationeryEditor(occ.owner.ctx, occ.id);
    expect(editor.current).toMatchObject({ version: 1, designKey: design.key, colourwayKey: design.colourways[0].key, proofedAt: null });
    expect(editor.current!.texts.wording).toMatchObject({ value: "vă invităm la nunta noastră", aiGenerated: true });
    expect(editor.current!.texts.names.aiGenerated).toBe(true);
    // and the builder now reports it
    expect((await call(token, "list_invitation_designs", { occasionId: occ.id })).data.current).toMatchObject({ version: 1, proofed: false });
  });

  it("a contributor reads and previews but cannot propose; a stranger reads nothing", async () => {
    const occ = await mkOccasion();
    const contributor = await mkToken(await join(occ.id, "contributor"));
    const list = await call(contributor, "list_invitation_designs", { occasionId: occ.id });
    expect(list.isError).toBe(false);
    const d = list.data.designs[0];
    const draft = { occasionId: occ.id, designKey: d.key, colourwayKey: d.colourways[0].key, locale: "ro", texts: { names: "Ana & Mihai" } };
    expect((await call(contributor, "get_invitation_preview", draft)).isError).toBe(false);
    expect((await call(contributor, "propose_invitation_design", draft)).isError).toBe(true);
    const stranger = await mkToken(await mkAccount());
    expect((await call(stranger, "list_invitation_designs", { occasionId: occ.id })).isError).toBe(true);
    expect((await call(stranger, "get_invitation_preview", draft)).isError).toBe(true);
    expect(await previewsOf(occ.id)).toHaveLength(0);
  });
});
