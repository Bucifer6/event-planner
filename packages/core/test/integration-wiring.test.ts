import { accounts, auditLog, enquiryStatEvents, eq, occasionMembers, sessions, staffMembers } from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { newId } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountLabel, getOwnAccount, setDisplayName } from "../src/accounts";
import { getBusinessReport } from "../src/bizoccasions";
import { createBusiness } from "../src/business";
import { accountCtx, makeCtx, type Ctx } from "../src/context";
import { createListing } from "../src/listings";
import { listMembers } from "../src/members";
import { createOccasion } from "../src/occasions";
import { getDashboard } from "../src/staff";
import { createTask, listAssignableMembers, queryTasks } from "../src/tasks";
import "../src/wiring";

let t: TestDb;
const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

async function mkAccount(): Promise<{ id: string; email: string; ctx: Ctx }> {
  const id = newId();
  const email = `wire${++seq}@example.test`;
  await t.db.insert(accounts).values({ id, kind: "email", email });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, email, ctx: accountCtx(t.db, id, { now: T0 }) };
}

beforeAll(async () => {
  t = await setupTestDb();
  await runSeeds(t.db, ["categories", "geography"]);
});
afterAll(async () => {
  await t.close();
});

describe("account display name", () => {
  it("is optional, set by the account itself, and used wherever members are labelled", async () => {
    const owner = await mkAccount();
    const helper = await mkAccount();
    const occasion = await createOccasion(owner.ctx, { title: "Aniversarea Mariei", kind: "blank", dateMode: "date", startsOn: "2026-09-12" });
    await t.db.insert(occasionMembers).values({ occasionId: occasion.id, accountId: helper.id, role: "contributor" });
    await createTask(helper.ctx, { occasionId: occasion.id, title: "Cumpără baloane", owner: "me" });

    // before: the login email is the label
    expect((await listMembers(owner.ctx, occasion.id)).map((m) => m.name).sort()).toEqual([helper.email, owner.email].sort());
    expect((await queryTasks(owner.ctx, occasion.id)).rows[0]!.ownerName).toBe(helper.email);

    expect(await setDisplayName(helper.ctx, { displayName: "  Ioana   Pop " })).toEqual({ displayName: "Ioana Pop" });
    expect((await getOwnAccount(helper.ctx)).displayName).toBe("Ioana Pop");
    expect((await listMembers(owner.ctx, occasion.id)).find((m) => m.accountId === helper.id)!.name).toBe("Ioana Pop");
    expect((await listAssignableMembers(owner.ctx, occasion.id)).find((m) => !m.isSelf)!.name).toBe("Ioana Pop");
    expect((await queryTasks(owner.ctx, occasion.id)).rows[0]!.ownerName).toBe("Ioana Pop");
    // the audit row says only that a name was set — never the name
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, helper.id));
    expect(JSON.stringify(audits.filter((a) => a.action === "account.display_name_set"))).not.toContain("Ioana");

    // blank clears it; too long is refused; nobody sets it for someone else (there is no such input)
    expect(await setDisplayName(helper.ctx, { displayName: "" })).toEqual({ displayName: null });
    expect((await listMembers(owner.ctx, occasion.id)).find((m) => m.accountId === helper.id)!.name).toBe(helper.email);
    await expect(setDisplayName(helper.ctx, { displayName: "x".repeat(61) })).rejects.toThrow();
    await expect(setDisplayName(makeCtx(t.db, { kind: "mcp", accountId: helper.id, tokenId: newId(), scope: "read_propose" }, { now: T0 }), { displayName: "Bot" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(accountLabel({ displayName: " ", email: null, username: "ed-abc" })).toBe("ed-abc");
  });
});

describe("wiring: enquiry counts and console counters", () => {
  it("the business report and the console dashboard get counts only", async () => {
    const owner = await mkAccount();
    const other = await mkAccount();
    const business = await createBusiness(owner.ctx, { name: "Foto Wire SRL" });
    const otherBusiness = await createBusiness(other.ctx, { name: "Alt Foto SRL" });
    const mkListing = async (ctx: Ctx, businessId: string, name: string) => (await createListing(ctx, { businessId, payload: { name } })).id;
    const mine = await mkListing(owner.ctx, business.id, "Foto Wire");
    const theirs = await mkListing(other.ctx, otherBusiness.id, "Alt Foto");
    const day = 86_400_000;
    await t.db.insert(enquiryStatEvents).values([
      { listingId: mine, receivedAt: new Date(T0.getTime() - 2 * day), answeredAt: new Date(T0.getTime() - day), replyMinutes: 1440 },
      { listingId: mine, receivedAt: new Date(T0.getTime() - 3 * day) },
      { listingId: mine, receivedAt: new Date(T0.getTime() - 90 * day) }, // outside the 30-day report
      { listingId: theirs, receivedAt: new Date(T0.getTime() - day) },
    ]);

    const report = await getBusinessReport(owner.ctx, business.id);
    expect(report.enquiries).toEqual({ received: 2, unanswered: 1 });
    expect((await getBusinessReport(other.ctx, otherBusiness.id)).enquiries).toEqual({ received: 1, unanswered: 1 });

    const admin = await mkAccount();
    const [staff] = await t.db.insert(staffMembers).values({ accountId: admin.id, roles: ["platform_admin"] }).returning();
    const dash = await getDashboard(makeCtx(t.db, { kind: "staff", accountId: admin.id, staffId: staff!.id, roles: ["platform_admin"] }, { now: T0 }));
    const extra = Object.fromEntries(dash.extra.map((c) => [c.key, c]));
    expect(extra.enquiries).toMatchObject({ total: 4, byStatus: { answered: 1, unanswered: 3 } });
    expect(extra.discovery).toMatchObject({ total: 0 });
    expect(extra.claims).toMatchObject({ total: 0 });
  });
});
