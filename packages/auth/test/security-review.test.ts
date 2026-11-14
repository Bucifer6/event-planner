import { accountCtx, anonymousCtx, type Ctx } from "@ed/core/context";
import { accounts } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginTotpEnrolment, confirmTotpEnrolment, createSession, safeNextPath, totpCodeAt, verifySecondFactor, withNext } from "../src/index";

// Regression tests of the security review of 14 November 2026 (docs/build/12-security-review.md).

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const T0 = new Date("2026-11-14T08:00:10.000Z");
let ipSeq = 0;
const anon = (now: Date): Ctx => anonymousCtx(t.db, { now, ip: `10.77.0.${++ipSeq}` });

describe("F-05 an authenticator code is accepted once, even for two requests at the same instant", () => {
  it("of two parallel second-factor checks with the same code exactly one succeeds", async () => {
    const [account] = await t.db.insert(accounts).values({ kind: "email", email: "race@example.ro" }).returning({ id: accounts.id });
    const accountId = account!.id;
    const first = await createSession(accountCtx(t.db, accountId, { now: T0 }), { accountId, fresh: true });
    const ctx: Ctx = { ...accountCtx(t.db, accountId, { now: T0 }), actor: { kind: "account", accountId, sessionId: first.sessionId } as never };
    const enrol = await beginTotpEnrolment(ctx);
    await confirmTotpEnrolment(ctx, { code: totpCodeAt(enrol.secret, T0) });

    // several browsers passed the first factor; all send the SAME app code at the same moment
    const later = new Date(T0.getTime() + 5 * 60_000);
    const code = totpCodeAt(enrol.secret, later);
    const pending = [];
    for (let i = 0; i < 8; i++) pending.push(await createSession(accountCtx(t.db, accountId, { now: later }), { accountId, secondFactorPending: true }));
    const results = await Promise.allSettled(pending.map((p) => verifySecondFactor(anon(later), { sessionToken: p.token, code })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ messageKey: "auth.errors.totpInvalid" });
    // and never again afterwards
    const c = await createSession(accountCtx(t.db, accountId, { now: later }), { accountId, secondFactorPending: true });
    await expect(verifySecondFactor(anon(later), { sessionToken: c.token, code })).rejects.toMatchObject({ messageKey: "auth.errors.totpInvalid" });
  });
});

describe("V-06 sign-in return path: more open-redirect payloads", () => {
  it("drops every value that could leave the app or reach a non-allowlisted page", () => {
    const payloads = [
      "/occasions/..//evil.example",
      "/occasions/%2e%2e/%2e%2e/account/delete",
      "/occasions/.%2e/account",
      "/occasions/abc/..\\..\\evil.example",
      "/occasions/\u0000abc",
      "/occasions/abc ",
      "/​evil.example/occasions/x",
      "//occasions/abc",
      "/./\\evil.example/occasions/x",
      "/occasions/abc\r\nSet-Cookie: x=1",
      "https:evil.example/occasions/x",
      "/%09/evil.example",
      "‮/occasions/abc",
      "/occasions",
      "/business",
      "/occasions/../../../sign-out",
      "/directory/../console/approvals",
      "/business/../api/deploys/record",
      "/invite/%2e%2e%2fconsole",
      "ｈttps://evil.example/occasions/x",
      "/／evil.example/occasions/x",
    ];
    for (const value of payloads) {
      const safe = safeNextPath(value);
      // either refused outright, or reduced by the URL parser to a path that is still inside the allowlist
      if (safe !== null) {
        expect(safe, value).toMatch(/^\/(invite|claim|directory|occasions|business)\/[^/\\]/);
        expect(new URL(safe, "https://app.example").origin, value).toBe("https://app.example");
        expect(safe, value).not.toMatch(/\.\.|\/\/|\\|%2f|%5c|[\u0000- ]/i);
      }
      // withNext never emits the raw value
      const built = withNext("/sign-in", value);
      expect(built === "/sign-in" || built === `/sign-in?next=${encodeURIComponent(safe ?? "")}`, value).toBe(true);
    }
    expect(safeNextPath("/occasions/%2e%2e/%2e%2e/account/delete")).toBeNull();
    expect(safeNextPath("/directory/../console/approvals")).toBeNull();
    expect(safeNextPath("/business/../api/deploys/record")).toBeNull();
  });
});
