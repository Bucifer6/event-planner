import { accounts, auditLog, eq } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_UI_THEME, getUiTheme, setUiTheme, UI_THEME_SETTING_KEY } from "../src/appearance";
import { accountCtx, makeCtx } from "../src/context";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

async function staffCtx(roles: string[]) {
  const [a] = await t.db.insert(accounts).values({ kind: "email", email: `s${Math.random()}@example.ro` }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: a!.id, staffId: `staff_${a!.id}`, roles } as never);
}

describe("appearance (the look of the app)", () => {
  it("defaults to the house look and survives an unreadable setting", async () => {
    expect(await getUiTheme({ db: t.db }, { fresh: true })).toBe(DEFAULT_UI_THEME);
  });

  it("only a platform administrator can change it; the change is audited and takes effect at once", async () => {
    const [a] = await t.db.insert(accounts).values({ kind: "email", email: "planner@example.ro" }).returning();
    await expect(setUiTheme(accountCtx(t.db, a!.id), { theme: "atelier" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setUiTheme(await staffCtx(["listing_moderator"]), { theme: "atelier" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const admin = await staffCtx(["platform_admin"]);
    expect(await setUiTheme(admin, { theme: "riviera" })).toBe("riviera");
    expect(await getUiTheme({ db: t.db })).toBe("riviera");
    expect(await getUiTheme({ db: t.db }, { fresh: true })).toBe("riviera");
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.objectId, UI_THEME_SETTING_KEY));
    expect(rows).toHaveLength(1);
  });

  it("refuses a look that does not exist", async () => {
    const admin = await staffCtx(["platform_admin"]);
    await expect(setUiTheme(admin, { theme: "neon" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await getUiTheme({ db: t.db }, { fresh: true })).toBe("riviera");
  });
});
