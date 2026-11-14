import { auditLog, eq, platformSettings, sql, whatifPreviews } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { AppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { accountCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { runRetention } from "../src/retention";
import {
  confirmPreview,
  createPreview,
  discardPreview,
  EXTERNAL_ASSISTANT_SOURCE,
  getPreview,
  listPending,
  registerWhatIf,
  toPreviewView,
} from "../src/whatif";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const OWNER = "acc_owner";
const OCC = "occ_1";
let applyCalls = 0;

async function counter(key: string): Promise<number> {
  const [row] = await t.db.select().from(platformSettings).where(eq(platformSettings.key, key));
  return row ? Number(row.value) : 0;
}

// A test kind: "add N to a counter". Only OWNER (or their MCP token, to propose) has access.
registerWhatIf("test.addToCounter", {
  input: z.object({ by: z.number().int() }),
  authorize: async (ctx, subject) => {
    const account =
      ctx.actor.kind === "account" || ctx.actor.kind === "mcp" ? ctx.actor.accountId : null;
    if (account !== OWNER || subject.occasionId !== OCC) throw new AppError("FORBIDDEN");
  },
  compute: async (_ctx, input, subject) => ({
    title: { key: "whatif.test.title", params: { by: input.by } },
    delta: [
      {
        key: "counter",
        what: subject.subjectId,
        kindLabelKey: "whatif.kinds.changed",
        before: String(await counter(subject.subjectId)),
        after: String((await counter(subject.subjectId)) + input.by),
      },
      { key: "unknown", what: { key: "whatif.test.cost" }, before: null, after: "10" },
    ],
  }),
  apply: async (tx, preview) => {
    applyCalls++;
    await new Promise((r) => setTimeout(r, 40));
    if (preview.input.by === 13) throw new AppError("CONFLICT", "whatif.errors.stale");
    await tx.db
      .insert(platformSettings)
      .values({ key: preview.subjectId, value: preview.input.by })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value: sql`(${platformSettings.value}::text::int + ${preview.input.by})::text::jsonb` },
      });
  },
});

const owner = (now?: Date): Ctx => accountCtx(t.db, OWNER, { now });
const propose = (ctx: Ctx, subjectId: string, by = 5) =>
  createPreview(ctx, { kind: "test.addToCounter", occasionId: OCC, subjectType: "counter", subjectId, input: { by } });
const auditActions = async (id: string) =>
  (await t.db.select().from(auditLog).where(eq(auditLog.objectId, id))).map((r) => r.action).sort();

describe("what-if engine", () => {
  it("a preview shows the effects and changes nothing", async () => {
    const p = await propose(owner(), "c_preview");
    expect(p.state).toBe("pending");
    expect(p.proposedByKind).toBe("account");
    expect(p.delta[0]).toMatchObject({ key: "counter", before: "0", after: "5" });
    expect(p.delta[1]!.before).toBeNull(); // unknown stays unknown, never 0
    expect(await counter("c_preview")).toBe(0);
    const view = toPreviewView(p);
    expect(view.title).toEqual({ key: "whatif.test.title", params: { by: 5 } });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect((await listPending(owner(), OCC)).map((x) => x.id)).toContain(p.id);
  });

  it("confirm applies once; repeating it is a no-op that reports the applied preview", async () => {
    const p = await propose(owner(), "c_confirm");
    const before = applyCalls;
    const first = await confirmPreview(owner(), p.id);
    expect(first.appliedNow).toBe(true);
    expect(first.preview.state).toBe("applied");
    expect(first.preview.decidedBy).toBe(OWNER);
    const second = await confirmPreview(owner(), p.id);
    expect(second.appliedNow).toBe(false);
    expect(second.preview.state).toBe("applied");
    expect(applyCalls - before).toBe(1);
    expect(await counter("c_confirm")).toBe(5);
    expect(await auditActions(p.id)).toEqual(["whatif.applied", "whatif.proposed"]);
    expect((await listPending(owner(), OCC)).map((x) => x.id)).not.toContain(p.id);
  });

  it("parallel double confirm applies exactly once", async () => {
    const p = await propose(owner(), "c_parallel", 7);
    const before = applyCalls;
    const results = await Promise.all(Array.from({ length: 6 }, () => confirmPreview(owner(), p.id)));
    expect(results.filter((r) => r.appliedNow)).toHaveLength(1);
    expect(results.every((r) => r.preview.state === "applied")).toBe(true);
    expect(applyCalls - before).toBe(1);
    expect(await counter("c_parallel")).toBe(7);
    expect((await auditActions(p.id)).filter((a) => a === "whatif.applied")).toHaveLength(1);
  });

  it("discard leaves no trace besides the row and one audit entry", async () => {
    const p = await propose(owner(), "c_discard");
    const d = await discardPreview(owner(), p.id);
    expect(d.state).toBe("discarded");
    expect((await discardPreview(owner(), p.id)).state).toBe("discarded"); // idempotent
    expect(await counter("c_discard")).toBe(0);
    expect(await auditActions(p.id)).toEqual(["whatif.discarded", "whatif.proposed"]);
    await expect(confirmPreview(owner(), p.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await counter("c_discard")).toBe(0);
  });

  it("an applied preview cannot be discarded", async () => {
    const p = await propose(owner(), "c_applied_then_discard");
    await confirmPreview(owner(), p.id);
    await expect(discardPreview(owner(), p.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("if apply fails nothing is applied and the preview stays pending", async () => {
    const p = await propose(owner(), "c_stale", 13);
    await expect(confirmPreview(owner(), p.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const [row] = await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, p.id));
    expect(row!.state).toBe("pending");
    expect(row!.decidedAt).toBeNull();
    expect(await counter("c_stale")).toBe(0);
    expect(await auditActions(p.id)).toEqual(["whatif.proposed"]);
  });

  it("an expired preview cannot be confirmed and is not listed", async () => {
    const p = await propose(owner(new Date("2026-01-01T10:00:00Z")), "c_expired");
    const later = owner(new Date("2026-01-09T10:00:00Z"));
    await expect(confirmPreview(later, p.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await counter("c_expired")).toBe(0);
    expect((await listPending(later, OCC)).map((x) => x.id)).not.toContain(p.id);
    // purged 30 days after expiry by the retention job
    const results = await runRetention(systemCtx(t.db, { now: new Date("2026-03-01T10:00:00Z") }));
    expect(results.find((r) => r.name === "whatif-expired-previews")!.deleted).toBeGreaterThanOrEqual(1);
    await expect(getPreview(owner(), p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an external assistant can only propose; a person confirms in the app (MCP3)", async () => {
    const mcp = makeCtx(t.db, { kind: "mcp", accountId: OWNER, tokenId: "tok_1", scope: "read_propose" });
    const p = await propose(mcp, "c_mcp", 3);
    expect(p.proposedByKind).toBe("mcp");
    expect(p.proposedById).toBe("tok_1");
    expect(p.source).toBe(EXTERNAL_ASSISTANT_SOURCE);
    await expect(confirmPreview(mcp, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardPreview(mcp, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmPreview(systemCtx(t.db), p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await counter("c_mcp")).toBe(0);
    const readOnly = makeCtx(t.db, { kind: "mcp", accountId: OWNER, tokenId: "tok_2", scope: "read" });
    await expect(propose(readOnly, "c_mcp")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await confirmPreview(owner(), p.id)).appliedNow).toBe(true);
    expect(await counter("c_mcp")).toBe(3);
  });

  it("checks access through the kind's authorize on every operation", async () => {
    const stranger = accountCtx(t.db, "acc_stranger");
    await expect(propose(stranger, "c_auth")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await propose(owner(), "c_auth");
    await expect(getPreview(stranger, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmPreview(stranger, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(discardPreview(stranger, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listPending(stranger, OCC)).toEqual([]);
    expect(await counter("c_auth")).toBe(0);
  });

  it("refuses unknown kinds and invalid input", async () => {
    await expect(
      createPreview(owner(), { kind: "nobody.registered", subjectType: "x", subjectId: "y", input: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createPreview(owner(), { kind: "test.addToCounter", occasionId: OCC, subjectType: "counter", subjectId: "c", input: { by: "x" } }),
    ).rejects.toThrow();
  });
});
